from unittest.mock import patch

from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .models import User
from .views import email_verification_token, password_reset_token


class ScopedRateLimitTests(APITestCase):
    # The per-endpoint limits in settings.py (register 5/min, password
    # reset 5/min, ...) used to be set in a way DRF never read, so these
    # endpoints had no limit at all. The cache (where the counters live)
    # is emptied before every test by config/test_runner.py.

    def assert_sixth_request_throttled(self, url):
        statuses = [self.client.post(url, {}, format='json').status_code for _ in range(6)]

        self.assertNotIn(status.HTTP_429_TOO_MANY_REQUESTS, statuses[:5])
        self.assertEqual(statuses[5], status.HTTP_429_TOO_MANY_REQUESTS)

    def test_register_is_limited_to_five_a_minute(self):
        self.assert_sixth_request_throttled('/accounts/register/')

    def test_password_reset_request_is_limited_to_five_a_minute(self):
        self.assert_sixth_request_throttled('/accounts/password-reset/')

    def test_google_login_is_limited_to_five_a_minute(self):
        self.assert_sixth_request_throttled('/accounts/login/google/')


class TokenSeparationTests(APITestCase):

    def setUp(self):
        self.user = User.objects.create_user(email='tokens@example.com', password='original-pass-123')
        self.uid = urlsafe_base64_encode(force_bytes(self.user.pk))

    def test_verification_token_is_not_a_password_reset_token(self):
        token = email_verification_token.make_token(self.user)

        self.assertFalse(password_reset_token.check_token(self.user, token))

    def test_verification_link_cannot_reset_the_password(self):
        token = email_verification_token.make_token(self.user)

        response = self.client.post('/accounts/password-reset/confirm/', {
            'uid': self.uid, 'token': token, 'new_password': 'attacker-pass-456',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('original-pass-123'))

    def test_password_reset_token_is_not_a_verification_token(self):
        token = password_reset_token.make_token(self.user)

        self.assertFalse(email_verification_token.check_token(self.user, token))


class GoogleUnverifiedEmailTests(APITestCase):

    def test_unverified_google_email_cannot_sign_into_existing_account(self):
        User.objects.create_user(email='victim@example.com', password='victim-pass-123', role='renter')
        payload = {'email': 'victim@example.com', 'email_verified': False, 'given_name': 'Not', 'family_name': 'Victim'}

        with patch('accounts.views.id_token.verify_oauth2_token', return_value=payload):
            response = self.client.post('/accounts/login/google/', {'token': 'fake'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn('access', response.data)

    def test_unverified_google_email_creates_no_account(self):
        payload = {'email': 'new@example.com', 'given_name': 'New', 'family_name': 'Person'}
        # No email_verified at all counts as unverified too.

        with patch('accounts.views.id_token.verify_oauth2_token', return_value=payload):
            response = self.client.post('/accounts/login/google/', {'token': 'fake'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email='new@example.com').exists())


class LogoutWithoutTokenTests(APITestCase):

    def test_empty_logout_is_rejected_and_writes_nothing(self):
        response = self.client.post('/accounts/logout/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(OutstandingToken.objects.count(), 0)
        self.assertEqual(BlacklistedToken.objects.count(), 0)
