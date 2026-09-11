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


def initialize_transaction(email, amount_kobo, plan_code, callback_url):
    # Calls POST /transaction/initialize — this is what starts BOTH the
    # first charge AND creates the recurring subscription in one step,
    # because we're attaching plan_code. Returns an authorization_url
    # the frontend redirects to / opens as Paystack's Popup

    response = requests.post(
        f'{BASE_URL}/transaction/initialize',
        headers=_headers(),
        json={
            'email': email,
            'amount': amount_kobo,
            # NOTE: "amount_kobo" is a bit of a misnomer for Ghana —
            # Paystack's API always expects the SMALLEST currency unit
            # regardless of country (kobo for NGN, pesewas for GHS,
            # cents for USD) — same underlying reason DecimalField
            # matters on our Payment/pricing fields: avoiding
            # fractional-currency rounding issues. GHS 50.00 must be
            # sent as 5000

            'plan': plan_code,
            # Attaching a plan here is what makes this call ALSO set up
            # recurring billing, not just a one-off charge — per
            # Paystack's docs, this overrides the amount param with the
            # plan's own price

            'callback_url': callback_url,
            # Where Paystack redirects the browser after the popup
            # closes — NOT a substitute for the webhook, just where the
            # human ends up looking afterward
        },
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
