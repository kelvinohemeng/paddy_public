from datetime import date

from rest_framework.test import APITestCase
from rest_framework import status

from accounts.models import User, LandlordProfile, RenterProfile
from listings.models import Listing
from .models import Lease, LeaseRecord


class LeaseTests(APITestCase):
    # The renter "Active Leases" dashboard's backend, plus the staff/
    # landlord record-keeping side (see leases/models.py — leases are
    # created manually, never auto-generated from a payment webhook,
    # since rent/deposit moves off-platform per the current business
    # model)

    def setUp(self):
        self.staff_user = User.objects.create_user(
            email='lease-staff@example.com', password='pass123456', role='staff'
        )

        self.landlord_user = User.objects.create_user(
            email='lease-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Lease Landlord',
            national_id_number='GHA-700', preferred_payout_method='momo'
        )

        self.other_landlord_user = User.objects.create_user(
            email='lease-other-landlord@example.com', password='pass123456', role='landlord'
        )
        self.other_landlord_profile = LandlordProfile.objects.create(
            user=self.other_landlord_user, full_name='Other Landlord',
            national_id_number='GHA-701', preferred_payout_method='momo'
        )

        self.renter_user = User.objects.create_user(
            email='lease-renter@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Lease Renter'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Leasable listing', description='Test', listing_type='rent',
            price_monthly='2000.00', advance_rent_period='1_year',
            bedrooms=3, bathrooms=2, address_precise='10 Lease Rd',
            neighborhood='Cantonments', city='Accra', status=Listing.Status.PUBLISHED,
        )

        self.lease_payload = {
            'listing': self.listing.id,
            'renter_profile': self.renter_profile.id,
            'landlord_profile': self.landlord_profile.id,
            'rent_amount_monthly': '2000.00',
            'deposit_amount': '24000.00',
            'advance_rent_period': '1_year',
            'start_date': '2026-01-01',
            'end_date': '2026-12-31',
        }

    def test_landlord_can_create_a_lease_on_their_own_listing(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/leases/', self.lease_payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Lease.objects.count(), 1)
        lease = Lease.objects.first()
        self.assertEqual(lease.landlord_profile, self.landlord_profile)

    def test_staff_can_create_a_lease(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post('/leases/', self.lease_payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_renter_cannot_create_a_lease(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post('/leases/', self.lease_payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Lease.objects.count(), 0)

    def test_landlord_cannot_create_a_lease_on_someone_elses_listing(self):
        self.client.force_authenticate(user=self.other_landlord_user)

        response = self.client.post('/leases/', self.lease_payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Lease.objects.count(), 0)

    def test_renter_sees_only_their_own_leases(self):
        lease = Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

        other_renter_user = User.objects.create_user(
            email='lease-other-renter@example.com', password='pass123456', role='renter'
        )
        other_renter_profile = RenterProfile.objects.create(
            user=other_renter_user, full_name='Other Renter'
        )
        Lease.objects.create(
            listing=self.listing, renter_profile=other_renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

        self.client.force_authenticate(user=self.renter_user)
        response = self.client.get('/leases/')

        results = response.data['results'] if 'results' in response.data else response.data
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['id'], lease.id)

    def test_landlord_sees_only_leases_on_their_own_listings(self):
        Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

        self.client.force_authenticate(user=self.other_landlord_user)
        response = self.client.get('/leases/')

        results = response.data['results'] if 'results' in response.data else response.data
        self.assertEqual(len(results), 0)

    def test_renter_cannot_delete_a_lease(self):
        lease = Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

        self.client.force_authenticate(user=self.renter_user)
        response = self.client.delete(f'/leases/{lease.id}/')

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class LeaseRecordTests(APITestCase):
    # Contract/receipt entries — structured data only, no file upload
    # (MVP scope), covers the "contract downloads, receipts" part of
    # the Active Leases dashboard

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='record-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Record Landlord',
            national_id_number='GHA-800', preferred_payout_method='momo'
        )

        self.renter_user = User.objects.create_user(
            email='record-renter@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Record Renter'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Record listing', description='Test', listing_type='rent',
            price_monthly='1800.00', advance_rent_period='6_months',
            bedrooms=2, bathrooms=1, address_precise='11 Record Rd',
            neighborhood='Adenta', city='Accra', status=Listing.Status.PUBLISHED,
        )

        self.lease = Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='1800.00',
            deposit_amount='10800.00', advance_rent_period='6_months',
            start_date=date(2026, 1, 1), end_date=date(2026, 6, 30),
        )

    def test_landlord_can_log_a_receipt(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/leases/records/', {
            'lease': self.lease.id,
            'record_type': 'receipt',
            'method': 'momo',
            'amount': '10800.00',
            'reference': 'MOMO-REF-123',
            'occurred_at': '2026-01-01',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(LeaseRecord.objects.count(), 1)

    def test_renter_cannot_log_a_record(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post('/leases/records/', {
            'lease': self.lease.id,
            'record_type': 'receipt',
            'amount': '10800.00',
            'occurred_at': '2026-01-01',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_renter_can_read_their_own_lease_records(self):
        LeaseRecord.objects.create(
            lease=self.lease, record_type='contract', occurred_at=date(2026, 1, 1)
        )

        self.client.force_authenticate(user=self.renter_user)
        response = self.client.get('/leases/records/')

        results = response.data['results'] if 'results' in response.data else response.data
        self.assertEqual(len(results), 1)


class LeaseAdminVisibilityTests(APITestCase):
    # Pins the admin (superuser) oversight contract on leases: sees
    # every lease/record and can record from the console — previously
    # admins fell into the renter branch (empty) on reads and 403d on
    # writes.

    def setUp(self):
        self.admin_user = User.objects.create_user(
            email='lease-admin@example.com', password='pass123456', role='admin'
        )

        self.landlord_user = User.objects.create_user(
            email='adminvis-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Adminvis Landlord',
            national_id_number='GHA-900', preferred_payout_method='momo'
        )

        self.renter_user = User.objects.create_user(
            email='adminvis-renter@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Adminvis Renter'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Adminvis listing', description='Test', listing_type='rent',
            price_monthly='2000.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='12 Adminvis Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        self.lease = Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

    def test_admin_sees_all_leases_and_records(self):
        LeaseRecord.objects.create(
            lease=self.lease, record_type='receipt', method='momo',
            amount='2000.00', occurred_at=date(2026, 1, 1),
        )
        self.client.force_authenticate(user=self.admin_user)

        lease_response = self.client.get('/leases/')
        record_response = self.client.get('/leases/records/')

        for response in (lease_response, record_response):
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            results = response.data['results'] if 'results' in response.data else response.data
            self.assertEqual(len(results), 1)

    def test_admin_can_record_a_lease(self):
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.post('/leases/', {
            'listing': self.listing.id,
            'renter_profile': self.renter_profile.id,
            'landlord_profile': self.landlord_profile.id,
            'rent_amount_monthly': '2000.00',
            'deposit_amount': '24000.00',
            'advance_rent_period': '1_year',
            'start_date': '2026-01-01',
            'end_date': '2026-12-31',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class LeaseConfirmationTests(APITestCase):
    # Kelvin's 2026-09 decision: a lease a LANDLORD records needs the
    # renter's confirmation before it's active.

    def setUp(self):
        LeaseTests.setUp(self)
        # Borrow LeaseTests' setUp (same landlord / renter / listing /
        # payload) by calling it directly, WITHOUT inheriting from
        # LeaseTests — inheriting would also re-run all of LeaseTests'
        # own tests inside this class.

    def _landlord_records_lease(self):
        self.client.force_authenticate(user=self.landlord_user)
        response = self.client.post('/leases/', self.lease_payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return Lease.objects.get(id=response.data['id'])

    def test_landlord_recorded_lease_starts_pending(self):
        lease = self._landlord_records_lease()

        self.assertEqual(lease.status, Lease.Status.PENDING)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.PUBLISHED)
        # Still on Discovery — nothing changes until the renter says yes.

    def test_landlord_cannot_skip_confirmation_by_sending_status(self):
        self.client.force_authenticate(user=self.landlord_user)
        payload = dict(self.lease_payload, status='active')

        response = self.client.post('/leases/', payload, format='json')

        self.assertEqual(Lease.objects.get(id=response.data['id']).status, Lease.Status.PENDING)

    def test_renter_confirm_activates_lease_and_marks_listing_leased(self):
        lease = self._landlord_records_lease()
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/leases/{lease.id}/confirm/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        lease.refresh_from_db()
        self.assertEqual(lease.status, Lease.Status.ACTIVE)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.LEASED)

    def test_renter_decline_keeps_listing_live(self):
        lease = self._landlord_records_lease()
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/leases/{lease.id}/decline/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        lease.refresh_from_db()
        self.assertEqual(lease.status, Lease.Status.DECLINED)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.PUBLISHED)

    def test_landlord_cannot_confirm_on_renters_behalf(self):
        lease = self._landlord_records_lease()

        response = self.client.post(f'/leases/{lease.id}/confirm/')
        # still logged in as the landlord from _landlord_records_lease

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        lease.refresh_from_db()
        self.assertEqual(lease.status, Lease.Status.PENDING)

    def test_another_renter_cannot_confirm(self):
        lease = self._landlord_records_lease()
        stranger = User.objects.create_user(
            email='stranger-renter@example.com', password='pass123456', role='renter'
        )
        RenterProfile.objects.create(user=stranger, full_name='Stranger')
        self.client.force_authenticate(user=stranger)

        response = self.client.post(f'/leases/{lease.id}/confirm/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        # 404, not 403: the stranger's queryset doesn't contain this lease
        # at all, so they can't even learn that it exists.

    def test_confirming_twice_is_rejected(self):
        lease = self._landlord_records_lease()
        self.client.force_authenticate(user=self.renter_user)
        self.client.post(f'/leases/{lease.id}/confirm/')

        response = self.client.post(f'/leases/{lease.id}/confirm/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_landlord_cannot_patch_pending_lease_to_active(self):
        lease = self._landlord_records_lease()

        response = self.client.patch(f'/leases/{lease.id}/', {'status': 'active'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        lease.refresh_from_db()
        self.assertEqual(lease.status, Lease.Status.PENDING)

    def test_landlord_can_end_an_active_lease(self):
        lease = self._landlord_records_lease()
        lease.status = Lease.Status.ACTIVE
        lease.save()

        response = self.client.patch(f'/leases/{lease.id}/', {'status': 'ended'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_staff_recorded_lease_is_active_immediately(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post('/leases/', self.lease_payload, format='json')

        lease = Lease.objects.get(id=response.data['id'])
        self.assertEqual(lease.status, Lease.Status.ACTIVE)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.LEASED)


class LeasePartiesAreFixedTests(APITestCase):
    # A lease's listing / renter / landlord can't be changed by PATCH.

    def setUp(self):
        LeaseTests.setUp(self)
        # Same borrowing trick as LeaseConfirmationTests: LeaseTests' users
        # and listing, then our own extras below.
        self.lease = Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.other_listing = Listing.objects.create(
            landlord_profile=self.other_landlord_profile,
            title='Someone else\'s listing', description='Test', listing_type='rent',
            price_monthly='3000.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='20 Other Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

    def test_landlord_cannot_move_lease_onto_someone_elses_listing(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.patch(
            f'/leases/{self.lease.id}/', {'listing': self.other_listing.id}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.lease.refresh_from_db()
        self.assertEqual(self.lease.listing, self.listing)

    def test_landlord_cannot_hand_lease_to_another_landlord(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.patch(
            f'/leases/{self.lease.id}/', {'landlord_profile': self.other_landlord_profile.id}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.lease.refresh_from_db()
        self.assertEqual(self.lease.landlord_profile, self.landlord_profile)

    def test_resending_the_same_listing_is_fine(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.patch(
            f'/leases/{self.lease.id}/', {'listing': self.listing.id, 'deposit_amount': '20000.00'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class LeasePrivacyAndEditRuleTests(APITestCase):
    # A tenant must never be able to see another tenant's lease, plus the
    # edit rules not covered above. Leases are out of the MVP UI, but the
    # endpoints still exist, so their access rules still need to hold.

    def setUp(self):
        LeaseTests.setUp(self)
        self.lease = Lease.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            landlord_profile=self.landlord_profile, rent_amount_monthly='2000.00',
            deposit_amount='24000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.record = LeaseRecord.objects.create(
            lease=self.lease, record_type='receipt', amount='24000.00', occurred_at=date(2026, 1, 1),
        )

        self.other_renter_user = User.objects.create_user(
            email='lease-other-renter@example.com', password='pass123456', role='renter'
        )
        RenterProfile.objects.create(user=self.other_renter_user, full_name='Other Renter')

    def test_other_renter_cannot_open_the_lease(self):
        self.client.force_authenticate(user=self.other_renter_user)

        response = self.client.get(f'/leases/{self.lease.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        # 404, not 403: a 403 would confirm the lease exists.

    def test_other_renter_cannot_list_or_open_the_lease_records(self):
        self.client.force_authenticate(user=self.other_renter_user)

        listed = self.client.get('/leases/records/')
        opened = self.client.get(f'/leases/records/{self.record.id}/')

        data = listed.data['results'] if 'results' in listed.data else listed.data
        self.assertEqual(list(data), [])
        self.assertEqual(opened.status_code, status.HTTP_404_NOT_FOUND)

    def test_other_landlord_cannot_open_or_edit_the_lease(self):
        self.client.force_authenticate(user=self.other_landlord_user)

        opened = self.client.get(f'/leases/{self.lease.id}/')
        edited = self.client.patch(f'/leases/{self.lease.id}/', {'deposit_amount': '1.00'}, format='json')

        self.assertEqual(opened.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(edited.status_code, status.HTTP_404_NOT_FOUND)
        self.lease.refresh_from_db()
        self.assertEqual(str(self.lease.deposit_amount), '24000.00')

    def test_renter_cannot_edit_their_own_lease(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.patch(f'/leases/{self.lease.id}/', {'deposit_amount': '1.00'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.lease.refresh_from_db()
        self.assertEqual(str(self.lease.deposit_amount), '24000.00')
        # The renter can SEE their lease, so get_object() finds it; the
        # explicit role check in perform_update is what stops the edit.

    def test_landlord_cannot_log_a_record_on_another_landlords_lease(self):
        self.client.force_authenticate(user=self.other_landlord_user)

        response = self.client.post('/leases/records/', {
            'lease': self.lease.id, 'record_type': 'receipt', 'amount': '5.00', 'occurred_at': '2026-02-01',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.lease.records.count(), 1)

    def test_staff_cannot_record_a_lease_with_the_wrong_landlord(self):
        self.client.force_authenticate(user=self.staff_user)
        payload = dict(self.lease_payload, landlord_profile=self.other_landlord_profile.id)

        response = self.client.post('/leases/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Lease.objects.count(), 1)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.PUBLISHED)
        # Nothing saved and the listing is still live.

    def test_staff_lease_on_a_draft_listing_leaves_the_listing_alone(self):
        draft = Listing.objects.create(
            landlord_profile=self.landlord_profile, title='Old draft', description='Test',
            listing_type='rent', price_monthly='2000.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='12 Draft Rd', neighborhood='Osu',
            city='Accra', status=Listing.Status.DRAFT,
        )
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post('/leases/', dict(self.lease_payload, listing=draft.id), format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        draft.refresh_from_db()
        self.assertEqual(draft.status, Listing.Status.DRAFT)
        # Only a PUBLISHED listing flips to leased. Backfilling an old
        # lease must not turn a draft into a "leased" listing.

    def test_declining_a_lease_that_is_not_pending_is_400(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/leases/{self.lease.id}/decline/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.lease.refresh_from_db()
        self.assertEqual(self.lease.status, Lease.Status.ACTIVE)
