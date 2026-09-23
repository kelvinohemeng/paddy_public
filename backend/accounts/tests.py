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