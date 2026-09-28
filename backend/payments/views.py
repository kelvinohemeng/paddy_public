import hashlib
import hmac
import json
import logging
# hashlib/hmac — Python's standard cryptography toolkit, used here to
# verify a webhook's signature. json — needed because we verify against
# the RAW request body bytes, before DRF parses it into request.data

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response

from accounts.models import User, LandlordProfile
from accounts.permissions import require_verified_email
from .models import LandlordSubscription, ListingUnlock
from .serializers import LandlordSubscriptionSerializer
from . import limits, paystack

logger = logging.getLogger(__name__)
# Same module-level logger pattern as payments/paystack.py and
# accounts/views.py — messages are tagged with this module's name
# ("payments.views"), so they're easy to find in the server logs


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
def initiate_subscription(request):
    # A landlord hits this when they need to upgrade beyond what their
    # current tier allows. Same @api_view function-based pattern as
    # accounts/views.py's register/login, rather than a ModelViewSet —
    # this isn't standard CRUD on a resource, it's a single specific action

    user = request.user

    if user.role != User.Role.LANDLORD:
        return Response(
            {'error': 'Only landlords can subscribe'}, status=status.HTTP_403_FORBIDDEN
        )

    require_verified_email(user, 'start a subscription')
    # See accounts/permissions.py — no money moves until we know the
    # email is real (it's where Paystack sends the receipt, and the key
    # the webhook uses to find this landlord again). This RAISES rather
    # than returning a Response: @api_view catches DRF exceptions and
    # turns them into the 403 response for us, same as in a ViewSet.

    requested_tier = request.data.get('tier')
    # 'agent' or 'lord' — which paid tier they're trying to upgrade to.
    # Deliberately NOT accepting 'free' here — you can't "subscribe" to
    # the free tier, it's just the default state

    plan_codes = {
        LandlordSubscription.Tier.AGENT: settings.PAYSTACK_AGENT_PLAN_CODE,
        LandlordSubscription.Tier.LORD: settings.PAYSTACK_LORD_PLAN_CODE,
    }

    plan_code = plan_codes.get(requested_tier)

    if not plan_code:
        return Response(
            {'error': 'Invalid tier. Must be "agent" or "lord".'}, status=status.HTTP_400_BAD_REQUEST
        )
        # Covers both a genuinely invalid tier string AND the case where
        # the matching settings value is still empty (plan not yet
        # created / not in .env) — either way, we can't proceed

    landlord_profile = user.landlordprofile

    subscription, _ = LandlordSubscription.objects.get_or_create(landlord_profile=landlord_profile)
    # get_or_create — same tool as google_login's user lookup. Most
    # landlords won't have a LandlordSubscription row yet (it's only
    # created the first time they ever try to pay), this creates one on
    # the spot, defaulting to Tier.FREE/Status.INACTIVE, rather than
    # requiring a separate signup-time step

    if limits.effective_tier(subscription) == requested_tier:
        return Response(
            {
                'error': f'You are already on {subscription.get_tier_display()}.',
                'code': 'already_on_plan',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Paying for the plan you already have would start a SECOND Paystack
    # subscription on the same plan — two monthly charges for one plan.
    # (Resuming a plan you've cancelled isn't supported yet; once it has
    # run out, subscribing again works normally.)

    if subscription.superseded_subscription_code:
        return Response(
            {
                'error': 'Your last plan change is still being finalised. Please try again in a few minutes.',
                'code': 'plan_change_pending',
            },
            status=status.HTTP_409_CONFLICT,
        )
    # PLAN SWITCHING: a switch leaves the old Paystack subscription in
    # superseded_subscription_code until it has been turned off. Starting
    # another switch before that happens would push a THIRD subscription
    # into the picture and we could lose track of the second one — which
    # would then keep charging the landlord. So one switch at a time.
    # 409 Conflict = "the request is fine, but not right now".
    #
    # HOW A SWITCH WORKS (agent ↔ lord), start to finish:
    #   1. The landlord pays for the new plan here, exactly like a first
    #      subscription. Paystack creates a NEW subscription.
    #   2. subscription.create webhook: the new code is stored, and the
    #      old code moves to superseded_subscription_code. The landlord
    #      keeps the OLD plan's limits for now.
    #   3. charge.success for the new plan: the tier switches, and only
    #      then is the old Paystack subscription disabled
    #      (retire_superseded_subscription below). If the landlord moved
    #      DOWN (lord → agent), listings over the new limit are paused,
    #      newest first.
    # The new plan is charged in full straight away. Paystack can't
    # prorate, so unused time on the old plan isn't refunded.

    result = paystack.initialize_transaction(
        email=user.email,
        amount_kobo=int(request.data.get('amount_kobo')),
        # Sent from the frontend rather than hardcoded here, since the
        # actual GHS price of the plan lives in Paystack's Plan object,
        # not duplicated in our own code — though in practice this
        # should match the real plan price; Paystack's plan param
        # OVERRIDES whatever amount we send anyway, per their docs, so
        # this value mostly just needs to be a valid positive number
        callback_url=request.data.get('callback_url', ''),
        plan_code=plan_code,
    )

    if not result.get('status'):
        # Paystack's own top-level "status" boolean — True means the
        # API call itself succeeded (not the eventual PAYMENT, just
        # that Paystack accepted our request), False means something
        # was wrong with our request itself
        return Response({'error': result.get('message', 'Could not start payment')}, status=status.HTTP_400_BAD_REQUEST)

    return Response(result['data'])
    # result['data'] contains authorization_url + access_code + reference
    # — exactly what the frontend needs to open Paystack's Popup

initiate_subscription.throttle_scope = 'payments'
# Protects OUR server from a bug or malicious client hammering this
# endpoint, which would in turn hammer Paystack's real API on our
# behalf — repeated rapid-fire calls here could trigger Paystack's own
# abuse detection against our account, or just waste real API quota


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_subscription(request):
    # Lets the frontend check "does this landlord currently have an
    # active subscription" — e.g. to decide whether to show a paywall
    # before letting them start creating a new listing

    user = request.user

    if user.role != User.Role.LANDLORD:
        return Response({'error': 'Only landlords have subscriptions'}, status=status.HTTP_403_FORBIDDEN)

    subscription = LandlordSubscription.objects.filter(landlord_profile=user.landlordprofile).first()
    # .filter(...).first() instead of .get(...) — deliberately returns
    # None rather than raising DoesNotExist for a landlord who's never
    # attempted to pay at all yet (no row exists), which is a
    # completely normal, expected state, not an error

    if subscription is None:
        data = {
            'tier': LandlordSubscription.Tier.FREE,
            'status': LandlordSubscription.Status.INACTIVE,
            'current_period_end': None,
            'cancel_at_period_end': False,
        }
    else:
        data = dict(LandlordSubscriptionSerializer(subscription).data)

    data['paid_access_ends_at'] = limits.paid_access_ends_at(subscription)
    data.update(limits.usage_for(user.landlordprofile))
    return Response(data)
    # The usage numbers (listings_used / listing_cap, and for Free
    # listings_total / listing_total_cap) come from payments/limits.py —
    # the SAME code that enforces the limits. The subscription card
    # shows these instead of counting listings itself, so the card and
    # the "limit reached" error can never disagree.
    # effective_tier is the tier whose limits apply right now: `tier`
    # can still say "agent" after an agent plan has run out.
    # paid_access_ends_at is when the paid plan stops counting (period
    # end, plus the 3-day grace unless the plan was cancelled) — None on
    # Free.


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
def cancel_subscription(request):
    # POST /payments/subscription/cancel/ — the landlord stops their paid
    # plan from renewing. They keep it until current_period_end (they've
    # paid for that time), then drop to Free with no grace period.
    #
    # Deliberately NOT gated on a verified email (unlike subscribing):
    # stopping charges should never be blocked.

    user = request.user
    if user.role != User.Role.LANDLORD:
        return Response({'error': 'Only landlords have subscriptions'}, status=status.HTTP_403_FORBIDDEN)

    subscription = limits.get_subscription(user.landlordprofile)
    if subscription is None or limits.effective_tier(subscription) == LandlordSubscription.Tier.FREE:
        return Response(
            {'error': 'You are not on a paid plan.', 'code': 'no_paid_plan'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if subscription.cancel_at_period_end:
        return Response(
            {'error': 'Your plan is already cancelled.', 'code': 'already_cancelled'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    for code, token in (
        (subscription.paystack_subscription_code, subscription.paystack_email_token),
        (subscription.superseded_subscription_code, subscription.superseded_email_token),
    ):
        if code and not _disable_at_paystack(code, token):
            return Response(
                {'error': 'Could not reach Paystack to cancel your plan. Nothing has changed; please try again.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
    # Turn off EVERY Paystack subscription this landlord has with us: the
    # current one and, mid-switch, the old one too. "Cancel" has to mean
    # no more charges at all.
    # If Paystack can't be reached we say so and change nothing here.
    # The worst outcome would be telling the landlord "cancelled" while
    # Paystack keeps charging them. 502 Bad Gateway = "a service we rely
    # on failed".
    # A row with no Paystack code (e.g. staff granted the plan by hand in
    # the admin) has nothing to turn off at Paystack; the flag below is
    # enough.

    subscription.cancel_at_period_end = True
    subscription.superseded_subscription_code = ''
    subscription.superseded_email_token = ''
    subscription.save(update_fields=[
        'cancel_at_period_end', 'superseded_subscription_code', 'superseded_email_token', 'updated_at',
    ])
    # Paystack will also send subscription.not_renew for this, which sets
    # the same flag again — harmless.

    data = dict(LandlordSubscriptionSerializer(subscription).data)
    data['paid_access_ends_at'] = limits.paid_access_ends_at(subscription)
    data.update(limits.usage_for(user.landlordprofile))
    return Response(data)

cancel_subscription.throttle_scope = 'payments'
# Calls Paystack's real API, so it gets the same rate limit as the other
# payment endpoints.


PAYSTACK_ALREADY_STOPPED = ('non-renewing', 'cancelled', 'complete', 'completed')
# Paystack subscription statuses that mean "won't be charged again".


def _disable_at_paystack(code, token):
    # Turns off one Paystack subscription. Returns True once it's
    # definitely not going to renew, False if we couldn't make sure (the
    # caller then keeps the old state and tries again later).
    #
    # `token` is the subscription's email_token, which Paystack requires
    # alongside the code. Older rows didn't store it, so if it's missing
    # we ask Paystack for it.
    details = None
    if not token:
        details = paystack.fetch_subscription(code)
        token = (details.get('data') or {}).get('email_token') if details.get('status') else None
        if not token:
            logger.error('Could not get the email token for Paystack subscription %s: %s', code, details.get('message'))
            return False

    result = paystack.disable_subscription(code, token)
    if result.get('status'):
        return True

    # Paystack also refuses to disable a subscription that's ALREADY
    # disabled (for example, the landlord used the cancel link in
    # Paystack's own email). That's still the outcome we want, so check
    # the subscription's status before treating this as a failure.
    details = paystack.fetch_subscription(code)
    paystack_status = (details.get('data') or {}).get('status') if details.get('status') else None
    if paystack_status in PAYSTACK_ALREADY_STOPPED:
        return True

    logger.error('Could not disable Paystack subscription %s: %s', code, result.get('message'))
    return False


def _plan_switch_confirmed(subscription):
    # True once the plan named by the CURRENT Paystack subscription
    # (paystack_plan_code) has actually been paid for: a charge.success for
    # it set the row ACTIVE on that plan's tier.
    current_plan_tier = _tier_for_plan_code(subscription.paystack_plan_code)
    return (
        subscription.status == LandlordSubscription.Status.ACTIVE
        and current_plan_tier is not None
        and subscription.tier == current_plan_tier
    )


def retire_superseded_subscription(subscription):
    # PLAN SWITCHING, step 3 (see initiate_subscription for the full
    # story): turn off the OLD Paystack subscription, but only once the
    # NEW plan's charge has been confirmed. Returns True when there's
    # nothing left to retire.
    #
    # Called from the webhooks (subscription.create and charge.success,
    # which can arrive in either order) and from the daily
    # enforce_listing_caps command, which retries if Paystack was down.
    if not subscription.superseded_subscription_code:
        return True

    new_plan_confirmed = _plan_switch_confirmed(subscription)
    # "Confirmed" = a charge.success for the new plan has already set the
    # tier to that plan. Until then the old plan keeps running, so the
    # landlord is never left with no working plan if the new payment
    # somehow doesn't land.
    if not new_plan_confirmed:
        return False

    if not _disable_at_paystack(
        subscription.superseded_subscription_code, subscription.superseded_email_token
    ):
        return False
        # Paystack unreachable: keep the old code so the daily command
        # tries again. Better to retry than to forget about a
        # subscription that would keep charging.

    subscription.superseded_subscription_code = ''
    subscription.superseded_email_token = ''
    subscription.save(update_fields=['superseded_subscription_code', 'superseded_email_token', 'updated_at'])
    return True


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
def initiate_listing_unlock(request):
    # ANY authenticated user hits this — renter, or a landlord without
    # an active subscription browsing someone else's listing. Unlike
    # initiate_subscription, there's no role check here at all: the
    # actual "who needs to pay" decision already happened inside
    # ListingSerializer._has_access — if someone reaches this endpoint
    # for a listing they already have free access to, that's harmless
    # (they'd just be paying for something they didn't need to), not a
    # security problem worth blocking here

    from listings.models import Listing
    # Imported here, not at the top — same circular-import avoidance
    # reasoning as ListingUnlock.listing being a string reference:
    # listings/views.py already imports FROM payments, so payments
    # importing FROM listings at module load time would create a loop

    require_verified_email(request.user, 'unlock a listing')
    # See accounts/permissions.py — same "no payment before a proven
    # email" rule as initiate_subscription above.

    listing_id = request.data.get('listing_id')

    try:
        listing = Listing.objects.get(id=listing_id, status=Listing.Status.PUBLISHED)
    except (Listing.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'Listing not found'}, status=status.HTTP_404_NOT_FOUND)
    # status=PUBLISHED — only live listings can be paid for. Before this,
    # someone could pay to unlock a draft, a rejected listing, or a home
    # that's already leased — paying for contact details of a place they
    # can't actually rent (and, for drafts, revealing an address staff
    # haven't verified yet). Treated as "not found" so we don't confirm
    # to strangers that a hidden listing exists.
    # ValueError/TypeError — a listing_id like "abc" makes the lookup
    # itself fail before it can say DoesNotExist; without catching these
    # that bad input was a 500 instead of a clean 404.

    if ListingUnlock.objects.filter(user=request.user, listing=listing).exists():
        return Response(
            {'error': 'You have already unlocked this listing'}, status=status.HTTP_400_BAD_REQUEST
        )
        # Guard against paying twice for the same listing — cheap check
        # here saves the user from an avoidable duplicate charge; the
        # database's unique_together constraint is the REAL backstop
        # (see ListingUnlock.Meta) in case this check and the webhook
        # ever raced each other, but failing fast here is better UX

    result = paystack.initialize_transaction(
        email=request.user.email,
        amount_kobo=settings.LISTING_UNLOCK_PRICE_PESEWAS,
        # From OUR settings, never request.data — see the comment on
        # LISTING_UNLOCK_PRICE_PESEWAS in settings.py for why this one
        # specifically can't be trusted from the frontend the way
        # initiate_subscription's amount_kobo safely can be

        callback_url=request.data.get('callback_url', ''),
        metadata={
            'purpose': 'listing_unlock',
            'listing_id': listing.id,
            'user_id': request.user.id,
        },
        # This is how paystack_webhook will know WHICH listing this
        # charge was for, once Paystack confirms it — see charge.success
        # handling below. user_id is included too, even though the
        # webhook could also look the user up by email like the
        # subscription flow does — being explicit here means the
        # webhook doesn't need to assume request.user.email at
        # payment-time still matches their email later (e.g. if they
        # changed it in between)
    )

    if not result.get('status'):
        return Response({'error': result.get('message', 'Could not start payment')}, status=status.HTTP_400_BAD_REQUEST)

    return Response(result['data'])

initiate_listing_unlock.throttle_scope = 'payments'
# Same reasoning as initiate_subscription — protects against a client
# hammering this endpoint into repeatedly calling Paystack's real API


UNLOCK_CURRENCY = 'GHS'
# Every unlock is priced in Ghana cedis (LISTING_UNLOCK_PRICE_PESEWAS is
# in pesewas, 1/100 of a cedi). Kept as a named constant rather than a
# bare 'GHS' string inside the check below, so it's obvious what the
# price setting is denominated in.


def _unlock_charge_paid_in_full(data):
    # Answers one question: "did the money that ACTUALLY moved cover the
    # unlock price?" Returns True only if Paystack reports a charge in
    # GHS for at least LISTING_UNLOCK_PRICE_PESEWAS.
    #
    # WHY THIS IS NEEDED — the attack it blocks:
    # initiate_listing_unlock always asks Paystack for the right price,
    # but that view is not the only way a Paystack transaction can be
    # created. Paystack's browser checkout (Paystack Inline) lets anyone
    # who has our PUBLIC key start a transaction with ANY amount and ANY
    # metadata they like — and the public key is visible in frontend
    # code by design. So someone could:
    #   1. start their own GH¢0.01 transaction with metadata
    #      {"purpose": "listing_unlock", "listing_id": 42, "user_id": <me>}
    #   2. pay the pesewa
    #   3. call GET /payments/verify/?reference=<that reference>
    # Paystack would truthfully report "status: success", and before this
    # check we'd grant the unlock because the metadata said so.
    #
    # The fix is to trust only the fields Paystack fills in itself from
    # the real payment: `amount` (always in the smallest currency unit,
    # i.e. pesewas) and `currency`. Metadata is still used, but only to
    # know WHICH listing and user the payment was for — never as proof of
    # payment.
    #
    # ">=" rather than "==": if someone somehow paid MORE, they still
    # paid enough. The case that fails honestly is a price RISE between
    # a customer starting checkout and finishing it — that's logged by
    # the caller so staff can grant it by hand.
    amount = data.get('amount')
    if not isinstance(amount, int) or isinstance(amount, bool):
        return False
    # Paystack sends amount as a whole number (e.g. 500 = GH¢5.00).
    # Anything else (missing, a string, a float) means we can't be sure
    # what was paid, so we refuse. `bool` is excluded explicitly because
    # in Python True/False count as ints (True == 1) — a quirk worth
    # knowing.

    if data.get('currency') != UNLOCK_CURRENCY:
        return False
    # Without this, 500 of some OTHER currency's smallest unit would
    # pass the amount check below even if it's worth far less.

    return amount >= settings.LISTING_UNLOCK_PRICE_PESEWAS


def _handle_successful_charge(data):
    # THE shared core of "a charge genuinely succeeded" handling —
    # extracted so both the webhook's charge.success branch AND the new
    # synchronous verify_transaction endpoint below can run the EXACT
    # same unlock/subscription-activation logic, instead of two
    # near-identical copies that could silently drift apart over time.
    # Returns nothing; every branch already returns early/acknowledges
    # via the caller, this function's whole job is just the DB writes.

    metadata = data.get('metadata') or {}
    # metadata is OUR OWN data, round-tripped back to us unchanged —
    # set by whichever initiate_* view started this specific charge.
    # subscription charges never set metadata at all (see
    # initiate_subscription — no metadata= argument passed there),
    # so metadata.get('purpose') is None for those, which is exactly
    # what lets us tell the two charge types apart below

    if metadata.get('purpose') == 'listing_unlock':
        # A one-off listing-unlock charge, NOT a subscription
        # payment — handled completely separately below, never
        # falls through to the subscription logic beneath this block

        from listings.models import Listing
        # Imported here, same circular-import reasoning as the
        # initiate_listing_unlock view above

        try:
            user = User.objects.get(id=metadata.get('user_id'))
            listing = Listing.objects.get(id=metadata.get('listing_id'))
        except (User.DoesNotExist, Listing.DoesNotExist):
            return
            # Nothing sensible to do with a malformed/stale metadata
            # payload — same "don't fail over it" reasoning as every
            # other not-found case in this file

        if not _unlock_charge_paid_in_full(data):
            logger.warning(
                'Refusing listing unlock for reference %s: paid %s %s, expected at least %s GHS pesewas '
                '(user id %s, listing id %s).',
                data.get('reference', ''), data.get('amount'), data.get('currency'),
                settings.LISTING_UNLOCK_PRICE_PESEWAS, user.id, listing.id,
            )
            return
        # SECURITY — never grant an unlock based on metadata alone. See
        # _unlock_charge_paid_in_full below for the full explanation of
        # the attack this blocks. In short: metadata says WHAT the payer
        # wants, but only `amount` + `currency` (filled in by Paystack
        # itself, from the money that actually moved) say whether they
        # PAID for it.
        #
        # We log a warning instead of raising an error: the caller still
        # answers Paystack's webhook with 200 (so Paystack stops
        # retrying an event that will never succeed), and the log line
        # gives staff the reference to look up if a real customer ever
        # reports "I paid but nothing unlocked" (e.g. if the price was
        # raised between their checkout starting and finishing).

        ListingUnlock.objects.get_or_create(
            user=user,
            listing=listing,
            defaults={'paystack_reference': data.get('reference', '')},
        )
        # get_or_create rather than a plain .create() — protects
        # against a genuine edge case: Paystack CAN deliver the same
        # webhook event more than once (their own docs say webhooks
        # aren't guaranteed exactly-once), AND this same helper can now
        # also be called twice for the same charge (once by the
        # frontend's synchronous verify call, once by the async
        # webhook) — get_or_create makes either kind of duplicate a
        # harmless no-op rather than a 500 from the unique_together
        # constraint on ListingUnlock.Meta

        return

    tier = _tier_for_plan_code(_plan_code_from_paystack_data(data))
    # Paystack includes the plan that was charged directly in the
    # webhook payload — this is the AUTHORITATIVE source for which
    # tier to set, rather than us guessing based on amount (which
    # could change) or trusting anything the frontend claimed
    # earlier at initiate-time

    if tier is None:
        return
    # SECURITY — only a charge made against one of OUR paid plans may
    # touch a subscription. Previously any successful charge that wasn't
    # an unlock fell through to here and flipped the payer's
    # subscription to ACTIVE, even with no plan attached at all. That
    # mattered because charges don't only come from our own
    # initiate_* views: anyone holding our Paystack PUBLIC key (it ships
    # in frontend code, so assume everyone has it) can start their own
    # transaction for any amount. A landlord whose card had failed
    # (PAST_DUE, but current_period_end still in the future) could pay
    # GH¢0.01 with no plan and come back as ACTIVE — i.e. get their paid
    # listing cap back for a pesewa.
    #
    # With a plan attached, Paystack itself enforces the plan's price
    # (the amount can't be chosen by the payer), so "has a known plan"
    # is the right test for "this is a genuine subscription payment".
    #
    # This return also happens BEFORE any user/landlord lookup, so a
    # renter's stray non-plan charge no longer crashes on
    # user.landlordprofile below (renters don't have one).

    email = data.get('customer', {}).get('email')

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return

    landlord_profile = LandlordProfile.objects.filter(user=user).first()
    if landlord_profile is None:
        return
    # .filter(...).first() returns None instead of raising, unlike
    # `user.landlordprofile`, which raises RelatedObjectDoesNotExist when
    # the row is missing — that exception was an unhandled 500, and
    # Paystack keeps re-sending a webhook that 500s. A plan charge from a
    # user with no landlord profile has nothing to activate, so we just
    # stop.

    subscription, _ = LandlordSubscription.objects.get_or_create(
        landlord_profile=landlord_profile
    )

    if (
        subscription.superseded_subscription_code
        and _plan_switch_confirmed(subscription)
        and tier != subscription.tier
    ):
        logger.error(
            'Plan charge for %s on the OLD plan (%s) after switching to %s; reference %s. '
            'The old Paystack subscription %s should have been disabled — staff may need to refund this charge.',
            email, tier, subscription.tier, data.get('reference', ''),
            subscription.superseded_subscription_code,
        )
        retire_superseded_subscription(subscription)
        return
    # PLAN SWITCHING safety net. The landlord has already switched plans
    # (the new plan's charge was confirmed), but turning off the OLD
    # Paystack subscription hasn't succeeded yet (e.g. Paystack was down),
    # and now the old one has renewed. Applying this charge would flip the
    # landlord back to the plan they left. Instead: keep the new plan, try
    # again to turn the old one off, and log it loudly so staff can refund
    # the charge that shouldn't have happened.
    paid_at = _parse_paid_at(data)
    if (
        paid_at is not None
        and subscription.last_plan_charge_at is not None
        and paid_at <= subscription.last_plan_charge_at
    ):
        if tier != subscription.tier:
            logger.warning(
                'Ignoring an older %s plan charge for %s (reference %s, paid %s; newest applied %s). '
                'If this was a real new payment that arrived late, staff should check the tier by hand.',
                tier, email, data.get('reference', ''), paid_at, subscription.last_plan_charge_at,
            )
        return
    # SECURITY — only a plan charge NEWER than the last one we applied may
    # change the subscription. GET /payments/verify/?reference=... accepts
    # ANY reference, including months-old ones, and runs them through this
    # function again. Without this check, a landlord who moved from lord
    # down to agent could re-verify an old lord charge and get lord limits
    # back while paying the agent price. "<=" also makes a repeated
    # delivery of the SAME charge (Paystack may send a webhook twice, and
    # verify + webhook both run for one charge) a harmless no-op.
    # A payload with no paid_at is still applied as before — real Paystack
    # charge data always has one.

    subscription.status = LandlordSubscription.Status.ACTIVE
    # ACTIVE here means "money genuinely moved for a real plan"
    # (charge.success only fires for successful charges, verify_payment
    # only calls this when Paystack's own status says success, and the
    # tier check above guarantees a known plan) — this is the ONE place a
    # subscription becomes active, never subscription.create's webhook
    # branch.

    subscription.tier = tier
    subscription.past_due_since = None
    # Money moved, so any earlier failed renewal is resolved and the
    # grace-period clock stops.
    if paid_at is not None:
        subscription.last_plan_charge_at = paid_at

    period_end = _period_end_from_paystack_data(data)
    if period_end is not None:
        subscription.current_period_end = period_end
    # Only overwrites when a parseable date is actually present —
    # charge.success payloads (Transaction resource) usually carry
    # NO date at all, in which case the period stored earlier by
    # subscription.create is left exactly as-is rather than wiped.
    # Without this guard, every renewal would null the period out
    # (or rather, without subscription.create storing it first,
    # paid rows ended up ACTIVE with no period and stayed gated).

    subscription.save()

    retire_superseded_subscription(subscription)
    # If this charge confirms a plan SWITCH, the old Paystack
    # subscription is turned off now, so the landlord only pays for one
    # plan. Does nothing if there's no switch in progress.

    limits.enforce_listing_caps(landlord_profile)
    # The landlord's limit may have changed: paused listings come back
    # (oldest first) after a renewal or upgrade, and a downgrade from
    # lord to agent pauses the newest listings over 10.


def _parse_paid_at(data):
    # When Paystack says the money moved. Transaction payloads carry it as
    # `paid_at` (and sometimes also `paidAt`). None if missing or
    # unreadable.
    raw = data.get('paid_at') or data.get('paidAt')
    if not isinstance(raw, str):
        return None
    return parse_datetime(raw)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
def verify_payment(request):
    # THE synchronous half of payment confirmation. Paystack's popup
    # closing on the frontend only means the CHECKOUT UI finished —
    # it says nothing about whether the charge actually succeeded, and
    # the webhook (the authoritative confirmation) can lag by seconds
    # or, in an outage, much longer. Without this endpoint, a renter/
    # landlord who just paid would stare at a frontend with no way to
    # know their unlock/subscription is live yet other than reloading
    # and hoping the webhook already landed.
    #
    # This does NOT replace the webhook as the source of truth — it
    # calls the exact same Paystack verify-transaction API the webhook
    # would eventually trust, and on success runs the EXACT same
    # _handle_successful_charge() write path. If the webhook already
    # ran first, get_or_create()/the ACTIVE-status overwrite make this
    # a harmless no-op; if this runs first, the later webhook delivery
    # becomes the no-op instead. Either order is safe.

    reference = request.query_params.get('reference')

    if not reference:
        return Response(
            {'error': 'reference is required'}, status=status.HTTP_400_BAD_REQUEST
        )

    result = paystack.verify_transaction(reference)

    if not result.get('status'):
        return Response(
            {'error': result.get('message', 'Could not verify payment')},
            status=status.HTTP_400_BAD_REQUEST,
        )

    data = result.get('data') or {}

    if data.get('status') != 'success':
        # Paystack's own per-TRANSACTION status (separate from the
        # top-level API-call-succeeded status checked above) —
        # 'abandoned'/'failed'/'pending' all mean no money moved yet,
        # so nothing should be activated
        return Response({'verified': False, 'status': data.get('status')})

    _handle_successful_charge(data)

    return Response({'verified': True, 'status': 'success'})

verify_payment.throttle_scope = 'payments'
# Same scope/reasoning as initiate_subscription/initiate_listing_unlock
# — this also proxies to Paystack's real API per call


def _verify_paystack_signature(request):
    # THE critical security check for the webhook below — confirms this
    # request genuinely came from Paystack's servers, not someone lying
    # to us. Paystack signs every webhook by computing an HMAC-SHA512
    # hash of the raw request body, using YOUR secret key, and sends
    # that hash in the x-paystack-signature header. We compute the same
    # hash ourselves and check they match — only Paystack (or someone
    # who somehow has your secret key) could produce a matching hash

    signature = request.headers.get('x-paystack-signature', '')

    computed_hash = hmac.new(
        settings.PAYSTACK_SECRET_KEY.encode('utf-8'),
        request.body,
        hashlib.sha512,
    ).hexdigest()
    # request.body — the RAW bytes of the request, before DRF parses
    # them into request.data. This matters: signature verification must
    # hash the EXACT bytes Paystack sent, not a re-serialized version,
    # since even a tiny formatting difference (key order, whitespace)
    # would produce a different hash and wrongly fail a genuine webhook

    return hmac.compare_digest(computed_hash, signature)
    # hmac.compare_digest — NOT the same as computed_hash == signature.
    # A plain == comparison exits early on the first mismatched
    # character, meaning how LONG it takes to fail can leak information
    # about how much of the guess was correct (a "timing attack").
    # compare_digest always takes the same amount of time regardless,
    # specifically to prevent that — the standard, correct way to
    # compare secrets/signatures, never plain ==


def _plan_code_from_paystack_data(data):
    # Paystack identifies the plan differently depending on the event:
    # charge events carry plan_object{plan_code} (object form) and/or
    # plan (a bare "PLN_..." code string, or occasionally the same
    # object) — subscription/invoice events nest it under their own
    # subscription/plan objects instead. Checked in that order; first
    # hit wins, None if the payload names no plan at all.
    plan_object = data.get('plan_object') or {}
    if isinstance(plan_object, dict) and plan_object.get('plan_code'):
        return plan_object.get('plan_code')

    plan = data.get('plan')
    if isinstance(plan, str) and plan:
        return plan
    if isinstance(plan, dict) and plan.get('plan_code'):
        return plan.get('plan_code')

    return None


def _tier_for_plan_code(plan_code):
    # The AUTHORITATIVE plan→tier mapping lives here, in exactly one
    # place — every webhook branch below resolves tiers through this
    # instead of each carrying its own copy that could drift (e.g. one
    # branch learning about a new tier while another still rejects it).
    # Returns None for unknown/missing codes: callers leave `tier`
    # untouched rather than guessing, per the existing convention.
    plan_code_to_tier = {
        settings.PAYSTACK_AGENT_PLAN_CODE: LandlordSubscription.Tier.AGENT,
        settings.PAYSTACK_LORD_PLAN_CODE: LandlordSubscription.Tier.LORD,
    }
    return plan_code_to_tier.get(plan_code)


def _period_end_from_paystack_data(data):
    # next_payment_date is a TOP-LEVEL field on subscription-shaped
    # payloads (subscription.create) — it is NOT inside plan_object
    # (which only ever holds id/name/plan_code/amount/interval). An
    # older revision of the charge.success branch read it from
    # plan_object, a location Paystack never sends, which is exactly
    # why paid subscriptions ended up ACTIVE with no period end and
    # stayed gated. Top-level first, plan_object kept only as a
    # harmless fallback; None when unparseable/missing so callers can
    # skip the write instead of storing garbage.
    top_level = data.get('next_payment_date')
    if top_level:
        parsed = parse_datetime(top_level)
        if parsed:
            return parsed

    plan_object = data.get('plan_object')
    if isinstance(plan_object, dict) and plan_object.get('next_payment_date'):
        parsed = parse_datetime(plan_object.get('next_payment_date'))
        if parsed:
            return parsed

    return None


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
# AllowAny — deliberately NOT IsAuthenticated. Paystack's server is the
# one calling this URL, not a logged-in paddy user — there's no JWT to
# check here at all. The signature verification below IS the real
# security check for this endpoint, replacing authentication entirely

def paystack_webhook(request):
    if not _verify_paystack_signature(request):
        return Response(status=status.HTTP_401_UNAUTHORIZED)
        # Reject immediately — never process a webhook body we can't
        # verify actually came from Paystack

    event = request.data.get('event')
    data = request.data.get('data', {})

    if event == 'subscription.create':
        customer_code = data.get('customer', {}).get('customer_code')
        subscription_code = data.get('subscription_code')
        email = data.get('customer', {}).get('email')

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(status=status.HTTP_200_OK)
            # Still return 200 even if we can't match a user — returning
            # an error status here would make Paystack think delivery
            # failed and retry the same webhook repeatedly, which won't
            # fix a genuinely missing user. Logging this properly (not
            # done yet) would be the real production fix

        landlord_profile = LandlordProfile.objects.filter(user=user).first()
        if landlord_profile is None:
            return Response(status=status.HTTP_200_OK)
        # .filter().first() instead of user.landlordprofile, which raises
        # (→ 500, and Paystack retries forever) for a user with no
        # landlord profile. Same fix as _handle_successful_charge.

        subscription, _ = LandlordSubscription.objects.get_or_create(
            landlord_profile=landlord_profile
        )

        if subscription_code and subscription_code == subscription.superseded_subscription_code:
            return Response(status=status.HTTP_200_OK)
            # A late or repeated delivery about the OLD plan we've already
            # moved away from — nothing to do.

        plan_code = _plan_code_from_paystack_data(data)
        tier = _tier_for_plan_code(plan_code)
        is_new_subscription = bool(subscription_code) and subscription_code != subscription.paystack_subscription_code
        on_paid_plan_now = limits.effective_tier(subscription) != LandlordSubscription.Tier.FREE

        if is_new_subscription and subscription.paystack_subscription_code:
            subscription.superseded_subscription_code = subscription.paystack_subscription_code
            subscription.superseded_email_token = subscription.paystack_email_token
        # PLAN SWITCHING, step 2 (see initiate_subscription): a NEW Paystack
        # subscription has arrived while we still know about an older one.
        # The old one is set aside here and turned off once the new plan's
        # charge is confirmed. This also covers someone re-subscribing
        # after a lapse: if the old subscription is still alive at
        # Paystack (e.g. stuck retrying a failed card), it gets turned off
        # too, so it can't start charging again later.

        subscription.paystack_customer_code = customer_code
        subscription.paystack_subscription_code = subscription_code
        subscription.paystack_email_token = data.get('email_token') or ''
        subscription.paystack_plan_code = plan_code or ''
        # email_token — needed later to cancel this subscription (see
        # _disable_at_paystack). plan_code — which plan this subscription
        # is on, used to tell when a switch has been paid for.

        if is_new_subscription:
            subscription.cancel_at_period_end = False
            # A brand-new subscription renews until someone cancels it.

        if tier is not None and not on_paid_plan_now:
            subscription.tier = tier
        # Tier recorded now (not at first charge) so the row already
        # names the right plan while payment is pending. Status is
        # deliberately NOT touched here — no money has moved yet, and
        # only charge.success below may mark a subscription ACTIVE.
        # EXCEPTION — a plan SWITCH: if the landlord is on a working paid
        # plan right now, they keep its tier (and its limits) until the
        # new plan's charge.success arrives. Kelvin's decision: the old
        # limit applies mid-switch.

        period_end = _period_end_from_paystack_data(data)
        if period_end is not None and (
            subscription.current_period_end is None
            or not on_paid_plan_now
            or period_end > subscription.current_period_end
        ):
            subscription.current_period_end = period_end
        # subscription.create's data IS the Subscription resource, whose
        # next_payment_date is top-level — this is the reliable source
        # for the period end. Stored now so that even if a later
        # charge.success arrives without date info, the row isn't left
        # dateless (which is_active() would treat as inactive).
        # Mid-switch we only ever move the date LATER, never earlier, so
        # a switch can't cut short time the landlord already paid for.

        subscription.save()

        retire_superseded_subscription(subscription)
        # Webhooks can arrive in either order. If the new plan's
        # charge.success already landed, the switch is confirmed and the
        # old subscription is turned off now; otherwise this does nothing
        # and charge.success will do it.

    elif event == 'charge.success':
        # Fires for BOTH the very first charge and every successful
        # renewal — the moment we actually know money genuinely moved.
        # Delegates to _handle_successful_charge, the SAME helper
        # verify_payment (above) calls — keeps the unlock/subscription
        # activation logic correct in exactly one place, whichever path
        # (webhook or synchronous frontend verify) happens to run first

        _handle_successful_charge(data)

    elif event == 'invoice.update':
        # Fires after EVERY subscription billing attempt with its final
        # status (per Paystack's lifecycle: invoice.create → charge
        # attempt → invoice.update). This is the ONLY event that
        # reliably carries the fresh next_payment_date on every cycle —
        # renewal charge.success payloads (Transaction resource) don't
        # include one — so without this branch a renewed subscription
        # keeps its FIRST period end forever and lapses out of active
        # status ~30 days after subscribing, despite successful renewals.

        if not (data.get('paid') or data.get('status') == 'success'):
            return Response(status=status.HTTP_200_OK)
            # Failed invoices are invoice.payment_failed's job below
            # (marks PAST_DUE) — a failed charge must NEVER extend
            # anyone's paid period, so we ignore it here entirely.

        invoice_sub = data.get('subscription')
        if not isinstance(invoice_sub, dict):
            return Response(status=status.HTTP_200_OK)

        subscription = None
        subscription_code = invoice_sub.get('subscription_code')
        if subscription_code and LandlordSubscription.objects.filter(
            superseded_subscription_code=subscription_code
        ).exists():
            return Response(status=status.HTTP_200_OK)
            # An invoice for an OLD plan the landlord has switched away
            # from. It must not change the period of the plan they're on
            # now. (Checked before the email fallback below, which would
            # otherwise find the landlord's row and apply it.)

        if subscription_code:
            subscription = LandlordSubscription.objects.filter(
                paystack_subscription_code=subscription_code
            ).first()

        if subscription is None:
            customer = data.get('customer')
            email = customer.get('email') if isinstance(customer, dict) else None
            if email:
                subscription = LandlordSubscription.objects.filter(
                    landlord_profile__user__email=email
                ).first()
                # Double-underscore traversal straight to the email —
                # avoids fetching the User first and sidesteps
                # RelatedObjectDoesNotExist entirely when no profile
                # exists for that email.

        if subscription is None:
            return Response(status=status.HTTP_200_OK)
            # Same "acknowledge, don't fail" reasoning as every other
            # not-found case in this view — retrying won't create the
            # missing row.

        next_payment_date = invoice_sub.get('next_payment_date')
        if next_payment_date:
            parsed = parse_datetime(next_payment_date)
            if parsed:
                subscription.current_period_end = parsed

        subscription.status = LandlordSubscription.Status.ACTIVE
        # A successful invoice means money moved — this also heals a
        # PAST_DUE row back to ACTIVE when a retry succeeds.
        subscription.past_due_since = None
        # ...and stops the grace-period clock.

        subscription.save()

        limits.enforce_listing_caps(subscription.landlord_profile)
        # A renewal that finally went through brings paused listings back.

    elif event == 'invoice.payment_failed':
        email = data.get('customer', {}).get('email')
        invoice_sub = data.get('subscription')
        failed_code = invoice_sub.get('subscription_code') if isinstance(invoice_sub, dict) else None

        if failed_code and LandlordSubscription.objects.filter(
            superseded_subscription_code=failed_code
        ).exists():
            return Response(status=status.HTTP_200_OK)
            # A failed charge on an OLD plan the landlord has switched away
            # from says nothing about the plan they're on now.

        subscription = LandlordSubscription.objects.filter(
            landlord_profile__user__email=email
        ).first() if email else None
        # Same lookup as before, written so a missing user OR a missing
        # subscription row both just give None instead of an exception.

        if subscription is not None:
            subscription.status = LandlordSubscription.Status.PAST_DUE
            if subscription.past_due_since is None:
                subscription.past_due_since = timezone.now()
            # Only the FIRST failure starts the clock. Paystack sends this
            # event again on each retry, and restarting the clock every
            # time would stretch the 3-day grace period indefinitely.
            subscription.save()

            limits.enforce_listing_caps(subscription.landlord_profile)
            # Usually nothing changes yet (the 3-day grace period applies),
            # but if the grace period has already run out, extra listings
            # are paused now rather than at the next daily run.

    elif event in ('subscription.not_renew', 'subscription.disable'):
        # subscription.not_renew — the plan was cancelled (by the landlord
        # through our cancel endpoint, through the link in Paystack's
        # email, or by staff on the Paystack dashboard). It stays paid
        # until its period ends and won't renew.
        # subscription.disable — the plan has actually ended (it reached
        # its end date after a cancel, or Paystack gave up retrying a
        # failed card).
        # Both are handled the same way: the plan won't renew, so the
        # landlord keeps it until current_period_end with no grace period
        # after that, and then drops to Free.
        subscription_code = data.get('subscription_code')
        subscription = LandlordSubscription.objects.filter(
            paystack_subscription_code=subscription_code
        ).first() if subscription_code else None
        # Matched ONLY by subscription code, never by email. When we turn
        # off an OLD plan after a switch, Paystack sends these events for
        # that old code. Looking the landlord up by email would mark their
        # NEW plan as cancelled by mistake. The old code isn't the current
        # one any more, so it simply matches nothing here.

        if subscription is not None:
            subscription.cancel_at_period_end = True
            subscription.save(update_fields=['cancel_at_period_end', 'updated_at'])
            limits.enforce_listing_caps(subscription.landlord_profile)
            # If the period is already over (disable arrives on the end
            # date), listings above the Free limit are paused now.

    return Response(status=status.HTTP_200_OK)
    # Always acknowledge receipt with 200, for every event type we don't
    # explicitly handle too (e.g. subscription.expiring_cards) — a
    # non-200 response tells Paystack "retry this later", which we only
    # want for genuine failures on OUR end, not "we simply don't act on
    # this particular event type"

paystack_webhook.throttle_scope = 'webhook'
