import hashlib
import hmac
import json

import requests
from unittest.mock import patch

from django.conf import settings
from django.contrib.admin.sites import AdminSite
from django.test import RequestFactory, override_settings
from django.utils import timezone
from datetime import timedelta

from rest_framework.test import APITestCase
from rest_framework import status

from accounts.models import User, LandlordProfile, RenterProfile
from .admin import LandlordSubscriptionAdmin
from .models import LandlordSubscription, ListingUnlock
from . import paystack


def sign(body_bytes):
    # Test helper — mirrors EXACTLY what _verify_paystack_signature does
    # in views.py, so tests can produce a genuinely valid signature
    # rather than a fake one, proving the real verification logic works
    return hmac.new(
        settings.PAYSTACK_SECRET_KEY.encode('utf-8'), body_bytes, hashlib.sha512
    ).hexdigest()


class LandlordSubscriptionModelTests(APITestCase):

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='sublandlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Sub Landlord',
            national_id_number='GHA-1', preferred_payout_method='momo'
        )

    def test_is_active_false_when_status_inactive(self):
        subscription = LandlordSubscription.objects.create(landlord_profile=self.landlord_profile)
        # Default status is INACTIVE — never explicitly set here

        self.assertFalse(subscription.is_active())

    def test_is_active_false_when_active_but_expired(self):
        subscription = LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() - timedelta(days=1),
            # In the PAST — the paid period has already ended
        )

        self.assertFalse(subscription.is_active())
        # Proves is_active() checks BOTH status AND the actual date,
        # not just the status field alone

    def test_is_active_true_when_active_and_current(self):
        subscription = LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
        )

        self.assertTrue(subscription.is_active())

    def test_is_active_false_when_no_period_end_set(self):
        subscription = LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            status=LandlordSubscription.Status.ACTIVE,
            # current_period_end left as None
        )

        self.assertFalse(subscription.is_active())
        # A genuinely malformed/incomplete state (ACTIVE but no known
        # expiry) should fail safe — treated as not active, not
        # accidentally treated as "active forever"


class InitiateSubscriptionTests(APITestCase):

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='initlandlord@example.com', password='pass123456', role='landlord'
        )
        LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Init Landlord',
            national_id_number='GHA-2', preferred_payout_method='momo'
        )

        self.renter_user = User.objects.create_user(
            email='initrenter@example.com', password='pass123456'
        )

    def test_renter_cannot_initiate_subscription(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(
            '/payments/subscribe/', {'amount_kobo': 5000, 'callback_url': 'http://x.com'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_initiate_requires_authentication(self):
        response = self.client.post(
            '/payments/subscribe/', {'amount_kobo': 5000, 'callback_url': 'http://x.com'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        # Note: we deliberately do NOT test the real Paystack API call
        # succeeding here — that would require actually hitting
        # Paystack's servers from a test, which is slow, flaky, and
        # costs a real (if tiny) test-mode transaction. The landlord/
        # permission checks are what we control and can test reliably;
        # the actual paystack.initialize_transaction() call itself
        # would be tested via mocking in a more thorough test suite


class InitiateListingUnlockTests(APITestCase):
    # The one-off unlock charge has NO Paystack plan attached, so the
    # amount we send is exactly what gets charged — these tests pin
    # that amount to settings.LISTING_UNLOCK_PRICE_PESEWAS and prove a
    # client-supplied amount is ignored

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='unlock-renter@example.com', password='pass123456', role='renter',
            is_verified=True,  # paying requires a verified email
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Unlock Renter')

        self.landlord_user = User.objects.create_user(
            email='unlock-landlord@example.com', password='pass123456', role='landlord'
        )
        landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Unlock Landlord',
            national_id_number='GHA-77', preferred_payout_method='momo'
        )

        from listings.models import Listing
        self.listing = Listing.objects.create(
            landlord_profile=landlord_profile,
            title='Unlock listing', description='Test', listing_type='rent',
            price_monthly='1200.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='1 Unlock Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
            # PUBLISHED — only live listings can be unlocked now.
        )

    @override_settings(LISTING_UNLOCK_PRICE_PESEWAS=1234)
    # A distinctive value, so the assertion can only pass if the view
    # really reads the setting (not a hardcoded 500 or the request body)
    @patch('payments.paystack.initialize_transaction')
    def test_unlock_charges_settings_price_not_request_amount(self, mock_init):
        mock_init.return_value = {
            'status': True,
            'data': {'authorization_url': 'https://paystack.test/x', 'reference': 'ref_unlock'},
        }
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(
            '/payments/unlock-listing/',
            {'listing_id': self.listing.id, 'amount_kobo': 1, 'amount': 1,
             'callback_url': 'http://x.com'},
            # amount_kobo/amount = 1 — a malicious client trying to
            # unlock for a single pesewa; the view must ignore both
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_init.assert_called_once()
        kwargs = mock_init.call_args.kwargs
        self.assertEqual(kwargs['amount_kobo'], settings.LISTING_UNLOCK_PRICE_PESEWAS)
        self.assertEqual(kwargs['amount_kobo'], 1234)
        self.assertIsNone(kwargs.get('plan_code'))
        self.assertEqual(kwargs['metadata']['purpose'], 'listing_unlock')
        self.assertEqual(kwargs['metadata']['listing_id'], self.listing.id)
        self.assertEqual(kwargs['metadata']['user_id'], self.renter_user.id)

    def test_default_unlock_price_is_an_int(self):
        # The setting must exist and be a real int in pesewas — its
        # accidental removal once made every unlock raise AttributeError
        self.assertIsInstance(settings.LISTING_UNLOCK_PRICE_PESEWAS, int)
        self.assertGreater(settings.LISTING_UNLOCK_PRICE_PESEWAS, 0)

    @patch('payments.paystack.initialize_transaction')
    def test_already_unlocked_listing_does_not_call_paystack(self, mock_init):
        ListingUnlock.objects.create(user=self.renter_user, listing=self.listing)
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(
            '/payments/unlock-listing/', {'listing_id': self.listing.id}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        mock_init.assert_not_called()


class MySubscriptionTests(APITestCase):

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='mysublandlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='My Sub Landlord',
            national_id_number='GHA-3', preferred_payout_method='momo'
        )

    def test_no_subscription_row_returns_inactive(self):
        # A landlord who has NEVER attempted to pay has no
        # LandlordSubscription row at all yet — confirms this is
        # handled as a normal state, not an error

        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.get('/payments/subscription/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], LandlordSubscription.Status.INACTIVE)

    def test_active_subscription_returned_correctly(self):
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=15),
        )

        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.get('/payments/subscription/')

        self.assertEqual(response.data['status'], LandlordSubscription.Status.ACTIVE)

    def test_renter_cannot_view_subscription(self):
        renter_user = User.objects.create_user(email='mysubrenter@example.com', password='pass123456')

        self.client.force_authenticate(user=renter_user)

        response = self.client.get('/payments/subscription/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class WebhookTests(APITestCase):

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='webhooklandlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Webhook Landlord',
            national_id_number='GHA-4', preferred_payout_method='momo'
        )

    def test_webhook_rejects_invalid_signature(self):
        payload = {'event': 'charge.success', 'data': {'customer': {'email': self.landlord_user.email}}}
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE='not-the-real-signature',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        # Proves a request CLAIMING to be from Paystack, but without the
        # correct signature, is rejected — the actual security guarantee
        # this whole function exists for

    @override_settings(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
    def test_subscription_create_stores_tier_and_period_without_activating(self):
        # subscription.create's data IS the Subscription resource:
        # plan identifies the tier, next_payment_date is TOP-LEVEL.
        # No money has moved yet, so status must stay INACTIVE — only
        # charge.success below may activate.
        payload = {
            'event': 'subscription.create',
            'data': {
                'customer': {'email': self.landlord_user.email, 'customer_code': 'CUS_test123'},
                'subscription_code': 'SUB_test123',
                'plan': {'plan_code': 'PLN_agent_test'},
                'next_payment_date': '2026-11-01T00:00:00.000Z',
            },
        }
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.tier, LandlordSubscription.Tier.AGENT)
        self.assertIsNotNone(subscription.current_period_end)
        self.assertEqual(subscription.status, LandlordSubscription.Status.INACTIVE)
        self.assertFalse(subscription.is_active())

    @override_settings(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
    def test_full_subscription_flow_activates_with_cap(self):
        # The REAL production sequence for a plan purchase (per
        # Paystack's subscription lifecycle docs): subscription.create
        # first (tier + period, still inactive), then charge.success
        # once money moves (ACTIVE). End state must actually pass
        # is_active() — this is the exact scenario that was broken
        # when the period was read from plan_object.next_payment_date,
        # a location Paystack never sends.
        create_payload = {
            'event': 'subscription.create',
            'data': {
                'customer': {'email': self.landlord_user.email, 'customer_code': 'CUS_test123'},
                'subscription_code': 'SUB_test123',
                'plan': {'plan_code': 'PLN_agent_test'},
                'next_payment_date': '2026-11-01T00:00:00.000Z',
            },
        }
        charge_payload = {
            'event': 'charge.success',
            'data': {
                'customer': {'email': self.landlord_user.email},
                'plan_object': {'plan_code': 'PLN_agent_test'},
            },
        }

        for payload in (create_payload, charge_payload):
            body = json.dumps(payload).encode('utf-8')
            response = self.client.post(
                '/payments/webhook/', data=body, content_type='application/json',
                HTTP_X_PAYSTACK_SIGNATURE=sign(body),
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.status, LandlordSubscription.Status.ACTIVE)
        self.assertEqual(subscription.tier, LandlordSubscription.Tier.AGENT)
        self.assertTrue(subscription.is_active())
        self.assertEqual(subscription.listing_cap(), 10)

    @override_settings(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
    def test_charge_success_activates_subscription(self):
        # Real charge.success shape: plan_object carries plan_code but
        # NO date (Transaction resource has no next_payment_date).
        # Status must still flip to ACTIVE on money moved; the period
        # comes from subscription.create (tested above), not from here.
        payload = {
            'event': 'charge.success',
            'data': {
                'customer': {'email': self.landlord_user.email},
                'plan_object': {'plan_code': 'PLN_agent_test'},
            },
        }
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.status, LandlordSubscription.Status.ACTIVE)
        self.assertEqual(subscription.tier, LandlordSubscription.Tier.AGENT)

    def test_invoice_update_refreshes_period_and_heals_past_due(self):
        # Renewals pay via the same cycle; invoice.update is the ONLY
        # event carrying the fresh next_payment_date (nested under
        # data.subscription). A PAST_DUE row paid on retry must heal.
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.PAST_DUE,
            current_period_end=timezone.now() - timedelta(days=1),
            paystack_subscription_code='SUB_test123',
        )

        payload = {
            'event': 'invoice.update',
            'data': {
                'paid': True,
                'status': 'success',
                'customer': {'email': self.landlord_user.email},
                'subscription': {
                    'subscription_code': 'SUB_test123',
                    'next_payment_date': '2026-12-01T00:00:00.000Z',
                },
            },
        }
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.status, LandlordSubscription.Status.ACTIVE)
        self.assertTrue(subscription.is_active())

    def test_failed_invoice_update_does_not_extend_period(self):
        # A FAILED charge must never extend anyone's paid period —
        # that job belongs to invoice.payment_failed (PAST_DUE).
        old_period_end = timezone.now() + timedelta(days=5)
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=old_period_end,
            paystack_subscription_code='SUB_test123',
        )

        payload = {
            'event': 'invoice.update',
            'data': {
                'paid': False,
                'status': 'failed',
                'customer': {'email': self.landlord_user.email},
                'subscription': {
                    'subscription_code': 'SUB_test123',
                    'next_payment_date': '2026-12-01T00:00:00.000Z',
                },
            },
        }
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.current_period_end, old_period_end)

    def test_admin_save_defaults_period_for_manual_grant(self):
        # Staff granting Active with a blank period in admin gets a
        # 30-day period auto-filled, so the grant actually takes
        # effect instead of silently failing is_active(). Model-layer
        # semantics are untouched (see the is_active tests above).
        model_admin = LandlordSubscriptionAdmin(LandlordSubscription, AdminSite())
        request = RequestFactory().get('/')

        subscription = LandlordSubscription(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=None,
        )
        model_admin.save_model(request, subscription, form=None, change=False)

        subscription.refresh_from_db()
        self.assertIsNotNone(subscription.current_period_end)
        self.assertTrue(subscription.is_active())

    def test_invoice_payment_failed_marks_past_due(self):
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=5),
        )

        payload = {'event': 'invoice.payment_failed', 'data': {'customer': {'email': self.landlord_user.email}}}
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.status, LandlordSubscription.Status.PAST_DUE)

    def test_webhook_for_unknown_email_does_not_crash(self):
        payload = {'event': 'charge.success', 'data': {'customer': {'email': 'nobody@nowhere.com'}}}
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Still 200 — proves we don't cause Paystack to endlessly retry
        # over a webhook referencing an email we don't recognize


class PaystackClientResilienceTests(APITestCase):
    # Regression tests for the paystack.py timeout/error-handling fix:
    # a hung or unreachable Paystack must degrade to a normal
    # {'status': False, ...} response — exactly what
    # initiate_subscription/initiate_listing_unlock already check for
    # — rather than raising an unhandled exception that would surface
    # as a raw 500 to whoever's trying to pay.

    def test_initialize_transaction_sends_a_timeout(self):
        # Confirms REQUEST_TIMEOUT is actually passed through to
        # requests — the whole point of the fix is that Paystack
        # hanging can never block a worker indefinitely. Mocking here
        # rather than hitting the real API (same reasoning as the rest
        # of this file's existing tests).
        with patch('payments.paystack.requests.request') as mock_request:
            mock_request.return_value.json.return_value = {'status': True, 'data': {}}

            paystack.initialize_transaction(
                email='timeout-test@example.com', amount_kobo=5000, callback_url='http://x.com',
            )

            self.assertTrue(mock_request.called)
            self.assertEqual(mock_request.call_args.kwargs.get('timeout'), paystack.REQUEST_TIMEOUT)

    def test_initialize_transaction_degrades_gracefully_on_timeout(self):
        with patch('payments.paystack.requests.request', side_effect=requests.exceptions.Timeout):
            result = paystack.initialize_transaction(
                email='timeout-test@example.com', amount_kobo=5000, callback_url='http://x.com',
            )

        self.assertFalse(result['status'])
        # Never raises — callers' existing `if not result.get('status')`
        # handling (see initiate_subscription/initiate_listing_unlock)
        # covers this case with zero changes needed at the view layer

    def test_initialize_transaction_degrades_gracefully_on_connection_error(self):
        with patch(
            'payments.paystack.requests.request',
            side_effect=requests.exceptions.ConnectionError,
        ):
            result = paystack.initialize_transaction(
                email='conn-test@example.com', amount_kobo=5000, callback_url='http://x.com',
            )

        self.assertFalse(result['status'])

    def test_verify_transaction_degrades_gracefully_on_timeout(self):
        with patch('payments.paystack.requests.request', side_effect=requests.exceptions.Timeout):
            result = paystack.verify_transaction('some-reference')

        self.assertFalse(result['status'])

    def test_initiate_subscription_view_returns_400_when_paystack_unreachable(self):
        # End-to-end through the actual view, not just the paystack.py
        # module in isolation — confirms a hung Paystack surfaces as a
        # normal 400 error response to the landlord, not a 500.
        landlord_user = User.objects.create_user(
            email='resilience-landlord@example.com', password='pass123456', role='landlord',
            is_verified=True,  # paying requires a verified email
        )
        LandlordProfile.objects.create(
            user=landlord_user, full_name='Resilience Landlord',
            national_id_number='GHA-9', preferred_payout_method='momo'
        )
        self.client.force_authenticate(user=landlord_user)

        with patch('payments.paystack.requests.request', side_effect=requests.exceptions.Timeout):
            response = self.client.post(
                '/payments/subscribe/',
                {'tier': 'agent', 'amount_kobo': 25000, 'callback_url': 'http://x.com'},
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class VerifyPaymentTests(APITestCase):
    # The synchronous verify endpoint — lets the frontend confirm a
    # charge succeeded right after the Paystack popup closes, instead
    # of relying on the webhook alone. Mirrors WebhookTests' style
    # (mocking paystack.verify_transaction rather than hitting the real
    # API), but drives the SAME _handle_successful_charge code path

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='verify-renter@example.com', password='pass123456', role='renter'
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Verify Renter')

        self.landlord_user = User.objects.create_user(
            email='verify-landlord@example.com', password='pass123456', role='landlord'
        )
        LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Verify Landlord',
            national_id_number='GHA-42', preferred_payout_method='momo'
        )

        from listings.models import Listing
        self.listing = Listing.objects.create(
            landlord_profile=LandlordProfile.objects.get(user=self.landlord_user),
            title='Verify listing', description='Test', listing_type='rent',
            price_monthly='1200.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='1 Verify Rd',
            neighborhood='Osu', city='Accra',
        )

    def test_verify_requires_reference(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get('/payments/verify/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_verify_requires_authentication(self):
        response = self.client.get('/payments/verify/?reference=some-ref')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_successful_listing_unlock_verification_creates_unlock(self):
        self.client.force_authenticate(user=self.renter_user)

        mock_data = {
            'status': 'success',
            'reference': 'T_UNLOCK_1',
            'amount': settings.LISTING_UNLOCK_PRICE_PESEWAS,
            'currency': 'GHS',
            'metadata': {
                'purpose': 'listing_unlock',
                'listing_id': self.listing.id,
                'user_id': self.renter_user.id,
            },
        }

        with patch('payments.paystack.verify_transaction', return_value={'status': True, 'data': mock_data}):
            response = self.client.get('/payments/verify/?reference=T_UNLOCK_1')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['verified'])
        self.assertTrue(ListingUnlock.objects.filter(
            user=self.renter_user, listing=self.listing
        ).exists())

    def test_successful_subscription_verification_activates_subscription(self):
        self.client.force_authenticate(user=self.landlord_user)

        mock_data = {
            'status': 'success',
            'reference': 'T_SUB_1',
            'customer': {'email': self.landlord_user.email},
            'plan': settings.PAYSTACK_AGENT_PLAN_CODE or 'PLN_AGENT_TEST',
        }

        with override_settings(PAYSTACK_AGENT_PLAN_CODE='PLN_AGENT_TEST'):
            mock_data['plan'] = 'PLN_AGENT_TEST'
            with patch('payments.paystack.verify_transaction', return_value={'status': True, 'data': mock_data}):
                response = self.client.get('/payments/verify/?reference=T_SUB_1')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['verified'])
        subscription = LandlordSubscription.objects.get(
            landlord_profile__user=self.landlord_user
        )
        self.assertEqual(subscription.status, LandlordSubscription.Status.ACTIVE)

    def test_unsuccessful_transaction_does_not_activate_anything(self):
        self.client.force_authenticate(user=self.renter_user)

        mock_data = {'status': 'abandoned', 'reference': 'T_FAIL_1'}

        with patch('payments.paystack.verify_transaction', return_value={'status': True, 'data': mock_data}):
            response = self.client.get('/payments/verify/?reference=T_FAIL_1')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['verified'])
        self.assertEqual(ListingUnlock.objects.count(), 0)

    def test_verify_degrades_gracefully_when_paystack_unreachable(self):
        self.client.force_authenticate(user=self.renter_user)

        with patch('payments.paystack.requests.request', side_effect=requests.exceptions.Timeout):
            response = self.client.get('/payments/verify/?reference=T_TIMEOUT')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_verifying_the_same_reference_twice_is_idempotent(self):
        # Simulates the webhook and the synchronous verify call both
        # eventually processing the SAME successful charge — must not
        # raise an IntegrityError from ListingUnlock's unique_together
        self.client.force_authenticate(user=self.renter_user)

        mock_data = {
            'status': 'success',
            'reference': 'T_UNLOCK_2',
            'amount': settings.LISTING_UNLOCK_PRICE_PESEWAS,
            'currency': 'GHS',
            'metadata': {
                'purpose': 'listing_unlock',
                'listing_id': self.listing.id,
                'user_id': self.renter_user.id,
            },
        }

        with patch('payments.paystack.verify_transaction', return_value={'status': True, 'data': mock_data}):
            self.client.get('/payments/verify/?reference=T_UNLOCK_2')
            response = self.client.get('/payments/verify/?reference=T_UNLOCK_2')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(ListingUnlock.objects.filter(
            user=self.renter_user, listing=self.listing
        ).count(), 1)


class ForgedChargeTests(APITestCase):
    # Paystack transactions don't only come from our own initiate_* views:
    # anyone with our PUBLIC Paystack key (shipped in frontend code) can
    # start a transaction for any amount, with any metadata, and pay it.
    # Paystack will then truthfully say "success". These tests make sure
    # that a cheap self-made charge can't be turned into an unlock or a
    # re-activated subscription, via either door into
    # _handle_successful_charge: GET /payments/verify/ or the webhook.

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='forge-renter@example.com', password='pass123456', role='renter'
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Forge Renter')

        self.landlord_user = User.objects.create_user(
            email='forge-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Forge Landlord',
            national_id_number='GHA-77', preferred_payout_method='momo'
        )

        from listings.models import Listing
        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Forge listing', description='Test', listing_type='rent',
            price_monthly='1200.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='1 Forge Rd',
            neighborhood='Osu', city='Accra',
        )

    def _unlock_charge(self, amount, currency='GHS', reference='T_FORGE'):
        # Shaped like a real Paystack Transaction: amount in pesewas,
        # currency code, and the metadata an attacker would copy from our
        # own initiate_listing_unlock call.
        return {
            'status': 'success',
            'reference': reference,
            'amount': amount,
            'currency': currency,
            'metadata': {
                'purpose': 'listing_unlock',
                'listing_id': self.listing.id,
                'user_id': self.renter_user.id,
            },
        }

    def _verify(self, data):
        self.client.force_authenticate(user=self.renter_user)
        with patch('payments.paystack.verify_transaction', return_value={'status': True, 'data': data}):
            return self.client.get(f"/payments/verify/?reference={data['reference']}")

    def _unlocked(self):
        return ListingUnlock.objects.filter(user=self.renter_user, listing=self.listing).exists()

    def test_underpaid_unlock_is_not_granted(self):
        self._verify(self._unlock_charge(amount=1))

        self.assertFalse(self._unlocked())

    def test_one_pesewa_short_is_not_granted(self):
        self._verify(self._unlock_charge(amount=settings.LISTING_UNLOCK_PRICE_PESEWAS - 1))

        self.assertFalse(self._unlocked())

    def test_wrong_currency_is_not_granted(self):
        self._verify(self._unlock_charge(amount=settings.LISTING_UNLOCK_PRICE_PESEWAS, currency='NGN'))

        self.assertFalse(self._unlocked())

    def test_missing_amount_is_not_granted(self):
        data = self._unlock_charge(amount=None)
        del data['amount']

        self._verify(data)

        self.assertFalse(self._unlocked())

    def test_full_price_is_granted(self):
        self._verify(self._unlock_charge(amount=settings.LISTING_UNLOCK_PRICE_PESEWAS))

        self.assertTrue(self._unlocked())

    def test_underpaid_unlock_via_webhook_is_not_granted(self):
        payload = {'event': 'charge.success', 'data': self._unlock_charge(amount=1)}
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Still 200 — we tell Paystack "received" so it stops retrying an
        # event we will never act on.
        self.assertFalse(self._unlocked())

    def test_charge_without_plan_does_not_reactivate_subscription(self):
        # A landlord whose renewal failed (PAST_DUE) but whose paid
        # period hasn't ended yet. Before the fix, ANY successful charge
        # from their email — e.g. a self-made GH¢0.01 charge with no
        # plan — flipped them back to ACTIVE.
        subscription = LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.PAST_DUE,
            current_period_end=timezone.now() + timedelta(days=10),
        )
        data = {
            'status': 'success',
            'reference': 'T_NO_PLAN',
            'amount': 1,
            'currency': 'GHS',
            'customer': {'email': self.landlord_user.email},
        }

        self.client.force_authenticate(user=self.landlord_user)
        with patch('payments.paystack.verify_transaction', return_value={'status': True, 'data': data}):
            self.client.get('/payments/verify/?reference=T_NO_PLAN')

        subscription.refresh_from_db()
        self.assertEqual(subscription.status, LandlordSubscription.Status.PAST_DUE)
        self.assertFalse(subscription.is_active())

    @override_settings(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
    def test_plan_charge_from_user_without_landlord_profile_does_not_crash(self):
        # A renter's email on a plan charge (odd, but possible) used to
        # hit `user.landlordprofile`, which raises for renters — a 500,
        # which makes Paystack keep re-sending the webhook.
        payload = {
            'event': 'charge.success',
            'data': {
                'customer': {'email': self.renter_user.email},
                'plan_object': {'plan_code': 'PLN_agent_test'},
            },
        }
        body = json.dumps(payload).encode('utf-8')

        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(LandlordSubscription.objects.exists())


class PaymentAccessRuleTests(APITestCase):
    # Verified-email requirement before any payment starts, and unlocks
    # only for live listings.

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='payrule-renter@example.com', password='pass123456', role='renter'
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Pay Rule Renter')
        self.landlord_user = User.objects.create_user(
            email='payrule-landlord@example.com', password='pass123456', role='landlord'
        )
        landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Pay Rule Landlord',
            national_id_number='GHA-88', preferred_payout_method='momo'
        )
        from listings.models import Listing
        self.Listing = Listing
        self.listing = Listing.objects.create(
            landlord_profile=landlord_profile,
            title='Pay rule listing', description='Test', listing_type='rent',
            price_monthly='1200.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='1 Rule Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

    @patch('payments.paystack.initialize_transaction')
    def test_unverified_user_cannot_start_unlock(self, mock_init):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post('/payments/unlock-listing/', {'listing_id': self.listing.id}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'email_not_verified')
        mock_init.assert_not_called()
        # The important part: Paystack was never contacted, so no
        # checkout was ever created.

    @patch('payments.paystack.initialize_transaction')
    def test_unverified_landlord_cannot_start_subscription(self, mock_init):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/payments/subscribe/', {'tier': 'agent', 'amount_kobo': 25000}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'email_not_verified')
        mock_init.assert_not_called()

    @patch('payments.paystack.initialize_transaction')
    def test_cannot_unlock_unpublished_listing(self, mock_init):
        self.renter_user.is_verified = True
        self.renter_user.save()
        self.listing.status = self.Listing.Status.DRAFT
        self.listing.save()
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post('/payments/unlock-listing/', {'listing_id': self.listing.id}, format='json')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        mock_init.assert_not_called()

    @patch('payments.paystack.initialize_transaction')
    def test_non_numeric_listing_id_is_404_not_500(self, mock_init):
        self.renter_user.is_verified = True
        self.renter_user.save()
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post('/payments/unlock-listing/', {'listing_id': 'abc'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


PLANS = dict(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
# Fake plan codes, so these tests never depend on the real ones in .env.


def post_webhook(client, event, data):
    # Sends a correctly signed webhook, the way Paystack would.
    body = json.dumps({'event': event, 'data': data}).encode('utf-8')
    return client.post(
        '/payments/webhook/', data=body, content_type='application/json',
        HTTP_X_PAYSTACK_SIGNATURE=sign(body),
    )


@override_settings(**PLANS)
class StartPaymentEdgeCaseTests(APITestCase):
    # The "starting a payment" views when the input or Paystack is wrong.

    def setUp(self):
        InitiateListingUnlockTests.setUp(self)
        # Borrow the verified renter + published listing without
        # inheriting (inheriting would re-run that class's tests here).
        self.landlord_user.is_verified = True
        self.landlord_user.save()

    @patch('payments.paystack.initialize_transaction')
    def test_unknown_tier_is_400_and_never_reaches_paystack(self, mock_init):
        self.client.force_authenticate(user=self.landlord_user)

        for tier in ('gold', 'free', '', None):
            with self.subTest(tier=tier):
                response = self.client.post('/payments/subscribe/', {'tier': tier}, format='json')

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        mock_init.assert_not_called()
        # 'free' is refused too: the Free plan is the default, not
        # something you pay for.

    @patch('payments.paystack.initialize_transaction', return_value={'status': False, 'message': 'Invalid email'})
    def test_unlock_reports_paystack_refusal_and_unlocks_nothing(self, mock_init):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post('/payments/unlock-listing/', {'listing_id': self.listing.id}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'Invalid email')
        self.assertFalse(ListingUnlock.objects.exists())


@override_settings(**PLANS)
class WebhookEdgeCaseTests(APITestCase):
    # Webhook deliveries we can't act on. The rule for all of them:
    # answer 200 (so Paystack stops retrying something retrying won't
    # fix) and change nothing.

    def setUp(self):
        WebhookTests.setUp(self)
        self.renter_user = User.objects.create_user(
            email='webhook-renter@example.com', password='pass123456', role='renter'
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Webhook Renter')

        from listings.models import Listing
        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile, title='Webhook listing', description='Test',
            listing_type='rent', price_monthly='1200.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='1 Hook Rd', neighborhood='Osu',
            city='Accra', status=Listing.Status.PUBLISHED,
        )

    def _unlock_charge(self, user_id, listing_id):
        return {
            'status': 'success', 'reference': 'T_STALE', 'amount': settings.LISTING_UNLOCK_PRICE_PESEWAS,
            'currency': 'GHS',
            'metadata': {'purpose': 'listing_unlock', 'user_id': user_id, 'listing_id': listing_id},
        }

    def test_unlock_charge_for_a_deleted_listing_is_ignored(self):
        listing_id = self.listing.id
        self.listing.delete()

        response = post_webhook(self.client, 'charge.success', self._unlock_charge(self.renter_user.id, listing_id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(ListingUnlock.objects.exists())

    def test_unlock_charge_for_an_unknown_user_is_ignored(self):
        response = post_webhook(self.client, 'charge.success', self._unlock_charge(999999, self.listing.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(ListingUnlock.objects.exists())

    def test_plan_charge_for_an_unknown_email_creates_nothing(self):
        response = post_webhook(self.client, 'charge.success', {
            'customer': {'email': 'stranger@example.com'},
            'plan_object': {'plan_code': 'PLN_agent_test'},
            'paid_at': timezone.now().isoformat(),
            'reference': 'T_UNKNOWN',
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(LandlordSubscription.objects.exists())

    def test_subscription_create_for_an_unknown_email_creates_nothing(self):
        response = post_webhook(self.client, 'subscription.create', {
            'customer': {'email': 'stranger@example.com', 'customer_code': 'CUS_x'},
            'subscription_code': 'SUB_x', 'plan': {'plan_code': 'PLN_agent_test'},
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(LandlordSubscription.objects.exists())

    def test_subscription_create_for_a_renter_creates_nothing(self):
        # A renter has no LandlordProfile; this used to be a 500 (and a
        # 500 makes Paystack retry the same webhook over and over).
        response = post_webhook(self.client, 'subscription.create', {
            'customer': {'email': self.renter_user.email, 'customer_code': 'CUS_r'},
            'subscription_code': 'SUB_r', 'plan': {'plan_code': 'PLN_agent_test'},
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(LandlordSubscription.objects.exists())

    def test_subscription_create_for_the_old_plan_mid_switch_is_ignored(self):
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile, tier=LandlordSubscription.Tier.LORD,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
            paystack_subscription_code='SUB_new', superseded_subscription_code='SUB_old',
        )

        response = post_webhook(self.client, 'subscription.create', {
            'customer': {'email': self.landlord_user.email, 'customer_code': 'CUS_l'},
            'subscription_code': 'SUB_old', 'plan': {'plan_code': 'PLN_agent_test'},
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.paystack_subscription_code, 'SUB_new')
        self.assertEqual(subscription.tier, LandlordSubscription.Tier.LORD)
        # A late delivery about the plan they switched AWAY from must not
        # overwrite the plan they're on now.

    def test_invoice_update_without_subscription_details_changes_nothing(self):
        period_end = timezone.now() + timedelta(days=5)
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile, tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.PAST_DUE, current_period_end=period_end,
            paystack_subscription_code='SUB_x',
        )

        response = post_webhook(self.client, 'invoice.update', {
            'paid': True, 'status': 'success', 'customer': {'email': self.landlord_user.email},
            'subscription': 'SUB_x',
            # A plain string where Paystack sends an object.
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.status, LandlordSubscription.Status.PAST_DUE)
        self.assertEqual(subscription.current_period_end, period_end)

    def test_invoice_update_falls_back_to_customer_email(self):
        # Older rows may not have the subscription code stored; the
        # landlord's email still finds the right row.
        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile, tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.PAST_DUE,
            current_period_end=timezone.now() - timedelta(days=1),
        )

        response = post_webhook(self.client, 'invoice.update', {
            'paid': True, 'status': 'success', 'customer': {'email': self.landlord_user.email},
            'subscription': {'subscription_code': 'SUB_not_stored', 'next_payment_date': '2027-01-15T00:00:00.000Z'},
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        subscription = LandlordSubscription.objects.get(landlord_profile=self.landlord_profile)
        self.assertEqual(subscription.status, LandlordSubscription.Status.ACTIVE)
        self.assertEqual(subscription.current_period_end.year, 2027)

    def test_invoice_update_nobody_matches_is_ignored(self):
        response = post_webhook(self.client, 'invoice.update', {
            'paid': True, 'status': 'success', 'customer': {'email': 'stranger@example.com'},
            'subscription': {'subscription_code': 'SUB_nobody', 'next_payment_date': '2027-01-15T00:00:00.000Z'},
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(LandlordSubscription.objects.exists())


class PeriodEndParsingTests(APITestCase):
    # _period_end_from_paystack_data reads "when is the next payment" out
    # of a Paystack payload. Plain function, so it's tested directly
    # instead of through a whole webhook.

    def test_top_level_date_wins(self):
        from .views import _period_end_from_paystack_data

        result = _period_end_from_paystack_data({
            'next_payment_date': '2027-02-01T00:00:00.000Z',
            'plan_object': {'next_payment_date': '2030-01-01T00:00:00.000Z'},
        })

        self.assertEqual((result.year, result.month), (2027, 2))

    def test_falls_back_to_plan_object(self):
        from .views import _period_end_from_paystack_data

        result = _period_end_from_paystack_data({'plan_object': {'next_payment_date': '2027-03-01T00:00:00.000Z'}})

        self.assertEqual((result.year, result.month), (2027, 3))

    def test_missing_or_unparseable_date_is_none(self):
        from .views import _period_end_from_paystack_data

        for data in ({}, {'next_payment_date': 'next tuesday'}, {'plan_object': 'not-a-dict'}):
            with self.subTest(data=data):
                self.assertIsNone(_period_end_from_paystack_data(data))
                # None means "don't touch current_period_end", rather
                # than storing a garbage date.


class PaystackClientRequestTests(APITestCase):
    # What paystack.py actually sends. requests.request is patched, so
    # nothing leaves the machine; we inspect the call it WOULD have made.

    def test_non_json_reply_degrades_to_status_false(self):
        with patch('payments.paystack.requests.request') as mock_request:
            mock_request.return_value.status_code = 502
            mock_request.return_value.json.side_effect = ValueError('No JSON object could be decoded')
            # e.g. an HTML error page from a proxy during an outage

            result = paystack.verify_transaction('T_ANY')

        self.assertFalse(result['status'])

    def test_initialize_sends_plan_and_metadata(self):
        with patch('payments.paystack.requests.request') as mock_request:
            mock_request.return_value.json.return_value = {'status': True, 'data': {}}

            paystack.initialize_transaction(
                email='payer@example.com', amount_kobo=25000, callback_url='http://x.com',
                plan_code='PLN_agent_test', metadata={'purpose': 'subscription'},
            )

        payload = mock_request.call_args.kwargs['json']
        self.assertEqual(payload['plan'], 'PLN_agent_test')
        self.assertEqual(payload['metadata'], {'purpose': 'subscription'})
        self.assertEqual(payload['email'], 'payer@example.com')

    def test_fetch_subscription_asks_for_that_code(self):
        with patch('payments.paystack.requests.request') as mock_request:
            mock_request.return_value.json.return_value = {'status': True, 'data': {}}

            paystack.fetch_subscription('SUB_abc')

        method, url = mock_request.call_args.args
        self.assertEqual(method, 'GET')
        self.assertTrue(url.endswith('/subscription/SUB_abc'))

    def test_disable_subscription_sends_code_and_token(self):
        with patch('payments.paystack.requests.request') as mock_request:
            mock_request.return_value.json.return_value = {'status': True}

            paystack.disable_subscription('SUB_abc', 'tok_123')

        method, url = mock_request.call_args.args
        self.assertEqual(method, 'POST')
        self.assertTrue(url.endswith('/subscription/disable'))
        self.assertEqual(mock_request.call_args.kwargs['json'], {'code': 'SUB_abc', 'token': 'tok_123'})
