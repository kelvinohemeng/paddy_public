import hashlib
import hmac
import json

from django.conf import settings
from django.contrib.admin.sites import AdminSite
from django.test import RequestFactory, override_settings
from django.utils import timezone
from datetime import timedelta

from rest_framework.test import APITestCase
from rest_framework import status

from accounts.models import User, LandlordProfile
from .admin import LandlordSubscriptionAdmin
from .models import LandlordSubscription


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
