import hashlib
import hmac
import json
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

from accounts.models import User
from .models import LandlordSubscription, ListingUnlock
from .serializers import LandlordSubscriptionSerializer
from . import paystack


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
        return Response({
            'tier': LandlordSubscription.Tier.FREE,
            'status': LandlordSubscription.Status.INACTIVE,
            'current_period_end': None,
        })

    return Response(LandlordSubscriptionSerializer(subscription).data)


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

    listing_id = request.data.get('listing_id')

    try:
        listing = Listing.objects.get(id=listing_id)
    except Listing.DoesNotExist:
        return Response({'error': 'Listing not found'}, status=status.HTTP_404_NOT_FOUND)

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

    email = data.get('customer', {}).get('email')

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return

    subscription, _ = LandlordSubscription.objects.get_or_create(
        landlord_profile=user.landlordprofile
    )
    subscription.status = LandlordSubscription.Status.ACTIVE
    # ACTIVE here means "money genuinely moved" (charge.success only
    # fires for successful charges, and verify_transaction is only
    # trusted here when Paystack's own status says success too) — this
    # is the ONE place a subscription becomes active, never
    # subscription.create's webhook branch.

    tier = _tier_for_plan_code(_plan_code_from_paystack_data(data))
    # Paystack includes the plan that was charged directly in the
    # webhook payload — this is the AUTHORITATIVE source for which
    # tier to set, rather than us guessing based on amount (which
    # could change) or trusting anything the frontend claimed
    # earlier at initiate-time
    if tier is not None:
        subscription.tier = tier
    # If plan_code doesn't match either known plan (e.g. malformed
    # event, or a plan created outside this flow), we deliberately
    # leave `tier` untouched rather than guessing — status still
    # updates to ACTIVE, but is_active() alone doesn't grant a
    # cap upgrade if tier isn't also correctly set

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

        subscription, _ = LandlordSubscription.objects.get_or_create(
            landlord_profile=user.landlordprofile
        )
        subscription.paystack_customer_code = customer_code
        subscription.paystack_subscription_code = subscription_code

        tier = _tier_for_plan_code(_plan_code_from_paystack_data(data))
        if tier is not None:
            subscription.tier = tier
        # Tier recorded now (not at first charge) so the row already
        # names the right plan while payment is pending. Status is
        # deliberately NOT touched here — no money has moved yet, and
        # only charge.success below may mark a subscription ACTIVE.

        period_end = _period_end_from_paystack_data(data)
        if period_end is not None:
            subscription.current_period_end = period_end
        # subscription.create's data IS the Subscription resource, whose
        # next_payment_date is top-level — this is the reliable source
        # for the period end. Stored now so that even if a later
        # charge.success arrives without date info, the row isn't left
        # dateless (which is_active() would treat as inactive).

        subscription.save()

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

        subscription.save()

    elif event == 'invoice.payment_failed':
        email = data.get('customer', {}).get('email')

        try:
            user = User.objects.get(email=email)
            subscription = LandlordSubscription.objects.get(landlord_profile=user.landlordprofile)
            subscription.status = LandlordSubscription.Status.PAST_DUE
            subscription.save()
        except (User.DoesNotExist, LandlordSubscription.DoesNotExist):
            pass
            # Nothing sensible to do if either doesn't exist — same
            # "don't fail the webhook over it" reasoning as above

    return Response(status=status.HTTP_200_OK)
    # Always acknowledge receipt with 200, for every event type we don't
    # explicitly handle too (e.g. subscription.expiring_cards) — a
    # non-200 response tells Paystack "retry this later", which we only
    # want for genuine failures on OUR end, not "we simply don't act on
    # this particular event type"

paystack_webhook.throttle_scope = 'webhook'
