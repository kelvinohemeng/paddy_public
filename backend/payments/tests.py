import hashlib
import hmac
import json

from django.conf import settings
from django.utils import timezone
from datetime import timedelta

from rest_framework.test import APITestCase
from rest_framework import status

from accounts.models import User, LandlordProfile
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
            national_id_number='GHA-1', momo_or_bank_details='0551111111'
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
            national_id_number='GHA-2', momo_or_bank_details='0552222222'
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
            national_id_number='GHA-3', momo_or_bank_details='0553333333'
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
            national_id_number='GHA-4', momo_or_bank_details='0554444444'
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

    def test_charge_success_activates_subscription(self):
        payload = {
            'event': 'charge.success',
            'data': {
                'customer': {'email': self.landlord_user.email},
                'plan_object': {'next_payment_date': '2026-11-01T00:00:00.000Z'},
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
        self.assertIsNotNone(subscription.current_period_end)

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
