from rest_framework.test import APITestCase
# DRF's version of Django's TestCase, specifically built for testing API
# endpoints — gives us a `self.client` that can make fake POST/GET requests
# without needing a real running server, and understands JSON naturally

from rest_framework import status
# Same status constants we use in views.py — readable HTTP codes

from .models import User, RenterProfile, LandlordProfile
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