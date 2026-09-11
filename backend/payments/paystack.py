import requests
from django.conf import settings

BASE_URL = 'https://api.paystack.co'


def _headers():
    # A small shared helper — every Paystack call needs this exact same
    # Authorization header, so we build it once here instead of
    # repeating the same dict literal in every function below
    return {
        'Authorization': f'Bearer {settings.PAYSTACK_SECRET_KEY}',
        'Content-Type': 'application/json',
    }


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

    response = requests.post(
        f'{BASE_URL}/transaction/initialize',
        headers=_headers(),
        json=payload,
    )
    return response.json()


def verify_transaction(reference):
    # Calls GET /transaction/verify/:reference — lets us directly ask
    # Paystack "what actually happened with this transaction", as a
    # fallback/double-check alongside the webhook (webhooks CAN
    # theoretically fail to arrive, e.g. a network blip on Paystack's
    # side — this endpoint lets our own code re-confirm independently)

    response = requests.get(
        f'{BASE_URL}/transaction/verify/{reference}',
        headers=_headers(),
    )
    return response.json()
