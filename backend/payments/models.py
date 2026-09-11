from django.db import models
from accounts.models import LandlordProfile, User


class LandlordSubscription(models.Model):
    # One row = one landlord's current subscription state. OneToOneField,
    # not ForeignKey — unlike Payment attempts (many per listing), a
    # landlord has AT MOST ONE active subscription at a time. This
    # mirrors Paystack's own "customer has one subscription per plan"
    # mental model.

    landlord_profile = models.OneToOneField(
        LandlordProfile, on_delete=models.CASCADE, related_name='subscription'
    )

    class Tier(models.TextChoices):
        FREE = 'free', 'Free'
        AGENT = 'agent', 'paddy agent'
        LORD = 'lord', 'paddy lord'
        # 3 real product tiers, each unlocking a different listing cap +
        # feature set (verified badge, pre-screening, featured bump —
        # these PERKS aren't stored as separate fields on this model at
        # all; they're derived FROM tier wherever needed, e.g. the
        # frontend just checks tier to decide what to show. Storing them
        # separately would risk them drifting out of sync with tier —
        # e.g. someone on 'agent' tier ending up with 'lord' perks by
        # mistake because two different fields got out of step)

    tier = models.CharField(max_length=10, choices=Tier.choices, default=Tier.FREE)

    LISTING_CAPS = {
        Tier.FREE: 1,
        Tier.AGENT: 10,
        Tier.LORD: None,
        # None here specifically means "no cap" (unlimited) — NOT zero,
        # NOT "not set". Chosen deliberately since 0 would be
        # ambiguous/wrong (0 would mean "can't list at all"), and this
        # dict is a plain Python class attribute, not a database field,
        # so it costs nothing and can't accidentally drift per-row —
        # every landlord on a given tier gets EXACTLY that tier's cap,
        # always, with no way for one row to have a different cap than
        # another row on the same tier
    }

    paystack_customer_code = models.CharField(max_length=100, blank=True)
    # Paystack's own ID for this landlord as a "customer" in their
    # system (e.g. "CUS_xnxdt6s1zg1f4nx") — needed to reference them in
    # later API calls. blank=True since this only gets filled in once
    # they actually initiate their first payment

    paystack_subscription_code = models.CharField(max_length=100, blank=True)
    # Paystack's ID for the actual subscription object (e.g.
    # "SUB_vsyqdmlzble3uii") — returned once a subscription is
    # successfully created, used later if we ever need to cancel/manage it

    class Status(models.TextChoices):
        INACTIVE = 'inactive', 'Inactive'
        # Default — landlord has never paid, or their subscription
        # lapsed/was cancelled. Cannot publish beyond their free listing
        ACTIVE = 'active', 'Active'
        # A successful charge has gone through for the current period
        PAST_DUE = 'past_due', 'Past Due'
        # A renewal charge failed (invoice.payment_failed) — worth
        # tracking separately from INACTIVE so we can show a "please
        # update your card" message rather than treating it identically
        # to someone who never subscribed at all

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.INACTIVE)

    current_period_end = models.DateTimeField(null=True, blank=True)
    # When the CURRENT paid period expires. Lets our own enforcement
    # logic (perform_create on ListingViewSet) do a cheap local check —
    # "is status ACTIVE and current_period_end still in the future" —
    # without needing to call Paystack's API on every single listing
    # creation just to check subscription status

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # auto_now (not auto_now_add) — updates every time this row is
    # saved, useful here since status/current_period_end will genuinely
    # change over the subscription's lifetime, unlike e.g. created_at
    # on Listing which is set once and never touched again

    def __str__(self):
        return f"{self.landlord_profile} - {self.tier} - {self.status}"

    def is_active(self):
        # A small helper method — keeps the "is this landlord currently
        # on a genuinely PAID, current subscription" logic in ONE place,
        # rather than every call-site re-deriving it from status +
        # current_period_end separately and risking the two checks
        # drifting out of sync with each other over time
        #
        # NOTE: FREE tier landlords are never "active" in this sense —
        # is_active() specifically means "currently paying", the free
        # tier's 1-listing allowance is handled separately by
        # listing_cap() below, not by this method

        from django.utils import timezone
        # Imported here rather than at the top of the file — this is a
        # deliberate style choice some Django devs use for imports only
        # needed inside one specific method, to keep the top-level
        # imports focused on what the whole file needs broadly

        if self.status != self.Status.ACTIVE:
            return False

        if self.current_period_end is None:
            return False

        return self.current_period_end > timezone.now()
        # timezone.now() — Django's timezone-AWARE version of "right
        # now", required instead of plain datetime.now() whenever
        # comparing against a DateTimeField, since Django stores
        # timestamps with timezone info attached (USE_TZ setting) and
        # comparing an aware datetime to a naive one raises an error

    def listing_cap(self):
        # Returns the max number of listings this landlord's CURRENT
        # tier allows, or None for unlimited. Deliberately does NOT
        # check is_active() itself — a landlord whose paid tier has
        # lapsed (PAST_DUE/expired) should fall back to being treated
        # as FREE-tier capped, which the call-site (perform_create)
        # handles by checking is_active() separately before ever
        # trusting a paid tier's higher cap

        return self.LISTING_CAPS[self.tier]


class ListingUnlock(models.Model):
    # One row = one user has paid to unlock ONE specific listing's
    # protected details (address_precise + landlord contact info).
    # Deliberately keyed to User, not RenterProfile — the paywall
    # applies to "everyone without active paid status" per the actual
    # product decision, which includes a Free-tier landlord browsing
    # someone ELSE's listing, not just renters. User is the one model
    # every role (renter/landlord/staff) actually has, so it's the
    # correct thing to key against here

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='listing_unlocks'
    )
    # ForeignKey (not OneToOne) — one user can unlock MANY different
    # listings over time, each one a separate row. Unlike
    # LandlordSubscription (at most ONE per landlord), there's no limit
    # here — a renter house-hunting seriously might unlock several
    # listings across their search

    listing = models.ForeignKey(
        'listings.Listing', on_delete=models.CASCADE, related_name='unlocks'
    )
    # 'listings.Listing' — a STRING reference instead of importing the
    # Listing class directly at the top of the file. This avoids a
    # circular import: listings/views.py already imports FROM payments
    # (LandlordSubscription, inside perform_create), so payments/models.py
    # importing Listing back would create a loop. Django resolves this
    # string lazily, once all apps have finished loading, sidestepping
    # the problem entirely — this is the standard Django pattern
    # whenever two apps need to reference each other's models

    paystack_reference = models.CharField(max_length=100, blank=True)
    # Paystack's own transaction reference (e.g. "T1234567890") for this
    # specific charge — kept for auditing/support ("show me proof this
    # user actually paid for this exact listing"), same reasoning as
    # storing paystack_customer_code/subscription_code above

    created_at = models.DateTimeField(auto_now_add=True)
    # When the unlock actually completed (webhook-confirmed), not when
    # they merely started checkout — set once, never touched again,
    # same as Listing.created_at

    class Meta:
        unique_together = ('user', 'listing')
        # Enforces "this user has unlocked this listing AT MOST once" at
        # the DATABASE level, not just in application code — even if two
        # requests raced each other (e.g. a webhook retry), the database
        # itself refuses a second row for the same user+listing pair,
        # raising an IntegrityError rather than silently duplicating

    def __str__(self):
        return f"{self.user} unlocked {self.listing}"
