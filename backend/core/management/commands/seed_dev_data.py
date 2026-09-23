"""
Populate the local database with realistic dev/demo data: amenities, a
handful of landlords/renters/staff, listings spread across Accra/Kumasi
with real geocoded points, plus some SavedListings, ListingUnlocks,
LandlordSubscriptions, and Leases so every backend feature built so far
(Discovery Hub filtering, pay-to-unlock gating, subscriptions, Saved
Homes, the Active Leases dashboard) has something real to look at
locally, without needing a live Paystack transaction for every state.

Safe to run repeatedly — get_or_create everywhere, so re-running never
duplicates rows; it just ensures the same seed data exists.

USAGE:
    python manage.py seed_dev_data
    python manage.py seed_dev_data --flush   # wipe seeded data first
"""
from decimal import Decimal
from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.contrib.gis.geos import Point
from django.utils import timezone

from accounts.models import User, RenterProfile, LandlordProfile, StaffProfile
from core.models import Amenity
from listings.models import Listing, SavedListing
from payments.models import LandlordSubscription, ListingUnlock
from leases.models import Lease, LeaseRecord


# Real-ish coordinates around Accra/Kumasi neighborhoods — not exact
# building locations, just plausible points so PostGIS bbox filtering
# on the Discovery Hub map actually has something meaningful to filter
NEIGHBORHOODS = [
    ('Accra', 'East Legon', 5.6500, -0.1500),
    ('Accra', 'Osu', 5.5560, -0.1830),
    ('Accra', 'Cantonments', 5.5850, -0.1750),
    ('Accra', 'Adenta', 5.7080, -0.1660),
    ('Accra', 'Spintex', 5.6260, -0.1170),
    ('Kumasi', 'Nhyiaeso', 6.6700, -1.6280),
    ('Kumasi', 'Ahodwo', 6.6640, -1.6370),
    ('Kumasi', 'Asokwa', 6.6580, -1.6070),
]

AMENITIES = [
    'Water Storage', 'Backup Power', 'Walled & Gated',
    'Wifi', 'Parking', 'Air Conditioning', 'Furnished', 'Security',
]

LISTING_TITLES = [
    'Modern 2-bedroom apartment', 'Cozy self-contained studio',
    'Spacious 3-bedroom family home', 'Executive townhouse',
    'Newly built 1-bedroom flat', 'Gated compound house',
]


class Command(BaseCommand):
    help = 'Seed the local database with realistic dev/demo data across every app'

    def add_arguments(self, parser):
        parser.add_argument(
            '--flush', action='store_true',
            help='Delete previously-seeded demo users/listings before re-seeding',
        )

    def handle(self, *args, **options):
        if options['flush']:
            self._flush()

        amenities = self._seed_amenities()
        staff_profile = self._seed_staff()
        landlord_profiles = self._seed_landlords()
        renter_profiles = self._seed_renters()
        listings = self._seed_listings(landlord_profiles, amenities, staff_profile)
        self._seed_subscriptions(landlord_profiles)
        self._seed_unlocks(renter_profiles, listings)
        self._seed_saved_listings(renter_profiles, listings)
        self._seed_leases(listings, renter_profiles)

        self.stdout.write(self.style.SUCCESS(
            f'Seed complete: {len(landlord_profiles)} landlords, '
            f'{len(renter_profiles)} renters, {len(listings)} listings.'
        ))

    def _flush(self):
        # Only ever deletes users whose email carries the seed's own
        # +demo tag — never touches a real account someone signed up
        # with, even if this command is accidentally run against a
        # shared/staging database
        deleted, _ = User.objects.filter(email__contains='+demo@').delete()
        self.stdout.write(self.style.WARNING(f'Flushed {deleted} previously-seeded rows.'))

    def _seed_amenities(self):
        amenities = []
        for name in AMENITIES:
            from django.utils.text import slugify
            # .replace('-', '_') — same canonical underscore form as
            # AmenityViewSet.create(): slugify() alone yields hyphens
            # ("Walled & Gated" → "walled-gated"), but the frontend
            # filter + ListingViewSet match on underscore slugs
            # (see core/choices.py). Keep seed and API in agreement.
            amenity, _ = Amenity.objects.get_or_create(
                name=name, defaults={'slug': slugify(name).replace('-', '_')}
            )
            amenities.append(amenity)
        return amenities

    def _seed_staff(self):
        user, created = User.objects.get_or_create(
            email='staff+demo@paddy.dev',
            defaults={'role': User.Role.STAFF, 'is_verified': True},
        )
        if created:
            user.set_password('demo-pass-123')
            user.save()

        profile, _ = StaffProfile.objects.get_or_create(
            user=user,
            defaults={
                'full_name': 'Ama Staff', 'can_approve_listings': True,
                'can_host_viewings': True,
            },
        )
        return profile

    def _seed_landlords(self):
        profiles = []
        names = ['Kofi Asante', 'Efua Mensah', 'Yaw Boateng']
        for i, name in enumerate(names):
            user, created = User.objects.get_or_create(
                email=f'landlord{i}+demo@paddy.dev',
                defaults={'role': User.Role.LANDLORD, 'is_verified': True, 'phone': f'02440000{i}'},
            )
            if created:
                user.set_password('demo-pass-123')
                user.save()

            profile, _ = LandlordProfile.objects.get_or_create(
                user=user,
                defaults={
                    'full_name': name, 'national_id_number': f'GHA-DEMO-{i}',
                    'id_verified': True, 'preferred_payout_method': 'momo',
                },
            )
            profiles.append(profile)
        return profiles

    def _seed_renters(self):
        profiles = []
        names = ['Abena Owusu', 'Kwame Darko', 'Adjoa Frimpong']
        for i, name in enumerate(names):
            user, created = User.objects.get_or_create(
                email=f'renter{i}+demo@paddy.dev',
                defaults={'role': User.Role.RENTER, 'is_verified': True},
            )
            if created:
                user.set_password('demo-pass-123')
                user.save()

            profile, _ = RenterProfile.objects.get_or_create(
                user=user, defaults={'full_name': name, 'occupation': 'professional'},
            )
            profiles.append(profile)
        return profiles

    def _seed_listings(self, landlord_profiles, amenities, staff_profile):
        listings = []
        for i, (city, neighborhood, lat, lng) in enumerate(NEIGHBORHOODS):
            landlord_profile = landlord_profiles[i % len(landlord_profiles)]
            title = LISTING_TITLES[i % len(LISTING_TITLES)]
            # Small deterministic jitter per index so listings in the
            # same neighborhood don't all sit on the exact same point
            jitter = i * 0.002

            listing, created = Listing.objects.get_or_create(
                title=f'{title} - {neighborhood} (demo)',
                landlord_profile=landlord_profile,
                defaults={
                    'description': (
                        f'A staff-verified {title.lower()} in {neighborhood}, {city}. '
                        'Seeded demo data for local development.'
                    ),
                    'listing_type': Listing.ListingType.RENT,
                    'price_monthly': Decimal('1500.00') + (i * Decimal('300.00')),
                    'advance_rent_period': (
                        Listing.AdvanceRentPeriod.SIX_MONTHS if i % 2 == 0
                        else Listing.AdvanceRentPeriod.ONE_YEAR
                    ),
                    'bedrooms': 1 + (i % 4),
                    'bathrooms': 1 + (i % 2),
                    'location': Point(lng + jitter, lat + jitter),
                    'address_precise': f'{10 + i} {neighborhood} Road',
                    'neighborhood': neighborhood,
                    'city': city,
                    'status': Listing.Status.PUBLISHED,
                    'verified_by_staff': staff_profile,
                    'verified_at': timezone.now(),
                    'published_at': timezone.now(),
                },
            )
            if created:
                # Attach 2-3 amenities per listing, varying by index so
                # the amenities filter on Discovery Hub has something
                # real to narrow down
                listing.amenities.set(amenities[i % len(amenities):i % len(amenities) + 3] or amenities[:3])
            listings.append(listing)
        return listings

    def _seed_subscriptions(self, landlord_profiles):
        # First landlord: FREE (no row needed, but create explicitly so
        # it's visible in admin). Second: active 'agent' tier. Third:
        # PAST_DUE, to exercise that state too
        LandlordSubscription.objects.get_or_create(
            landlord_profile=landlord_profiles[0],
            defaults={'tier': LandlordSubscription.Tier.FREE, 'status': LandlordSubscription.Status.INACTIVE},
        )
        LandlordSubscription.objects.get_or_create(
            landlord_profile=landlord_profiles[1],
            defaults={
                'tier': LandlordSubscription.Tier.AGENT,
                'status': LandlordSubscription.Status.ACTIVE,
                'current_period_end': timezone.now() + timedelta(days=25),
                'paystack_customer_code': 'CUS_DEMO_1',
                'paystack_subscription_code': 'SUB_DEMO_1',
            },
        )
        if len(landlord_profiles) > 2:
            LandlordSubscription.objects.get_or_create(
                landlord_profile=landlord_profiles[2],
                defaults={
                    'tier': LandlordSubscription.Tier.LORD,
                    'status': LandlordSubscription.Status.PAST_DUE,
                    'current_period_end': timezone.now() - timedelta(days=2),
                },
            )

    def _seed_unlocks(self, renter_profiles, listings):
        # First renter unlocks the first listing — gives the pay-to-
        # unlock gating something real to demo (is_unlocked=True for
        # this one pairing, False for everything else that renter hasn't paid for)
        if renter_profiles and listings:
            ListingUnlock.objects.get_or_create(
                user=renter_profiles[0].user, listing=listings[0],
                defaults={'paystack_reference': 'T_DEMO_UNLOCK_1'},
            )

    def _seed_saved_listings(self, renter_profiles, listings):
        if not renter_profiles or not listings:
            return
        # First renter saves a couple of listings, exercising the
        # Saved Homes list beyond just the unlocked one
        for listing in listings[1:3]:
            SavedListing.objects.get_or_create(
                renter_profile=renter_profiles[0], listing=listing
            )

    def _seed_leases(self, listings, renter_profiles):
        if not listings or not renter_profiles:
            return

        # One ACTIVE lease on the first listing — populates the renter
        # "Active Leases" dashboard with real data, plus one receipt
        # and one contract record so both RecordType values render
        lease, created = Lease.objects.get_or_create(
            listing=listings[0], renter_profile=renter_profiles[0],
            defaults={
                'landlord_profile': listings[0].landlord_profile,
                'rent_amount_monthly': listings[0].price_monthly,
                'deposit_amount': listings[0].price_monthly * 6,
                'advance_rent_period': listings[0].advance_rent_period,
                'start_date': date.today() - timedelta(days=30),
                'end_date': date.today() + timedelta(days=335),
                'status': Lease.Status.ACTIVE,
            },
        )
        if created:
            LeaseRecord.objects.create(
                lease=lease, record_type=LeaseRecord.RecordType.CONTRACT,
                occurred_at=lease.start_date, notes='Lease agreement signed (demo data).',
            )
            LeaseRecord.objects.create(
                lease=lease, record_type=LeaseRecord.RecordType.RECEIPT,
                method=LeaseRecord.Method.MOMO, amount=lease.deposit_amount,
                reference='MOMO-DEMO-REF-1', occurred_at=lease.start_date,
                notes='Advance rent + deposit paid (demo data).',
            )
