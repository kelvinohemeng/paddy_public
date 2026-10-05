from unittest.mock import patch

from rest_framework.test import APITestCase
# DRF's version of Django's TestCase, specifically built for testing API
# endpoints — gives us a `self.client` that can make fake POST/GET requests
# without needing a real running server, and understands JSON naturally

from rest_framework import status
# Same status constants we use in views.py — readable HTTP codes

from .models import User, RenterProfile, LandlordProfile, StaffProfile
# StaffProfile imported for the staff self-service tests below — the
# existing imports only covered renter/landlord because /me/ previously
# only wrote to those two tables.
from core.models import Amenity
# Amenity rows back amenity_preferences (an M2M), so tests need real
# ones to reference by ID.
# We'll check the database directly after hitting an endpoint, to confirm
# the right rows actually got created


class RegisterTests(APITestCase):
    # A test class — groups related tests together. Each method starting
    # with "test_" inside it is one individual, independent test.
    # APITestCase automatically wraps EACH test in its own database
    # transaction that gets rolled back afterward — so tests never leave
    # leftover data behind or affect each other, even though they all
    # technically write to the database

    def test_renter_signup_creates_user_and_profile(self):
        # Test method names should describe exactly what they're checking —
        # this one reads almost like a sentence on its own

        data = {
            'email': 'renter@example.com',
            'password': 'testpass123',
            'phone': '0551234567',
            'role': 'renter',
            'first_name': 'Test',
            'last_name': 'Renter',
            # first_name/last_name added — RegisterSerializer now marks
            # these required (extra_kwargs), so a payload without them
            # correctly gets rejected with 400. This test predates that
            # change; updated to match current API behavior.
        }
        # The fake request body we'll send — same shape as what you've
        # been typing into the browsable API by hand

        response = self.client.post('/accounts/register/', data, format='json')
        # self.client.post = simulate a real POST request to this URL,
        # without needing the dev server running at all
        # format='json' = send it as JSON, same as request.data expects

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # assertEqual = the core building block of every test — "these two
        # things must be equal, or fail this test right now with a clear
        # message showing what was expected vs what actually happened"
        # Here: confirm signup actually succeeded (201, not 400/500)

        self.assertTrue(User.objects.filter(email='renter@example.com').exists())
        # assertTrue = "this must be True, or fail"
        # Directly query the (test) database to confirm a real User row
        # was actually created — not just that the response LOOKED successful

        user = User.objects.get(email='renter@example.com')
        # Fetch that same user, so we can check more specific things about it

        self.assertEqual(user.role, 'renter')
        # Confirm the role was saved correctly

        self.assertTrue(RenterProfile.objects.filter(user=user).exists())
        # This is the important one — confirms our create() logic actually
        # created the MATCHING profile row too, not just the User alone.
        # This is exactly the behavior we built deliberately, now locked in
        # by a test so it can never silently break later without us knowing

    def test_landlord_signup_creates_landlord_profile(self):
        # Same shape as above, but for the landlord path — confirms the
        # if/elif branching in create() picks the right profile type

        data = {
            'email': 'll1@example.com',
            'password': 'testpass123',
            'phone': '0551234567',
            'role': 'landlord',
            'first_name': 'Test',
            'last_name': 'Landlord',
        }

        response = self.client.post('/accounts/register/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='ll1@example.com')

        self.assertTrue(LandlordProfile.objects.filter(user=user).exists())
        # Landlord got a LandlordProfile...

        self.assertFalse(RenterProfile.objects.filter(user=user).exists())
        # ...and specifically did NOT also get a RenterProfile —
        # confirms the branching is exclusive, not accidentally creating both

    def test_cannot_register_as_admin(self):
        # This one checks our security guard — the validate_role method
        # in the serializer that blocks admin/staff self-registration

        data = {
            'email': 'll2@example.com',
            'password': 'testpass123',
            'phone': '0551234567',
            'role': 'admin',
        }

        response = self.client.post('/accounts/register/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Should be REJECTED — 400, not 201

        self.assertFalse(User.objects.filter(email='ll2@example.com').exists())
        # And just as important: confirm no User was created at all,
        # even though the request was rejected — a rejected request
        # should leave zero trace in the database

    def test_duplicate_email_rejected(self):
        # Confirms the unique=True constraint on email actually gets
        # enforced at the API level (returns a clean 400, not a crash)

        data = {
            'email': 'renter1@example.com',
            'password': 'testpass123',
            'phone': '0551234567',
            'role': 'renter',
            'first_name': 'Test',
            'last_name': 'Renter',
        }

        self.client.post('/accounts/register/', data, format='json')
        # First signup — should succeed (we don't even need to check this
        # one's response, just need it to have happened)

        response = self.client.post('/accounts/register/', data, format='json')
        # Second signup — SAME email again

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Should be rejected the second time

        self.assertEqual(User.objects.filter(email='renter1@example.com').count(), 1)
        # Confirm exactly ONE user exists with this email, not two —
        # proves the rejection actually prevented a duplicate row

    def test_short_password_rejected(self):
        # Confirms our min_length=8 validation rule on the Serializer's
        # password field actually works

        data = {
            'email': 'shortpass@example.com',
            'password': '1234',
            # Only 4 characters — should fail our min_length=8 rule
            'phone': '0551234567',
            'role': 'renter',
        }

        response = self.client.post('/accounts/register/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email='shortpass@example.com').exists())


class MeEndpointTests(APITestCase):
    # A separate test class for a separate concern — good practice to
    # group related tests together rather than cramming everything into
    # one giant class

    def setUp(self):
        # setUp is a SPECIAL method name APITestCase looks for automatically
        # — it runs BEFORE every single test method in this class, fresh
        # each time. Perfect for "create a user I'll need for every test
        # below" instead of repeating that setup in each test individually

        self.user = User.objects.create_user(
            email='metest@example.com',
            password='testpass123',
            role='renter',
        )
        # Create a real user directly via our manager — no need to go
        # through the register endpoint here, since that's not what
        # we're testing in this class

    def test_me_requires_authentication(self):
        # Confirms the permission check actually blocks unauthenticated requests

        response = self.client.get('/accounts/me/')
        # No token attached at all — self.client starts every test "logged out"

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        # Should be rejected — this is the exact behavior we manually
        # tested earlier with curl, now locked in permanently

    def test_me_returns_authenticated_user_data(self):
        # Confirms a valid, logged-in request actually gets the right data back

        self.client.force_authenticate(user=self.user)
        # A testing-only shortcut APITestCase provides — normally a real
        # client would need to log in and get a real JWT first, but for
        # tests we don't need to prove the token mechanism itself again
        # (we already tested login separately), just that /me/ behaves
        # correctly WHEN a user is authenticated. This directly sets
        # self.client's identity for this test only.

        response = self.client.get('/accounts/me/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['email'], 'metest@example.com')
        self.assertEqual(response.data['role'], 'renter')
        # response.data — DRF's parsed version of the JSON response body,
        # already converted back into a Python dict for us to check

    def test_can_update_own_phone(self):
        # Confirms the basic happy path — a logged-in user updates a
        # field genuinely meant to be self-service editable

        self.client.force_authenticate(user=self.user)

        response = self.client.patch('/accounts/me/', {'phone': '0209998888'}, format='json')
        # self.client.patch — same idea as .get/.post above, just
        # simulating a PATCH request instead

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['phone'], '0209998888')
        # Confirms the RESPONSE reflects the new value...

        self.user.refresh_from_db()
        # ...and this confirms it was actually WRITTEN to the database,
        # not just echoed back in the response without being saved.
        # refresh_from_db() re-reads this exact row from the (test) database,
        # overwriting self.user's in-memory values with whatever's really
        # stored now — without this, self.user.phone would still show the
        # OLD value from when the object was first created in setUp,
        # even if the save genuinely worked

        self.assertEqual(self.user.phone, '0209998888')

    def test_can_update_own_full_name_as_renter(self):
        # Confirms the full_name-goes-to-the-right-profile-table logic

        self.client.force_authenticate(user=self.user)

        RenterProfile.objects.create(user=self.user, full_name='')
        # setUp only creates the User, not a RenterProfile — normally
        # register() would create both together, but since this test
        # class creates users directly via the manager, we need to add
        # the profile row ourselves before testing an update to it

        response = self.client.patch('/accounts/me/', {'full_name': 'Kwame Mensah'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        profile = RenterProfile.objects.get(user=self.user)
        # Fetch the actual profile row fresh from the database — no
        # need for refresh_from_db() here since we're fetching a NEW
        # object via .get(), not re-reading an existing in-memory one

        self.assertEqual(profile.full_name, 'Kwame Mensah')

    def test_cannot_update_role_via_me_endpoint(self):
        # THE most important test in this group — confirms the security
        # boundary actually holds: even if a malicious or buggy client
        # sends 'role' in the request body, it must be silently ignored,
        # never actually change anything

        self.client.force_authenticate(user=self.user)

        response = self.client.patch('/accounts/me/', {'role': 'admin'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Note: this should NOT be a 400 error — UserUpdateSerializer
        # simply doesn't declare 'role' as a field at all, so DRF treats
        # it as an unrecognized key and quietly drops it, same as sending
        # any other field the serializer doesn't know about. It's not
        # "rejected", it's "not even looked at"

        self.user.refresh_from_db()
        self.assertEqual(self.user.role, 'renter')
        # The real proof — role must still be exactly what it was before,
        # completely unaffected by the attempted change

    def test_cannot_update_email_via_me_endpoint(self):
        # Same security-boundary idea, different field — email is
        # identity-critical (used for login), must not be self-editable
        # through this endpoint either

        self.client.force_authenticate(user=self.user)

        response = self.client.patch('/accounts/me/', {'email': 'hacked@example.com'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'metest@example.com')

    def test_update_requires_authentication(self):
        # Mirrors test_me_requires_authentication above, but for PATCH —
        # confirms the same permission check applies to updates too, not
        # just reads

        response = self.client.patch('/accounts/me/', {'phone': '0200000000'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class MeProfileWriteTests(APITestCase):
    # Covers the self-service profile writes on PATCH /accounts/me/:
    # each role may update exactly its own allowlisted fields, and
    # everything else (role, email, verification flags, other roles'
    # fields) is silently ignored. Also pins the AdminProfile 500 fix.

    def setUp(self):
        self.renter = User.objects.create_user(
            email='writer-renter@example.com', password='testpass123', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter, full_name='Writer Renter'
        )

        self.landlord = User.objects.create_user(
            email='writer-landlord@example.com', password='testpass123', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord, full_name='Writer Landlord',
            national_id_number='GHA-W1', preferred_payout_method='momo'
        )

        self.staff = User.objects.create_user(
            email='writer-staff@example.com', password='testpass123', role='staff'
        )
        self.staff_profile = StaffProfile.objects.create(
            user=self.staff, full_name='Writer Staff'
        )

        self.admin = User.objects.create_user(
            email='writer-admin@example.com', password='testpass123', role='admin'
        )
        # No profile row for admin — role 'admin' has no profile table
        # at all, which is exactly the shape that used to 500.

        self.wifi = Amenity.objects.create(name='Wifi W', slug='wifi-w')
        self.parking = Amenity.objects.create(name='Parking W', slug='parking-w')

    def test_renter_updates_all_allowed_fields(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch('/accounts/me/', {
            'preferred_area': 'East Legon',
            'school_name': 'UG Legon',
            'occupation': 'student',
            'about_me': 'Quiet tenant, final year.',
            'preferred_payment_method': 'momo',
            'amenity_preferences': [self.wifi.id, self.parking.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.renter_profile.refresh_from_db()
        self.assertEqual(self.renter_profile.preferred_area, 'East Legon')
        self.assertEqual(self.renter_profile.school_name, 'UG Legon')
        self.assertEqual(self.renter_profile.occupation, 'student')
        self.assertEqual(self.renter_profile.about_me, 'Quiet tenant, final year.')
        self.assertEqual(self.renter_profile.preferred_payment_method, 'momo')
        self.assertEqual(
            set(self.renter_profile.amenity_preferences.values_list('id', flat=True)),
            {self.wifi.id, self.parking.id},
        )
        # Response carries the full user (existing contract), so the
        # frontend gets fresh state without a refetch — confirm the
        # nested profile reflects the writes too.
        self.assertEqual(response.data['profile']['preferred_area'], 'East Legon')
        self.assertEqual(
            set(response.data['profile']['amenity_preferences']),
            {self.wifi.id, self.parking.id},
        )
        # amenity_preferences serializes as a plain PK list (default M2M
        # representation — RenterProfileSerializer excludes only 'user').

    def test_renter_can_clear_amenity_preferences_with_empty_list(self):
        self.renter_profile.amenity_preferences.set([self.wifi])
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch(
            '/accounts/me/', {'amenity_preferences': []}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.renter_profile.refresh_from_db()
        # Re-read the row before asserting — same refresh discipline as
        # the phone test in MeEndpointTests (in-memory state goes stale
        # the moment the request writes underneath it).
        self.assertEqual(self.renter_profile.amenity_preferences.count(), 0)

    def test_landlord_updates_payout_method(self):
        self.client.force_authenticate(user=self.landlord)

        response = self.client.patch(
            '/accounts/me/', {'preferred_payout_method': 'bank_transfer'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.landlord_profile.refresh_from_db()
        self.assertEqual(self.landlord_profile.preferred_payout_method, 'bank_transfer')
        self.assertEqual(
            response.data['profile']['preferred_payout_method'], 'bank_transfer'
        )

    def test_staff_updates_full_name_only(self):
        self.client.force_authenticate(user=self.staff)

        response = self.client.patch(
            '/accounts/me/', {'full_name': 'New Staff Name'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.staff_profile.refresh_from_db()
        self.assertEqual(self.staff_profile.full_name, 'New Staff Name')

    def test_staff_cannot_grant_self_permissions(self):
        # can_approve_listings / can_host_viewings are permission flags
        # — no branch of the view reads them, so they must be ignored
        # exactly like role/email.
        self.client.force_authenticate(user=self.staff)

        response = self.client.patch('/accounts/me/', {
            'can_approve_listings': True,
            'can_host_viewings': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.staff_profile.refresh_from_db()
        self.assertFalse(self.staff_profile.can_approve_listings)
        self.assertFalse(self.staff_profile.can_host_viewings)

    def test_disallowed_user_fields_are_ignored(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch('/accounts/me/', {
            'role': 'admin',
            'email': 'hacked@example.com',
            'is_verified': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.renter.refresh_from_db()
        self.assertEqual(self.renter.role, 'renter')
        self.assertEqual(self.renter.email, 'writer-renter@example.com')
        self.assertFalse(self.renter.is_verified)

    def test_landlord_verification_fields_are_ignored(self):
        # national_id_number + id_verified are staff-only (ID document
        # verification workflow) — never writable via self-service.
        self.client.force_authenticate(user=self.landlord)

        response = self.client.patch('/accounts/me/', {
            'national_id_number': 'GHA-FAKE',
            'id_verified': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.landlord_profile.refresh_from_db()
        self.assertEqual(self.landlord_profile.national_id_number, 'GHA-W1')
        self.assertFalse(self.landlord_profile.id_verified)

    def test_admin_patch_with_full_name_no_longer_500s(self):
        # Regression test: the old `elif role == ADMIN` branch
        # referenced an AdminProfile name that was never defined, so any
        # admin PATCH containing full_name raised NameError → raw 500.
        # Admins have no profile table, so the key is ignored and the
        # request still returns the full user with 200.
        self.client.force_authenticate(user=self.admin)

        response = self.client.patch(
            '/accounts/me/', {'full_name': 'Should Be Ignored'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['profile'])

    def test_invalid_choice_returns_error_shape_and_writes_nothing(self):
        # A 400 must leave the database untouched — phone is valid here
        # but occupation is not, so NEITHER may be written (no
        # half-writes). Also pins the {'error': ...} shape the frontend
        # unwraps, rather than a serializer.errors dict.
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch('/accounts/me/', {
            'phone': '0201112222',
            'occupation': 'astronaut',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

        self.renter.refresh_from_db()
        self.renter_profile.refresh_from_db()
        self.assertNotEqual(self.renter.phone, '0201112222')
        self.assertNotEqual(self.renter_profile.occupation, 'astronaut')

    def test_unknown_amenity_id_returns_error_shape(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch(
            '/accounts/me/', {'amenity_preferences': [999999]}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertEqual(self.renter_profile.amenity_preferences.count(), 0)

    def test_non_list_amenity_preferences_returns_error_shape(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch(
            '/accounts/me/', {'amenity_preferences': self.wifi.id}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)


class PasswordResetTests(APITestCase):
    # Covers both halves of the forgot-password flow: request (send a
    # reset link) and confirm (actually change the password using it).
    # Same APITestCase per-test transaction rollback as every other class
    # here — no leftover state between tests.

    def setUp(self):
        self.user = User.objects.create_user(
            email='resetme@example.com',
            password='originalpass123',
            role='renter',
        )

    def test_request_reset_for_unknown_email_returns_generic_message(self):
        # THE core anti-enumeration behavior: an email with no matching
        # account must come back looking identical to one that exists

        response = self.client.post(
            '/accounts/password-reset/', {'email': 'nobody@example.com'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('message', response.data)
        self.assertNotIn('error', response.data)

    def test_request_reset_for_known_email_returns_same_generic_message(self):
        response = self.client.post(
            '/accounts/password-reset/', {'email': self.user.email}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('message', response.data)
        # Deliberately the SAME shape/status as the unknown-email case
        # above — asserted separately here (not by comparing the two
        # responses directly) so either test failing independently
        # still points at the right one

    def test_request_reset_without_email_is_400(self):
        response = self.client.post('/accounts/password-reset/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

    def _get_valid_uid_and_token(self):
        # Shared helper — generates a real uid/token pair the same way
        # request_password_reset does internally, without needing to
        # parse one out of a sent email (console/Resend backend isn't
        # something a test should need to scrape)
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        from .views import password_reset_token

        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = password_reset_token.make_token(self.user)
        return uid, token

    def test_confirm_reset_with_valid_token_changes_password(self):
        uid, token = self._get_valid_uid_and_token()

        response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': uid, 'token': token, 'new_password': 'brandnewpass456'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('brandnewpass456'))
        self.assertFalse(self.user.check_password('originalpass123'))
        # Confirms the OLD password genuinely stopped working, not just
        # that the new one happens to also work

    def test_confirm_reset_blacklists_outstanding_refresh_tokens(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        refresh = RefreshToken.for_user(self.user)
        # A real outstanding refresh token for this user, as if they'd
        # logged in on some device before requesting the reset

        uid, token = self._get_valid_uid_and_token()
        response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': uid, 'token': token, 'new_password': 'brandnewpass456'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            BlacklistedToken.objects.filter(token__jti=refresh['jti']).exists()
        )
        # The pre-existing session's refresh token must now be revoked —
        # this is the actual security property, not just "password
        # changed successfully" in isolation

    def test_confirm_reset_with_invalid_token_is_400(self):
        uid, _ = self._get_valid_uid_and_token()

        response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': uid, 'token': 'not-a-real-token', 'new_password': 'brandnewpass456'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('originalpass123'))
        # Password must be UNCHANGED after a rejected attempt

    def test_confirm_reset_token_cannot_be_reused(self):
        # A token is bound to the user's CURRENT password hash — once
        # set_password() runs once, the same token must stop validating

        uid, token = self._get_valid_uid_and_token()

        first_response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': uid, 'token': token, 'new_password': 'firstnewpass456'},
            format='json',
        )
        self.assertEqual(first_response.status_code, status.HTTP_200_OK)

        second_response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': uid, 'token': token, 'new_password': 'secondnewpass789'},
            format='json',
        )
        self.assertEqual(second_response.status_code, status.HTTP_400_BAD_REQUEST)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('firstnewpass456'))
        # Confirms the SECOND attempt was rejected outright, not silently
        # applied on top of the first

    def test_confirm_reset_with_malformed_uid_is_400(self):
        response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': 'not-valid-base64!!', 'token': 'whatever', 'new_password': 'brandnewpass456'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_reset_weak_password_is_rejected(self):
        uid, token = self._get_valid_uid_and_token()

        response = self.client.post(
            '/accounts/password-reset/confirm/',
            {'uid': uid, 'token': token, 'new_password': '1234'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('originalpass123'))
        # AUTH_PASSWORD_VALIDATORS rejects it — original password stands


class OnboardingTests(APITestCase):
    # Covers the deferred-role-selection flow: registration without a
    # role, then the dedicated POST /accounts/onboarding/ endpoint that
    # sets it exactly once, post-auth.

    def test_registration_without_role_leaves_role_unset(self):
        data = {
            'email': 'noroleyet@example.com',
            'password': 'testpass123',
            'first_name': 'No',
            'last_name': 'Role',
            # role omitted entirely — must be accepted, not required
        }
        response = self.client.post('/accounts/register/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='noroleyet@example.com')
        self.assertIsNone(user.role)
        # No profile row of either kind should exist yet — onboarding
        # creates it once a role is actually chosen
        self.assertFalse(RenterProfile.objects.filter(user=user).exists())
        self.assertFalse(LandlordProfile.objects.filter(user=user).exists())

    def test_me_reports_null_role_when_unset(self):
        user = User.objects.create_user(email='unset@example.com', password='testpass123')
        self.assertIsNone(user.role)

        self.client.force_authenticate(user=user)
        response = self.client.get('/accounts/me/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['role'])

    def test_onboarding_sets_role_and_creates_renter_profile(self):
        user = User.objects.create_user(email='pickme@example.com', password='testpass123')
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/accounts/onboarding/', {'role': 'renter'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['role'], 'renter')

        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.RENTER)
        self.assertTrue(RenterProfile.objects.filter(user=user).exists())

    def test_onboarding_sets_role_and_creates_landlord_profile(self):
        user = User.objects.create_user(email='pickmetoo@example.com', password='testpass123')
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/accounts/onboarding/', {'role': 'landlord'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.LANDLORD)
        self.assertTrue(LandlordProfile.objects.filter(user=user).exists())

    def test_onboarding_rejects_staff_and_admin_roles(self):
        user = User.objects.create_user(email='sneaky@example.com', password='testpass123')
        self.client.force_authenticate(user=user)

        for forbidden_role in ('staff', 'admin'):
            response = self.client.post(
                '/accounts/onboarding/', {'role': forbidden_role}, format='json'
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        user.refresh_from_db()
        self.assertIsNone(user.role)

    def test_onboarding_is_one_time_only(self):
        user = User.objects.create_user(
            email='alreadyset@example.com', password='testpass123', role='renter'
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/accounts/onboarding/', {'role': 'landlord'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.RENTER)
        # The original role must survive an attempted second call untouched

    def test_onboarding_requires_authentication(self):
        response = self.client.post(
            '/accounts/onboarding/', {'role': 'renter'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

class GoogleLoginRoleTests(APITestCase):
    # POST /accounts/login/google/ — focused on the `role` a first-time
    # Google user is allowed to pick for themselves.
    #
    # We never talk to real Google in tests. Instead we "patch" (swap
    # out, just for the duration of one test) the function that verifies
    # Google's token, so it returns a fake-but-realistic payload. That
    # way these tests check OUR logic only, run offline, and don't need a
    # real Google account. The path we patch is where the function is
    # LOOKED UP ('accounts.views.id_token...'), not where it's defined —
    # that's the standard rule for unittest.mock.patch.

    GOOGLE_PAYLOAD = {
        'email': 'google-person@example.com',
        'email_verified': True,
        'given_name': 'Ama',
        'family_name': 'Mensah',
        'name': 'Ama Mensah',
        # No 'picture' key on purpose — the view would otherwise try to
        # download the profile photo over the internet.
    }

    def _google_login(self, role=None):
        body = {'token': 'fake-google-token'}
        if role is not None:
            body['role'] = role
        with patch(
            'accounts.views.id_token.verify_oauth2_token',
            return_value=dict(self.GOOGLE_PAYLOAD),
        ):
            return self.client.post('/accounts/login/google/', body, format='json')

    def test_cannot_self_assign_admin_role(self):
        response = self._google_login(role='admin')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email=self.GOOGLE_PAYLOAD['email']).exists())
        # The important part: no account was created at all, so there's
        # no half-made admin user left behind either.

    def test_cannot_self_assign_staff_role(self):
        response = self._google_login(role='staff')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email=self.GOOGLE_PAYLOAD['email']).exists())

    def test_unknown_role_is_rejected(self):
        response = self._google_login(role='superuser')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email=self.GOOGLE_PAYLOAD['email']).exists())

    def test_landlord_role_is_allowed_and_creates_profile(self):
        response = self._google_login(role='landlord')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user = User.objects.get(email=self.GOOGLE_PAYLOAD['email'])
        self.assertEqual(user.role, User.Role.LANDLORD)
        self.assertTrue(LandlordProfile.objects.filter(user=user).exists())
        self.assertIn('access', response.data)

    def test_renter_role_is_allowed_and_creates_profile(self):
        response = self._google_login(role='renter')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user = User.objects.get(email=self.GOOGLE_PAYLOAD['email'])
        self.assertEqual(user.role, User.Role.RENTER)
        self.assertTrue(RenterProfile.objects.filter(user=user).exists())

    def test_no_role_defers_to_onboarding(self):
        response = self._google_login()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user = User.objects.get(email=self.GOOGLE_PAYLOAD['email'])
        self.assertIsNone(user.role)
        # role=None is the "send them to /onboarding" signal the frontend
        # checks for, same as email/password sign-up without a role.


class ResendVerificationEmailTests(APITestCase):
    # POST /accounts/verify-email/resend/

    def test_unverified_user_gets_a_new_email(self):
        from django.core import mail
        user = User.objects.create_user(
            email='resend-me@example.com', password='testpass123', role='renter'
        )
        self.client.force_authenticate(user=user)

        response = self.client.post('/accounts/verify-email/resend/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        # mail.outbox — during tests Django swaps the real email backend
        # for an in-memory one, so "sent" emails land in this list instead
        # of anyone's inbox. That's how we can check an email went out.
        self.assertEqual(mail.outbox[0].to, ['resend-me@example.com'])
        self.assertIn('/verify-email?uid=', mail.outbox[0].body)

    def test_already_verified_user_gets_no_email(self):
        from django.core import mail
        user = User.objects.create_user(
            email='done@example.com', password='testpass123', role='renter', is_verified=True
        )
        self.client.force_authenticate(user=user)

        response = self.client.post('/accounts/verify-email/resend/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)

    def test_requires_login(self):
        response = self.client.post('/accounts/verify-email/resend/')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class LogoutTests(APITestCase):
    # POST /accounts/logout/ — revokes ("blacklists") the refresh token the
    # frontend hands back, so it can never mint another access token.

    def setUp(self):
        self.user = User.objects.create_user(
            email='logout@example.com', password='testpass123', role='renter'
        )

    def _refresh_token(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        return str(RefreshToken.for_user(self.user))
        # A real refresh token, the same kind /accounts/login/ hands out.

    def test_logout_revokes_the_refresh_token(self):
        refresh = self._refresh_token()

        response = self.client.post('/accounts/logout/', {'refresh': refresh}, format='json')

        self.assertEqual(response.status_code, status.HTTP_205_RESET_CONTENT)

        reuse = self.client.post('/accounts/login/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(reuse.status_code, status.HTTP_401_UNAUTHORIZED)
        # The actual security property: a 205 alone would only prove the
        # view ran. Trying the token again proves it really is dead.

    def test_refresh_token_still_works_without_logout(self):
        # The control for the test above: without logging out, the same
        # kind of token CAN be exchanged. Without this, the test above
        # would also pass if /login/refresh/ were simply broken.
        refresh = self._refresh_token()

        response = self.client.post('/accounts/login/refresh/', {'refresh': refresh}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)

    def test_logout_twice_with_the_same_token_is_400(self):
        refresh = self._refresh_token()
        self.client.post('/accounts/logout/', {'refresh': refresh}, format='json')

        response = self.client.post('/accounts/logout/', {'refresh': refresh}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_logout_with_garbage_token_is_400(self):
        response = self.client.post('/accounts/logout/', {'refresh': 'not-a-token'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class VerifyEmailTests(APITestCase):
    # POST /accounts/verify-email/ — the frontend's /verify-email page
    # forwards the uid + token from the link in the email.

    def setUp(self):
        self.user = User.objects.create_user(
            email='verify-me@example.com', password='testpass123', role='renter'
        )

    def _uid_and_token(self, user=None):
        # Builds a real link the same way send_verification_email does,
        # instead of scraping one out of a sent email.
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        from .views import email_verification_token

        user = user or self.user
        return urlsafe_base64_encode(force_bytes(user.pk)), email_verification_token.make_token(user)

    def test_valid_link_verifies_the_account(self):
        uid, token = self._uid_and_token()

        response = self.client.post('/accounts/verify-email/', {'uid': uid, 'token': token}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_verified)

    def test_wrong_token_is_400_and_leaves_account_unverified(self):
        uid, _ = self._uid_and_token()

        response = self.client.post(
            '/accounts/verify-email/', {'uid': uid, 'token': 'not-a-real-token'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_verified)

    def test_token_for_another_user_does_not_verify_this_one(self):
        # A token is tied to one account: someone who verified their own
        # email can't reuse their token with another person's uid.
        other = User.objects.create_user(
            email='someone-else@example.com', password='testpass123', role='renter'
        )
        uid, _ = self._uid_and_token()
        _, other_token = self._uid_and_token(user=other)

        response = self.client.post(
            '/accounts/verify-email/', {'uid': uid, 'token': other_token}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_verified)

    def test_malformed_uid_is_400(self):
        response = self.client.post(
            '/accounts/verify-email/', {'uid': 'not-valid-base64!!', 'token': 'x'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_uid_of_deleted_user_is_400(self):
        uid, token = self._uid_and_token()
        self.user.delete()

        response = self.client.post('/accounts/verify-email/', {'uid': uid, 'token': token}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class EmailFailureTests(APITestCase):
    # Email providers go down. Each view that sends mail decides what a
    # failed send means for the person using it; these tests pin those
    # decisions. `patch(..., side_effect=Exception(...))` makes the patched
    # function RAISE instead of returning, which is how we fake an outage.

    def test_signup_still_succeeds_when_verification_email_fails(self):
        with patch('accounts.views.send_verification_email', side_effect=Exception('Resend is down')):
            response = self.client.post('/accounts/register/', {
                'email': 'unlucky@example.com',
                'password': 'testpass123',
                'role': 'renter',
                'first_name': 'Un',
                'last_name': 'Lucky',
            }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email='unlucky@example.com').exists())
        # The account exists, so the person can log in and press
        # "Resend" later instead of seeing a 500 for a signup that worked.

    def test_resend_reports_503_when_email_fails(self):
        user = User.objects.create_user(
            email='resend-fail@example.com', password='testpass123', role='renter'
        )
        self.client.force_authenticate(user=user)

        with patch('accounts.views.send_verification_email', side_effect=Exception('Resend is down')):
            response = self.client.post('/accounts/verify-email/resend/')

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertIn('error', response.data)
        # Here the ONLY job is sending the email, so failing loudly is
        # right: "Verification email sent" would be a lie.

    def test_password_reset_returns_generic_message_when_email_fails(self):
        User.objects.create_user(
            email='reset-fail@example.com', password='testpass123', role='renter'
        )

        with patch('accounts.views.EmailMultiAlternatives.send', side_effect=Exception('Resend is down')):
            response = self.client.post(
                '/accounts/password-reset/', {'email': 'reset-fail@example.com'}, format='json'
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('message', response.data)
        # Same answer as an unknown email: an error here would tell an
        # attacker "this email has an account".


class PasswordResetConfirmInputTests(APITestCase):

    def test_missing_fields_are_400(self):
        for body in ({}, {'uid': 'x'}, {'uid': 'x', 'token': 'y'}, {'token': 'y', 'new_password': 'z'}):
            with self.subTest(body=body):
                # subTest — runs the same check for each body and reports
                # exactly which one failed, instead of stopping at the first.
                response = self.client.post('/accounts/password-reset/confirm/', body, format='json')

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn('error', response.data)


class GoogleLoginTokenTests(APITestCase):
    # POST /accounts/login/google/ — the token checks and returning users.
    # GoogleLoginRoleTests above covers which role a NEW user may pick.

    PAYLOAD = {
        'email': 'returning@example.com',
        'email_verified': True,
        'given_name': 'Kofi',
        'family_name': 'Boateng',
        'name': 'Kofi Boateng',
    }

    def _post(self, body, payload=None, **patch_kwargs):
        # Same trick as GoogleLoginRoleTests: swap out Google's token check
        # so the test never talks to Google.
        if not patch_kwargs:
            patch_kwargs = {'return_value': dict(payload or self.PAYLOAD)}
        with patch('accounts.views.id_token.verify_oauth2_token', **patch_kwargs):
            return self.client.post('/accounts/login/google/', body, format='json')

    def test_missing_token_is_400(self):
        response = self.client.post('/accounts/login/google/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_token_google_rejects_is_400_and_creates_nobody(self):
        response = self._post({'token': 'tampered'}, side_effect=ValueError('Token expired'))
        # Google's library raises ValueError for a bad signature, an
        # expired token, or a token issued for a different app.

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email=self.PAYLOAD['email']).exists())

    def test_returning_user_keeps_their_role_and_profile(self):
        user = User.objects.create_user(
            email=self.PAYLOAD['email'], password='testpass123', role='landlord'
        )
        LandlordProfile.objects.create(
            user=user, full_name='Existing Landlord', national_id_number='GHA-G1',
            preferred_payout_method='momo',
        )

        response = self._post({'token': 'fake', 'role': 'renter'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['role'], User.Role.LANDLORD)
        self.assertEqual(User.objects.filter(email=self.PAYLOAD['email']).count(), 1)
        self.assertFalse(RenterProfile.objects.filter(user=user).exists())
        # `role` only applies to a brand-new account. Signing in again
        # must not switch an existing landlord to renter.

    def test_new_user_is_marked_verified_and_google(self):
        response = self._post({'token': 'fake', 'role': 'renter'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user = User.objects.get(email=self.PAYLOAD['email'])
        self.assertTrue(user.is_verified)
        self.assertEqual(user.sign_in_method, User.SignInMethod.GOOGLE)
        self.assertEqual(user.first_name, 'Kofi')
        self.assertEqual(RenterProfile.objects.get(user=user).full_name, 'Kofi Boateng')

    def test_google_profile_photo_is_saved_for_new_user(self):
        from django.test import override_settings

        payload = dict(self.PAYLOAD, picture='https://lh3.googleusercontent.com/a/photo')
        with patch('accounts.views.requests.get') as mock_get, override_settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.memory.InMemoryStorage'},
            'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
        }):
            # Two fakes: requests.get so no real download happens, and an
            # in-memory file store so nothing is uploaded to R2.
            mock_get.return_value.status_code = 200
            mock_get.return_value.content = b'fake-image-bytes'

            response = self._post({'token': 'fake', 'role': 'renter'}, payload=payload)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_get.assert_called_once_with('https://lh3.googleusercontent.com/a/photo')
        user = User.objects.get(email=self.PAYLOAD['email'])
        self.assertTrue(user.profile_image.name.endswith('_google.jpg'))

    def test_failed_photo_download_does_not_block_login(self):
        payload = dict(self.PAYLOAD, picture='https://lh3.googleusercontent.com/a/missing')
        with patch('accounts.views.requests.get') as mock_get:
            mock_get.return_value.status_code = 404

            response = self._post({'token': 'fake', 'role': 'renter'}, payload=payload)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user = User.objects.get(email=self.PAYLOAD['email'])
        self.assertFalse(user.profile_image)
        # No photo, but the person is signed in.


class MeProfileChoiceValidationTests(APITestCase):
    # PATCH /accounts/me/ refuses values that aren't one of a field's
    # choices, for each role's own choice fields.

    def setUp(self):
        self.renter = User.objects.create_user(
            email='choice-renter@example.com', password='testpass123', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(user=self.renter, full_name='Choice Renter')

        self.landlord = User.objects.create_user(
            email='choice-landlord@example.com', password='testpass123', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord, full_name='Choice Landlord',
            national_id_number='GHA-C1', preferred_payout_method='momo'
        )

    def test_renter_invalid_payment_method_is_400(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.patch(
            '/accounts/me/', {'preferred_payment_method': 'bitcoin'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

    def test_landlord_invalid_payout_method_is_400_and_writes_nothing(self):
        self.client.force_authenticate(user=self.landlord)

        response = self.client.patch(
            '/accounts/me/', {'preferred_payout_method': 'bitcoin'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.landlord_profile.refresh_from_db()
        self.assertEqual(self.landlord_profile.preferred_payout_method, 'momo')

    def test_landlord_can_update_full_name(self):
        self.client.force_authenticate(user=self.landlord)

        response = self.client.patch('/accounts/me/', {'full_name': 'Renamed Landlord'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.landlord_profile.refresh_from_db()
        self.assertEqual(self.landlord_profile.full_name, 'Renamed Landlord')


class LoginThrottleTests(APITestCase):
    # POST /accounts/login/ allows 5 attempts a minute per IP address
    # (the 'login' rate in settings.py), to slow down password guessing.
    #
    # Rate limits count requests in Django's cache, and the cache is NOT
    # reset between tests the way the database is. So this class clears
    # it before AND after each test: before, so earlier tests' requests
    # don't count; after, so this test's 429s don't leak into later ones.

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.addCleanup(cache.clear)
        # addCleanup — runs after the test even if it fails, unlike code
        # at the end of the test method.

        User.objects.create_user(email='guess-me@example.com', password='testpass123', role='renter')

    def test_sixth_attempt_in_a_minute_is_429(self):
        wrong = {'email': 'guess-me@example.com', 'password': 'wrong-guess'}

        for attempt in range(5):
            response = self.client.post('/accounts/login/', wrong, format='json')
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, f'attempt {attempt + 1}')

        response = self.client.post('/accounts/login/', wrong, format='json')

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_even_the_right_password_waits_once_throttled(self):
        for _ in range(5):
            self.client.post('/accounts/login/', {'email': 'guess-me@example.com', 'password': 'nope'}, format='json')

        response = self.client.post(
            '/accounts/login/', {'email': 'guess-me@example.com', 'password': 'testpass123'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        # The limit is checked before the password, so a guesser can't
        # tell a right guess from a wrong one while they're throttled.


class CreateSuperuserFromEnvCommandTests(APITestCase):
    # `python manage.py create_superuser_from_env` — Render's free tier
    # has no shell, so the first admin is created from two env vars.
    #
    # patch.dict(os.environ, {...}) sets environment variables for the
    # length of the `with` block only, then puts the old ones back.
    # call_command runs a management command from Python, the same as
    # typing it in a terminal; stdout=StringIO() captures what it prints.

    ENV = {'DJANGO_SUPERUSER_EMAIL': 'boss@example.com', 'DJANGO_SUPERUSER_PASSWORD': 'a-long-pass-123'}

    def _run(self, env):
        import os
        from io import StringIO
        from django.core.management import call_command

        out = StringIO()
        with patch.dict(os.environ, env):
            call_command('create_superuser_from_env', stdout=out)
        return out.getvalue()

    def test_creates_superuser_from_env(self):
        output = self._run(self.ENV)

        user = User.objects.get(email='boss@example.com')
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.check_password('a-long-pass-123'))
        self.assertIn('created', output)

    def test_running_twice_does_not_duplicate_or_change_password(self):
        self._run(self.ENV)

        output = self._run(dict(self.ENV, DJANGO_SUPERUSER_PASSWORD='a-different-pass'))

        self.assertEqual(User.objects.filter(email='boss@example.com').count(), 1)
        self.assertTrue(User.objects.get(email='boss@example.com').check_password('a-long-pass-123'))
        self.assertIn('already exists', output)
        # Safe to leave in a build command by mistake: later deploys
        # don't reset the admin's password back to the env value.

    def test_missing_env_vars_create_nobody(self):
        output = self._run({'DJANGO_SUPERUSER_EMAIL': '', 'DJANGO_SUPERUSER_PASSWORD': ''})

        self.assertFalse(User.objects.filter(is_superuser=True).exists())
        self.assertIn('skipping', output)
