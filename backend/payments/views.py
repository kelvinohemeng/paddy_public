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
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from accounts.models import User
from .models import LandlordSubscription
from .serializers import LandlordSubscriptionSerializer
from . import paystack


@api_view(['POST'])
@permission_classes([IsAuthenticated])
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
        plan_code=plan_code,
        callback_url=request.data.get('callback_url', ''),
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


@api_view(['POST'])
@permission_classes([AllowAny])
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
        subscription.save()

    elif event == 'charge.success':
        # Fires for BOTH the very first charge and every successful
        # renewal — the moment we actually know money genuinely moved
        email = data.get('customer', {}).get('email')

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(status=status.HTTP_200_OK)

        subscription, _ = LandlordSubscription.objects.get_or_create(
            landlord_profile=user.landlordprofile
        )
        subscription.status = LandlordSubscription.Status.ACTIVE

        plan_object = data.get('plan_object', {}) or {}
        # Paystack includes the plan that was charged directly in the
        # webhook payload — this is the AUTHORITATIVE source for which
        # tier to set, rather than us guessing based on amount (which
        # could change) or trusting anything the frontend claimed
        # earlier at initiate-time

        plan_code = plan_object.get('plan_code')

        plan_code_to_tier = {
            settings.PAYSTACK_AGENT_PLAN_CODE: LandlordSubscription.Tier.AGENT,
            settings.PAYSTACK_LORD_PLAN_CODE: LandlordSubscription.Tier.LORD,
        }

        if plan_code in plan_code_to_tier:
            subscription.tier = plan_code_to_tier[plan_code]
        # If plan_code doesn't match either known plan (e.g. malformed
        # event, or a plan created outside this flow), we deliberately
        # leave `tier` untouched rather than guessing — status still
        # updates to ACTIVE, but is_active() alone doesn't grant a
        # cap upgrade if tier isn't also correctly set

        next_payment_date = plan_object.get('next_payment_date')
        if next_payment_date:
            parsed = parse_datetime(next_payment_date)
            if parsed:
                subscription.current_period_end = parsed
        # parse_datetime — Django's helper for turning an ISO-format
        # string (which is what Paystack sends) into a real Python
        # datetime object DateTimeField can store. Guarded with `if
        # parsed` since parse_datetime returns None on malformed input
        # rather than raising, so we don't want to silently overwrite a
        # valid existing date with an unparseable one

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
