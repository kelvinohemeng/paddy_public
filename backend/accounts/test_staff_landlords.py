import re
from unittest.mock import patch

from django.core import mail
from rest_framework import status
from rest_framework.test import APITestCase

from .models import RESERVED_USERNAMES, USERNAME_PATTERN, LandlordProfile, User
from .views import generate_landlord_username


def _make(email, role, **extra):
    return User.objects.create_user(email=email, password='pass123456', role=role, **extra)


def _invite_uid_and_token(message):
    # Pulls uid and token out of the invite link in an email body, the way
    # the frontend reads them off the URL.
    match = re.search(r'uid=([^&\s]+)&token=([^&\s]+)&invite=1', message.body)
    return match.group(1), match.group(2)


class StaffLandlordAccessTests(APITestCase):
    # Every staff onboarding endpoint is staff/admin only.

    def setUp(self):
        self.landlord = _make('owner@example.com', User.Role.LANDLORD)
        LandlordProfile.objects.create(user=self.landlord, full_name='Owner')

    def test_anonymous_gets_401(self):
        self.assertEqual(self.client.get('/accounts/landlords/').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_renters_and_landlords_get_403_everywhere(self):
        for role in (User.Role.RENTER, User.Role.LANDLORD):
            self.client.force_authenticate(user=_make(f'{role}-caller@example.com', role))
            self.assertEqual(self.client.get('/accounts/landlords/').status_code, status.HTTP_403_FORBIDDEN)
            response = self.client.post('/accounts/landlords/', {
                'first_name': 'Ama', 'last_name': 'Mensah', 'email': 'ama@example.com', 'phone': '0244000000',
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            response = self.client.post(f'/accounts/landlords/{self.landlord.id}/resend-invite/')
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(User.objects.filter(email='ama@example.com').exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_admin_is_allowed(self):
        self.client.force_authenticate(user=_make('admin@example.com', User.Role.ADMIN))
        self.assertEqual(self.client.get('/accounts/landlords/').status_code, status.HTTP_200_OK)


class StaffCreateLandlordTests(APITestCase):

    def setUp(self):
        self.client.force_authenticate(user=_make('staff@example.com', User.Role.STAFF))
        self.body = {
            'first_name': 'Ama', 'last_name': 'Mensah',
            'email': 'ama@example.com', 'phone': '0244123456',
        }

    def test_creates_an_unclaimed_landlord_and_emails_the_invite(self):
        response = self.client.post('/accounts/landlords/', self.body, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email='ama@example.com')
        profile = user.landlordprofile
        self.assertEqual(response.data, {
            'id': user.id, 'landlord_profile_id': profile.id, 'full_name': 'Ama Mensah',
            'email': 'ama@example.com', 'phone': '0244123456', 'username': 'ama_mensah',
            'has_claimed': False,
        })
        self.assertEqual(user.role, User.Role.LANDLORD)
        self.assertFalse(user.has_usable_password())
        self.assertFalse(user.is_verified)
        self.assertEqual(profile.national_id_number, '')
        self.assertFalse(profile.id_verified)

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['ama@example.com'])
        self.assertEqual(mail.outbox[0].subject, 'Your home is on paddy')
        self.assertIn('/reset-password?uid=', mail.outbox[0].body)
        self.assertIn('&invite=1', mail.outbox[0].body)

    def test_duplicate_email_is_email_taken_whatever_the_case(self):
        _make('ama@example.com', User.Role.RENTER)
        response = self.client.post(
            '/accounts/landlords/', {**self.body, 'email': 'AMA@Example.com'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'email_taken')
        self.assertEqual(User.objects.filter(email__iexact='ama@example.com').count(), 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_all_four_fields_are_required(self):
        for field in self.body:
            response = self.client.post(
                '/accounts/landlords/', {**self.body, field: ''}, format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn(field, response.data)
        self.assertFalse(User.objects.filter(email='ama@example.com').exists())

    def test_request_cannot_choose_role_password_or_verification(self):
        response = self.client.post('/accounts/landlords/', {
            **self.body, 'role': 'admin', 'password': 'chosenpass123', 'is_verified': True,
            'username': 'picked_by_client',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email='ama@example.com')
        self.assertEqual(user.role, User.Role.LANDLORD)
        self.assertFalse(user.has_usable_password())
        self.assertFalse(user.is_verified)
        self.assertEqual(user.username, 'ama_mensah')

    def test_account_is_kept_when_the_invite_email_fails(self):
        # Staff are standing in the property; they can resend later.
        with patch('accounts.views.send_landlord_invite_email', side_effect=Exception('Resend down')), \
                self.assertLogs('accounts.views', level='ERROR'):
            response = self.client.post('/accounts/landlords/', self.body, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data['has_claimed'])
        self.assertTrue(User.objects.filter(email='ama@example.com').exists())


class LandlordInviteClaimTests(APITestCase):
    # The invite link is a password-reset link: it works once, and using
    # it marks the email verified.

    def setUp(self):
        self.client.force_authenticate(user=_make('staff@example.com', User.Role.STAFF))
        self.client.post('/accounts/landlords/', {
            'first_name': 'Kofi', 'last_name': 'Boateng',
            'email': 'kofi@example.com', 'phone': '0200000000',
        }, format='json')
        self.client.force_authenticate(user=None)
        self.uid, self.token = _invite_uid_and_token(mail.outbox[0])

    def _claim(self, password='a-strong-new-pass-1'):
        return self.client.post('/accounts/password-reset/confirm/', {
            'uid': self.uid, 'token': self.token, 'new_password': password,
        }, format='json')

    def test_invite_link_sets_password_and_verifies_email(self):
        self.assertEqual(self._claim().status_code, status.HTTP_200_OK)

        user = User.objects.get(email='kofi@example.com')
        self.assertTrue(user.check_password('a-strong-new-pass-1'))
        self.assertTrue(user.is_verified)
        response = self.client.post('/accounts/login/', {
            'email': 'kofi@example.com', 'password': 'a-strong-new-pass-1',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # "Done when": the invite link lets that landlord sign in.

    def test_invite_link_works_only_once(self):
        self.assertEqual(self._claim().status_code, status.HTTP_200_OK)
        response = self._claim(password='another-strong-pass-2')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(User.objects.get(email='kofi@example.com').check_password('a-strong-new-pass-1'))

    def test_claimed_landlord_shows_as_claimed_and_cannot_be_reinvited(self):
        self._claim()
        self.client.force_authenticate(user=User.objects.get(email='staff@example.com'))

        self.assertTrue(self.client.get('/accounts/landlords/').data[0]['has_claimed'])
        landlord = User.objects.get(email='kofi@example.com')
        response = self.client.post(f'/accounts/landlords/{landlord.id}/resend-invite/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'already_claimed')
        self.assertEqual(len(mail.outbox), 1)


class ResendLandlordInviteTests(APITestCase):

    def setUp(self):
        self.client.force_authenticate(user=_make('staff@example.com', User.Role.STAFF))
        self.client.post('/accounts/landlords/', {
            'first_name': 'Esi', 'last_name': 'Owusu',
            'email': 'esi@example.com', 'phone': '0270000000',
        }, format='json')
        self.landlord = User.objects.get(email='esi@example.com')

    def test_resends_while_unclaimed(self):
        response = self.client.post(f'/accounts/landlords/{self.landlord.id}/resend-invite/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[1].to, ['esi@example.com'])

    def test_never_emails_a_renter_or_staff_member(self):
        renter = _make('renter@example.com', User.Role.RENTER)
        staff = User.objects.get(email='staff@example.com')
        for user in (renter, staff):
            response = self.client.post(f'/accounts/landlords/{user.id}/resend-invite/')
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(len(mail.outbox), 1)

    def test_email_failure_is_reported(self):
        with patch('accounts.views.send_landlord_invite_email', side_effect=Exception('Resend down')), \
                self.assertLogs('accounts.views', level='ERROR'):
            response = self.client.post(f'/accounts/landlords/{self.landlord.id}/resend-invite/')
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


class StaffLandlordSearchTests(APITestCase):

    def setUp(self):
        self.client.force_authenticate(user=_make('staff@example.com', User.Role.STAFF, first_name='Ama'))
        renter = _make('ama.renter@example.com', User.Role.RENTER, first_name='Ama')
        renter.phone = '0244999999'
        renter.save()
        # A renter and a staff member who both match "ama": neither may
        # ever appear in a landlord search.

    def _landlord(self, index, **extra):
        user = _make(f'landlord{index}@example.com', User.Role.LANDLORD, **extra)
        LandlordProfile.objects.create(user=user, full_name=f'{extra.get("first_name", "")} Landlord {index}')
        return user

    def test_returns_at_most_20_and_only_landlords(self):
        for index in range(25):
            self._landlord(index, first_name='Ama')

        results = self.client.get('/accounts/landlords/', {'search': 'ama'}).data

        self.assertEqual(len(results), 20)
        emails = {row['email'] for row in results}
        self.assertTrue(all(email.startswith('landlord') for email in emails))
        self.assertEqual(len(self.client.get('/accounts/landlords/').data), 20)

    def test_matches_name_email_phone_and_username(self):
        target = self._landlord(1, first_name='Kwame', phone='0551234567', username='kwame_owner')
        self._landlord(2, first_name='Yaw')

        for search in ('kwa', 'landlord1@', '0551234', 'kwame_own', 'Kwame Landlord'):
            results = self.client.get('/accounts/landlords/', {'search': search}).data
            self.assertEqual([row['id'] for row in results], [target.id], search)

    def test_landlord_without_profile_is_left_out(self):
        # landlord_profile_id is what staff send to list a home; a
        # landlord with no profile row would have none to send.
        _make('noprofile@example.com', User.Role.LANDLORD)
        self.assertEqual(self.client.get('/accounts/landlords/').data, [])


class GenerateLandlordUsernameTests(APITestCase):

    def test_follows_the_username_rules(self):
        for first, last in [
            ('Ama', 'Mensah'), ('Ádwoa', "O'Neil-Asante"), ('1st', 'Floor'), ('Ɔkɔɔ', 'Ɛ'),
            ('A', 'B'), ('Nana Kwame Adjei', 'Boakye-Yiadom Ofori-Atta Mensah'), ('Paddy', ''),
        ]:
            username = generate_landlord_username(first, last)
            self.assertRegex(username, USERNAME_PATTERN, (first, last))
            self.assertNotIn(username, RESERVED_USERNAMES)

    def test_taken_usernames_get_a_number(self):
        self.assertEqual(generate_landlord_username('Ama', 'Mensah'), 'ama_mensah')
        _make('a@example.com', User.Role.LANDLORD, username='ama_mensah')
        _make('b@example.com', User.Role.LANDLORD, username='ama_mensah_2')
        self.assertEqual(generate_landlord_username('Ama', 'Mensah'), 'ama_mensah_3')
