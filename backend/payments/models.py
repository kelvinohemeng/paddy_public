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
        Tier.FREE: 3,
        Tier.AGENT: 10,
        Tier.LORD: None,
        # KELVIN'S DECISION (2026-09-28): these are LIVE-listing caps —
        # the number of listings that may be `published` or
        # `pending_review` at the same time. Drafts, rejected, archived,
        # paused and leased listings don't use a slot. The cap is checked
        # when a landlord submits a listing for review (see
        # listings/views.py submit_for_review), not when they create a
        # draft. The Free tier ALSO has a separate total limit (10
        # listings of any kind) — see FREE_TOTAL_LISTING_CAP in
        # payments/limits.py.
        #
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

    paystack_email_token = models.CharField(max_length=100, blank=True)
    # A second secret Paystack hands us with every subscription (the
    # `email_token` field on subscription.create). Paystack's "disable
    # subscription" API needs BOTH the subscription code AND this token,
    # so without it we can't cancel on the landlord's behalf. If an older
    # row doesn't have it, payments/views.py fetches it from Paystack on
    # demand (see _email_token_for).

    paystack_plan_code = models.CharField(max_length=100, blank=True)
    # Which Paystack plan the CURRENT subscription code belongs to. Needed
    # for plan switching: when a landlord moves agent → lord, this lets us
    # tell "the new plan's first charge has landed" apart from "we've only
    # heard that a new subscription exists" — see
    # retire_superseded_subscription in payments/views.py.

    cancel_at_period_end = models.BooleanField(default=False)
    # True once the landlord cancels (POST /payments/subscription/cancel/)
    # or Paystack tells us the plan won't renew (subscription.not_renew /
    # subscription.disable). They keep their paid plan until
    # current_period_end — they've paid for that time — and then drop to
    # Free with NO grace period (a grace period is for failed renewals,
    # and a cancelled plan isn't going to renew).

    past_due_since = models.DateTimeField(null=True, blank=True)
    # When the FIRST failed renewal (invoice.payment_failed) of the
    # current problem arrived. Paystack keeps retrying the card for a few
    # days, so paddy gives a 3-day grace period from this moment before
    # pausing extra listings (payments/limits.py GRACE_PERIOD). Cleared
    # again as soon as a payment succeeds.

    superseded_subscription_code = models.CharField(max_length=100, blank=True)
    superseded_email_token = models.CharField(max_length=100, blank=True)
    # PLAN SWITCHING (agent ↔ lord). Paystack has no "change plan" call,
    # so a switch means starting a brand-new subscription on the new plan.
    # The OLD one would keep charging the landlord every month unless we
    # turn it off. When the new subscription arrives, the old code/token
    # move into these two fields; once the new plan's charge is confirmed
    # we disable the old one at Paystack and clear these. If Paystack is
    # unreachable at that moment, the daily enforce_listing_caps command
    # retries — so the landlord never ends up paying for two plans.

    last_plan_charge_at = models.DateTimeField(null=True, blank=True)
    # When the most recent plan charge we've applied was paid (Paystack's
    # `paid_at`). A plan charge may only change this row if it's NEWER
    # than this. Why it matters: GET /payments/verify/?reference=... can
    # be called with ANY old reference, and before this field existed an
    # old charge would be applied again. A landlord who had moved from
    # lord down to agent could replay an old lord charge and get lord
    # limits back while paying the agent price. With this check, replaying
    # an older charge does nothing.

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
        # is_active() specifically means "currently paying". Listing
        # limits don't use this method: they go through
        # payments/limits.py effective_tier(), which also allows the
        # 3-day grace period and handles cancelled plans

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
        # Returns the max number of LIVE listings this row's stored tier
        # allows, or None for unlimited. Deliberately does NOT check
        # whether the plan is still paid for: enforcement code uses
        # payments/limits.py (effective_tier + live_cap_for) instead,
        # which falls back to Free once a paid plan has lapsed

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
