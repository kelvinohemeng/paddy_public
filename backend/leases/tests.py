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
