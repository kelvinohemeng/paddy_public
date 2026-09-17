import logging

import requests
from django.conf import settings

BASE_URL = 'https://api.paystack.co'

# Every real request to Paystack's API MUST have a timeout — without
# one, requests.post()/requests.get() will hang indefinitely if
# Paystack's servers are slow or unreachable, tying up a Django worker
# for the life of that hang. Under load, enough hung requests exhaust
# the whole worker pool and take the app down for every user, not just
# whoever triggered the slow call. (connect_timeout, read_timeout) —
# connect is how long to wait for the TCP handshake, read is how long
# to wait for Paystack to actually respond once connected; these are
# deliberately different budgets since a dead network fails fast on
# connect, while a slow-but-alive Paystack needs more read headroom.
REQUEST_TIMEOUT = (5, 15)

logger = logging.getLogger(__name__)


def _headers():
    # A small shared helper — every Paystack call needs this exact same
    # Authorization header, so we build it once here instead of
    # repeating the same dict literal in every function below
    return {
        'Authorization': f'Bearer {settings.PAYSTACK_SECRET_KEY}',
        'Content-Type': 'application/json',
    }


def _request(method, url, **kwargs):
    # THE single place every Paystack HTTP call actually goes through —
    # both initialize_transaction and verify_transaction call this
    # instead of requests.post()/requests.get() directly, so the
    # timeout + error handling only needs to be correct in one place,
    # not duplicated (and risk drifting) across every call site.
    #
    # On any network-level failure (timeout, connection refused, DNS
    # failure, etc.) this returns the SAME shape callers already
    # check for a rejected request — {'status': False, 'message': ...}
    # — so initiate_subscription/initiate_listing_unlock's existing
    # `if not result.get('status')` handling covers this case for
    # free, with no changes needed at the view layer. The alternative
    # (letting the exception propagate) would turn a temporary
    # Paystack outage into a raw 500 for the renter/landlord, with
    # nothing logged to explain why.
    try:
        response = requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
    except requests.exceptions.RequestException as exc:
        logger.error('Paystack request failed: %s %s — %s', method, url, exc)
        return {'status': False, 'message': 'Could not reach Paystack. Please try again.'}

    try:
        return response.json()
    except ValueError:
        # Paystack is documented to always return JSON, but a
        # malformed/non-JSON body (e.g. an upstream proxy error page
        # during an outage) shouldn't raise an unhandled exception
        # here either — same fail-safe shape as the network-error case
        logger.error(
            'Paystack returned a non-JSON response: %s %s — status %s',
            method, url, response.status_code,
        )
        return {'status': False, 'message': 'Paystack returned an unexpected response.'}


def initialize_transaction(email, amount_kobo, callback_url, plan_code=None, metadata=None):
    # plan_code is now OPTIONAL (default None) — subscriptions (landlord
    # tiers) pass a real plan_code, which makes Paystack also set up
    # RECURRING billing. A one-off charge (e.g. a renter unlocking a
    # single listing) passes plan_code=None instead — Paystack then
    # just charges the amount once, no subscription created at all

    # metadata — an arbitrary dict WE control that Paystack stores
    # alongside the transaction and echoes back untouched inside the
    # webhook payload later. This is how the webhook will know exactly
    # WHICH listing a renter was paying to unlock, without needing to
    # guess from the amount or re-derive it from the user's email alone

    payload = {
        'email': email,
        'amount': amount_kobo,
        # NOTE: "amount_kobo" is a bit of a misnomer for Ghana —
        # Paystack's API always expects the SMALLEST currency unit
        # regardless of country (kobo for NGN, pesewas for GHS,
        # cents for USD) — same underlying reason DecimalField
        # matters on our Payment/pricing fields: avoiding
        # fractional-currency rounding issues. GHS 50.00 must be
        # sent as 5000
        'callback_url': callback_url,
        # Where Paystack redirects the browser after the popup
        # closes — NOT a substitute for the webhook, just where the
        # human ends up looking afterward
    }

    if plan_code:
        payload['plan'] = plan_code
        # Attaching a plan here is what makes this call ALSO set up
        # recurring billing, not just a one-off charge — per
        # Paystack's docs, this overrides the amount param with the
        # plan's own price. Only included when actually subscribing —
        # a one-off listing-unlock charge has no plan at all

    if metadata:
        payload['metadata'] = metadata

    return _request(
        'POST',
        f'{BASE_URL}/transaction/initialize',
        headers=_headers(),
        json=payload,
    )


def verify_transaction(reference):
    # Calls GET /transaction/verify/:reference — lets us directly ask
    # Paystack "what actually happened with this transaction", as a
    # fallback/double-check alongside the webhook (webhooks CAN
    # theoretically fail to arrive, e.g. a network blip on Paystack's
    # side — this endpoint lets our own code re-confirm independently)

    return _request(
        'GET',
        f'{BASE_URL}/transaction/verify/{reference}',
        headers=_headers(),
    )
