"""
Staff onboarding, part 2: staff and admins create and manage listings for
a landlord (Kelvin's Phase 2 decisions). Part 1, creating the landlord
accounts, is tested in accounts/test_staff_landlords.py.
"""

from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User, LandlordProfile, StaffProfile
from payments.models import LandlordSubscription
from .models import Listing, ListingPhoto
from .tests import IN_MEMORY_STORAGES, _real_jpeg_bytes


BODY = {
    'title': 'Two bedroom in Osu', 'description': 'Listed on a site visit', 'listing_type': 'rent',
    'price_monthly': '2500.00', 'advance_rent_period': '1_year', 'bedrooms': 2, 'bathrooms': 1,
    'address_precise': '7 Visit Rd', 'neighborhood': 'Osu', 'city': 'Accra',
}


def _user(email, role, **extra):
    # No password: force_authenticate doesn't need one, and these tests
    # never sign in through the login endpoint.
    return User.objects.create_user(email=email, role=role, is_verified=True, **extra)


def _landlord(email):
    user = _user(email, User.Role.LANDLORD)
    return user, LandlordProfile.objects.create(user=user, full_name=email.split('@')[0])
    # No national_id_number: staff-created landlords don't have one (B5).


def _listing(profile, title, status_value=Listing.Status.PUBLISHED, **extra):
    return Listing.objects.create(
        landlord_profile=profile, status=status_value, **{**BODY, 'title': title, **extra}
    )


class StaffCreateListingTests(APITestCase):

    def setUp(self):
        self.landlord, self.profile = _landlord('field-landlord@example.com')

        self.approver = _user('approver@example.com', User.Role.STAFF)
        self.approver_profile = StaffProfile.objects.create(
            user=self.approver, full_name='Approver', can_approve_listings=True
        )
        self.junior = _user('junior@example.com', User.Role.STAFF)
        StaffProfile.objects.create(user=self.junior, full_name='Junior')
        self.admin = _user('admin-creator@example.com', User.Role.ADMIN)

    def _create(self, user, **extra):
        self.client.force_authenticate(user=user)
        return self.client.post('/listings/', {**BODY, **extra}, format='json')

    def test_approving_staff_member_publishes_for_the_landlord(self):
        response = self._create(self.approver, landlord_profile_id=self.profile.id)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], Listing.Status.PUBLISHED)
        listing = Listing.objects.get(id=response.data['id'])
        self.assertEqual(listing.landlord_profile, self.profile)
        self.assertEqual(listing.created_by, self.approver)
        self.assertEqual(listing.verified_by_staff, self.approver_profile)
        self.assertIsNotNone(listing.verified_at)
        self.assertIsNotNone(listing.published_at)

    def test_other_staff_send_it_to_review(self):
        response = self._create(self.junior, landlord_profile_id=self.profile.id)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], Listing.Status.PENDING_REVIEW)
        listing = Listing.objects.get(id=response.data['id'])
        self.assertIsNone(listing.verified_at)
        self.assertIsNone(listing.published_at)
        self.assertEqual(listing.created_by, self.junior)

    def test_admin_publishes_without_a_staff_profile(self):
        response = self._create(self.admin, landlord_profile_id=self.profile.id)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        listing = Listing.objects.get(id=response.data['id'])
        self.assertEqual(listing.status, Listing.Status.PUBLISHED)
        self.assertIsNone(listing.verified_by_staff)
        self.assertIsNotNone(listing.verified_at)

    def test_staff_must_choose_a_real_landlord(self):
        renter = _user('not-a-landlord@example.com', User.Role.RENTER)
        renter_row = LandlordProfile.objects.create(user=renter, full_name='Wrong role')
        # A LandlordProfile whose user isn't a landlord any more must not count.

        for value in (None, 'abc', 999999, renter_row.id):
            extra = {} if value is None else {'landlord_profile_id': value}
            response = self._create(self.approver, **extra)
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, value)
            self.assertIn('landlord_profile_id', response.data)
        self.assertFalse(Listing.objects.exists())

    def test_landlord_cannot_pass_landlord_profile_id(self):
        _, other_profile = _landlord('other-field-landlord@example.com')

        response = self._create(self.landlord, landlord_profile_id=other_profile.id)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Listing.objects.exists())

    def test_landlord_create_is_unchanged_and_records_the_landlord(self):
        response = self._create(self.landlord)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        listing = Listing.objects.get(id=response.data['id'])
        self.assertEqual(listing.status, Listing.Status.DRAFT)
        self.assertEqual(listing.landlord_profile, self.profile)
        self.assertEqual(listing.created_by, self.landlord)

    def test_renter_gets_403(self):
        renter = _user('renter-field@example.com', User.Role.RENTER)

        response = self._create(renter, landlord_profile_id=self.profile.id)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Listing.objects.exists())

    def test_live_limit_is_the_landlords_not_the_staff_members(self):
        for i in range(3):
            _listing(self.profile, f'Live {i}')
        # Free plan: 3 live, all used.
        _, roomy_profile = _landlord('roomy@example.com')

        full = self._create(self.approver, landlord_profile_id=self.profile.id)
        roomy = self._create(self.approver, landlord_profile_id=roomy_profile.id)

        self.assertEqual(full.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(full.data['code'], 'listing_limit_reached')
        self.assertEqual(Listing.objects.filter(landlord_profile=self.profile).count(), 3)
        self.assertEqual(roomy.status_code, status.HTTP_201_CREATED)

    def test_a_paid_plan_raises_the_limit(self):
        for i in range(3):
            _listing(self.profile, f'Live {i}')
        LandlordSubscription.objects.create(
            landlord_profile=self.profile, tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
        )

        response = self._create(self.junior, landlord_profile_id=self.profile.id)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_free_total_limit_applies_to_staff_too(self):
        for i in range(10):
            _listing(self.profile, f'Draft {i}', Listing.Status.DRAFT)

        response = self._create(self.approver, landlord_profile_id=self.profile.id)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'listing_total_limit_reached')


class CreatedByMeFilterTests(APITestCase):

    def test_staff_see_only_the_homes_they_added_newest_first(self):
        _, profile = _landlord('filter-landlord@example.com')
        staff = _user('filter-staff@example.com', User.Role.STAFF)
        colleague = _user('filter-colleague@example.com', User.Role.STAFF)
        older = _listing(profile, 'Older', created_by=staff)
        newer = _listing(profile, 'Newer', Listing.Status.DRAFT, created_by=staff)
        _listing(profile, 'Colleague', created_by=colleague)
        _listing(profile, 'Landlord typed it')
        Listing.objects.filter(id=older.id).update(created_at=timezone.now() - timedelta(days=1))

        self.client.force_authenticate(user=staff)
        response = self.client.get('/listings/?created_by=me')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in response.data], [newer.id, older.id])

    def test_it_only_narrows_what_the_user_can_already_see(self):
        # A user whose role changed must not reach the drafts they once
        # typed in for someone else.
        _, profile = _landlord('narrow-landlord@example.com')
        former_staff = _user('former-staff@example.com', User.Role.RENTER)
        draft = _listing(profile, 'Their old draft', Listing.Status.DRAFT, created_by=former_staff)
        public = _listing(profile, 'Their old published one', created_by=former_staff)

        self.client.force_authenticate(user=former_staff)
        response = self.client.get('/listings/?created_by=me')

        ids = [row['id'] for row in response.data]
        self.assertIn(public.id, ids)
        self.assertNotIn(draft.id, ids)


@override_settings(STORAGES=IN_MEMORY_STORAGES)
class StaffManageListingTests(APITestCase):

    def setUp(self):
        self.owner, profile = _landlord('managed-owner@example.com')
        self.other_landlord, _ = _landlord('managed-other@example.com')
        self.staff = _user('managed-staff@example.com', User.Role.STAFF)
        self.listing = _listing(profile, 'Managed home')
        self.photo = ListingPhoto.objects.create(
            listing=self.listing, image='listing_photos/managed-0.jpg', order=0, is_cover=True
        )

    def test_staff_can_edit_someone_elses_listing(self):
        self.client.force_authenticate(user=self.staff)

        response = self.client.patch(
            f'/listings/{self.listing.id}/', {'title': 'Fixed typo', 'status': 'draft'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.title, 'Fixed typo')
        self.assertEqual(self.listing.status, Listing.Status.PUBLISHED)
        # status stays read-only, for staff too: edits never change it.

    def test_staff_can_upload_and_delete_photos(self):
        self.client.force_authenticate(user=self.staff)
        image = SimpleUploadedFile('room.jpg', _real_jpeg_bytes(), content_type='image/jpeg')

        upload = self.client.post(
            f'/listings/{self.listing.id}/photos/', {'images': [image]}, format='multipart'
        )
        delete = self.client.delete(f'/listings/photos/{self.photo.id}/')

        self.assertEqual(upload.status_code, status.HTTP_201_CREATED)
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(list(self.listing.photos.values_list('id', flat=True)), [upload.data[0]['id']])
        # The old photo is gone and the uploaded one is what's left.

    def test_another_landlord_still_cannot_touch_it(self):
        self.client.force_authenticate(user=self.other_landlord)

        edit = self.client.patch(f'/listings/{self.listing.id}/', {'title': 'Hijacked'}, format='json')
        delete = self.client.delete(f'/listings/photos/{self.photo.id}/')

        self.assertEqual(edit.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(delete.status_code, status.HTTP_404_NOT_FOUND)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.title, 'Managed home')
        self.assertTrue(ListingPhoto.objects.filter(id=self.photo.id).exists())
