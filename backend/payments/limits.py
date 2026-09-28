"""
Listing limits: how many listings a landlord may have, and what happens
when their paid plan runs out.

Every rule about listing limits lives in THIS file, so the create check,
the submit-for-review check, the subscription card numbers, the webhooks
and the daily cleanup command all agree with each other. If one of them
counted listings differently from another, a landlord could see "2 of 3
used" on their card and still be told "limit reached" when they submit.

The rules (Kelvin's decisions, 2026-09-28 — see AGENTS.md):

1. LIVE limit. A listing is "live" while it's `published` or
   `pending_review`. Free = 3 live, paddy agent = 10, paddy lord =
   unlimited (LandlordSubscription.LISTING_CAPS). Checked when a
   landlord submits a listing for review.

2. FREE TOTAL limit. A Free landlord may have at most 10 listings in
   total. Rejected and paused listings count; archived and leased ones
   don't. So a Free landlord can hold 3 live + up to 7 drafts. Paid plans
   have no total limit. Checked when a landlord creates a listing.

3. LAPSE. When a paid plan runs out, listings above the new limit are
   set to `paused` (hidden from the public, restored automatically once
   the landlord pays again). The OLDEST listings by `published_at` stay
   live; the newest are paused first.

4. GRACE. A failed renewal (or a renewal we simply haven't heard about
   yet) gets 3 days before anything is paused, because Paystack retries
   the card during that time. A plan the landlord CANCELLED gets no grace:
   it ends exactly at current_period_end.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import LandlordProfile
from listings.models import Listing
# Imported at the top here (not lazily inside functions like some other
# cross-app imports in this codebase): listings/models.py never imports
# anything from payments, so there's no import loop to avoid.

from .models import LandlordSubscription


FREE_TOTAL_LISTING_CAP = 10
# Rule 2 above. A plain constant rather than an entry in LISTING_CAPS,
# because it's a different KIND of limit (total listings, any status) and
# only exists for the Free tier.

GRACE_PERIOD = timedelta(days=3)
# Rule 4 above. Kelvin chose 3 days (2026-09-28).

LIVE_STATUSES = (Listing.Status.PUBLISHED, Listing.Status.PENDING_REVIEW)
# Statuses that use up a live slot (rule 1).

NOT_COUNTED_IN_FREE_TOTAL = (Listing.Status.ARCHIVED, Listing.Status.LEASED)
# Statuses that DON'T count toward the Free 10-listing total (rule 2).
# Everything else does: draft, pending_review, published, rejected, paused.


def get_subscription(landlord_profile):
    # .filter().first() rather than .get(): most landlords have never paid,
    # so they have no LandlordSubscription row at all. That's a normal
    # state (it means Free), not an error.
    return LandlordSubscription.objects.filter(landlord_profile=landlord_profile).first()


def paid_access_ends_at(subscription):
    # The moment this landlord's paid plan stops counting. Returns None if
    # they have no paid plan to speak of (never paid, or the row is
    # incomplete).
    #
    # How it's worked out:
    # - No paid tier, never activated, or no period end → None (Free).
    # - Cancelled (cancel_at_period_end) → exactly current_period_end. They
    #   paid up to that date, so they keep the plan until then, and not a
    #   minute longer.
    # - Otherwise the plan is meant to renew → current_period_end plus the
    #   3-day grace. If a renewal failed AFTER the period end (Paystack
    #   retrying later), the grace runs from that failure instead, which
    #   is why we take the later of the two dates.
    if subscription is None:
        return None
    if subscription.tier == LandlordSubscription.Tier.FREE:
        return None
    if subscription.status == LandlordSubscription.Status.INACTIVE:
        return None
        # INACTIVE = money never moved for this row (or staff switched it
        # off). Only ACTIVE and PAST_DUE rows ever had a real paid period.
    if subscription.current_period_end is None:
        return None
        # Same fail-safe as is_active(): a paid row with no known end date
        # is treated as not paid, never as "paid forever".

    if subscription.cancel_at_period_end:
        return subscription.current_period_end

    grace_starts = subscription.current_period_end
    if subscription.past_due_since and subscription.past_due_since > grace_starts:
        grace_starts = subscription.past_due_since
    return grace_starts + GRACE_PERIOD


def effective_tier(subscription, now=None):
    # The tier whose limits apply RIGHT NOW. This is what every limit
    # check uses, instead of reading `subscription.tier` directly: the
    # stored tier still says "agent" after an agent plan has lapsed (so
    # the landlord can see what they used to have), but the limits that
    # apply are Free's.
    now = now or timezone.now()
    ends_at = paid_access_ends_at(subscription)
    if ends_at is not None and ends_at > now:
        return subscription.tier
    return LandlordSubscription.Tier.FREE


def live_cap_for(tier):
    # Rule 1. None means unlimited.
    return LandlordSubscription.LISTING_CAPS[tier]


def usage_for(landlord_profile, now=None):
    # Everything the subscription card needs, worked out in one place.
    # Returned by GET /payments/subscription/ so the frontend shows the
    # SAME numbers the backend enforces, instead of counting on its own.
    subscription = get_subscription(landlord_profile)
    tier = effective_tier(subscription, now)
    listings = Listing.objects.filter(landlord_profile=landlord_profile)

    is_free = tier == LandlordSubscription.Tier.FREE
    total = listings.exclude(status__in=NOT_COUNTED_IN_FREE_TOTAL).count()

    return {
        'effective_tier': tier,
        'listings_used': listings.filter(status__in=LIVE_STATUSES).count(),
        'listing_cap': live_cap_for(tier),
        'listings_paused': listings.filter(status=Listing.Status.PAUSED).count(),
        'listings_draft': listings.filter(status=Listing.Status.DRAFT).count(),
        'listings_total': total if is_free else None,
        'listing_total_cap': FREE_TOTAL_LISTING_CAP if is_free else None,
        # The total/draft limit only exists on Free, so for paid plans we
        # send None ("no limit") rather than a number the card might
        # show as if it mattered.
    }


def lock_landlord(landlord_profile):
    # Locks this landlord's row in the database until the surrounding
    # transaction ends. MUST be called inside `transaction.atomic()`.
    #
    # WHY: every limit check here is "count, then act". Without a lock,
    # two requests arriving at the same moment (a double-click on Submit,
    # or two tabs) could both count 2 live listings, both decide there's
    # room for a 3rd, and both go ahead — ending at 4 of 3.
    # select_for_update() makes the second request wait until the first
    # has finished, so it counts 3 and is correctly refused.
    return LandlordProfile.objects.select_for_update().get(pk=landlord_profile.pk)


def enforce_listing_caps(landlord_profile, now=None):
    # Makes this landlord's live listings match the limit that applies
    # right now. Safe to call as often as you like: if nothing needs to
    # change, nothing changes. Called by the daily enforce_listing_caps
    # command, by the Paystack webhooks, when staff publish a listing, and
    # when a landlord archives one.
    #
    # Returns (paused_ids, restored_ids) so callers/tests can see what
    # happened.
    with transaction.atomic():
        lock_landlord(landlord_profile)

        cap = live_cap_for(effective_tier(get_subscription(landlord_profile), now))
        listings = Listing.objects.filter(landlord_profile=landlord_profile)

        oldest_first = [
            F('published_at').asc(nulls_last=True),
            'id',
        ]
        # "Oldest by published_at stays live" (Kelvin, 2026-09-28).
        # nulls_last: a listing with no published_at (e.g. one staff set
        # to published by hand in the admin) has no known age, so it's
        # treated as the newest. 'id' breaks ties so the result is always
        # the same, run after run — otherwise two listings published in the
        # same second could swap places every day.

        paused_ids = []
        restored_ids = []

        if cap is not None:
            published = list(
                listings.filter(status=Listing.Status.PUBLISHED)
                .order_by(*oldest_first)
                .values_list('id', flat=True)
            )
            paused_ids = published[cap:]
            # Keep the first `cap` (the oldest), pause the rest.
            #
            # Only PUBLISHED listings are paused here, never ones in
            # review (Kelvin's decision: let review finish). A listing
            # that's approved while its landlord is over the limit is
            # the newest published listing, so the next call (which
            # review_listing makes straight away) pauses it.
            if paused_ids:
                Listing.objects.filter(id__in=paused_ids).update(status=Listing.Status.PAUSED)
                # .update() writes all of them in one query.

        paused_now = listings.filter(status=Listing.Status.PAUSED).exclude(id__in=paused_ids)
        if paused_now.exists():
            live = listings.filter(status__in=LIVE_STATUSES).count()
            free_slots = None if cap is None else max(cap - live, 0)
            # Restoring: bring paused listings back, oldest first, until
            # the live limit is full again. Listings in review take a slot
            # too (rule 1), so they're counted in `live`.
            to_restore = paused_now.order_by(*oldest_first).values_list('id', flat=True)
            if free_slots is not None:
                to_restore = to_restore[:free_slots]
            restored_ids = list(to_restore)
            if restored_ids:
                Listing.objects.filter(id__in=restored_ids).update(status=Listing.Status.PUBLISHED)
                # Straight back to PUBLISHED, not to review: these
                # listings were already verified by staff and only went
                # offline because of billing. That's what makes pausing
                # different from archiving (which does need re-review).

    return paused_ids, restored_ids
