from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.gis.geos import Point
# Point — GeoDjango's coordinate class, used here to give test listings
# REAL coordinates to filter against. Same toolbox as Polygon in
# views.py, just the "single location" shape instead of "rectangle"

from accounts.models import User, LandlordProfile, RenterProfile
from .models import Listing


class ListingCreateTests(APITestCase):

    def setUp(self):
        # Runs before EVERY test in this class — same pattern as
        # MeEndpointTests.setUp in accounts/tests.py

        self.landlord_user = User.objects.create_user(
            email='landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Test Landlord',
            national_id_number='GHA-123', momo_or_bank_details='0551234567'
        )
        # We create the User AND its profile manually here, since these
        # tests aren't testing signup — they need a landlord that
        # already fully exists, ready to use

        self.renter_user = User.objects.create_user(
            email='renter@example.com', password='pass123456'
        )
        # A second user, deliberately NOT a landlord — used to prove
        # the role check actually blocks the wrong role

    def test_landlord_can_create_listing(self):
        self.client.force_authenticate(user=self.landlord_user)

        data = {
            'title': 'Nice 2 bedroom',
            'description': 'A lovely place',
            'listing_type': 'rent',
            'price_monthly': '2500.00',
            'advance_rent_period': '1_year',
            'bedrooms': 2,
            'bathrooms': 1,
            'address_precise': '123 Test St',
            'neighborhood': 'East Legon',
            'city': 'Accra',
        }

        response = self.client.post('/listings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Listing.objects.filter(title='Nice 2 bedroom').exists())

        listing = Listing.objects.get(title='Nice 2 bedroom')
        self.assertEqual(listing.landlord_profile, self.landlord_profile)
        # Confirms the listing got tied to the CORRECT landlord —
        # not just that A listing was created

    def test_renter_cannot_create_listing(self):
        self.client.force_authenticate(user=self.renter_user)
        # Logged in, but NOT a landlord

        data = {
            'title': 'Sneaky listing',
            'description': 'Should not be allowed',
            'listing_type': 'rent',
            'price_monthly': '1000.00',
            'advance_rent_period': '6_months',
            'bedrooms': 1,
            'bathrooms': 1,
            'address_precise': '1 Fake St',
            'neighborhood': 'Nowhere',
            'city': 'Accra',
        }

        response = self.client.post('/listings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Listing.objects.filter(title='Sneaky listing').exists())
        # Confirms not just the right status code, but that NOTHING
        # actually got created despite the rejection

    def test_landlord_cannot_set_status_on_create(self):
        # The exact worry you raised — does the exclude actually work?

        self.client.force_authenticate(user=self.landlord_user)

        data = {
            'title': 'Trying to sneak in published',
            'description': 'Test',
            'listing_type': 'rent',
            'price_monthly': '2000.00',
            'advance_rent_period': '1_year',
            'bedrooms': 1,
            'bathrooms': 1,
            'address_precise': '1 Test St',
            'neighborhood': 'Osu',
            'city': 'Accra',
            'status': 'published',
            # Attempting to sneak this in, even though the Serializer
            # excludes it
        }

        response = self.client.post('/listings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # The request still succeeds overall...

        listing = Listing.objects.get(title='Trying to sneak in published')
        self.assertEqual(listing.status, Listing.Status.DRAFT)
        # ...but status silently stayed at the model's real default,
        # proving the exclude genuinely blocks it rather than trusting
        # the client's input

    def test_first_listing_is_free_for_landlord(self):
        self.client.force_authenticate(user=self.landlord_user)

        data = {
            'title': 'First free listing',
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
            'address_precise': '1 Test St', 'neighborhood': 'Osu', 'city': 'Accra',
        }

        response = self.client.post('/listings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # No subscription exists at all for this landlord, yet the
        # FIRST listing still goes through — confirms the free tier
        # genuinely doesn't require any payment setup at all

    def test_second_listing_blocked_without_subscription(self):
        self.client.force_authenticate(user=self.landlord_user)

        first = {
            'title': 'Free listing', 'description': 'Test', 'listing_type': 'rent',
            'price_monthly': '2000.00', 'advance_rent_period': '1_year',
            'bedrooms': 1, 'bathrooms': 1, 'address_precise': '1 Test St',
            'neighborhood': 'Osu', 'city': 'Accra',
        }
        self.client.post('/listings/', first, format='json')
        # Uses up the free tier

        second = {**first, 'title': 'Second listing, should be blocked'}
        response = self.client.post('/listings/', second, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Listing.objects.filter(title='Second listing, should be blocked').exists())

    def test_second_listing_allowed_with_active_subscription(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta

        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
        )

        self.client.force_authenticate(user=self.landlord_user)

        first = {
            'title': 'Free listing 2', 'description': 'Test', 'listing_type': 'rent',
            'price_monthly': '2000.00', 'advance_rent_period': '1_year',
            'bedrooms': 1, 'bathrooms': 1, 'address_precise': '1 Test St',
            'neighborhood': 'Osu', 'city': 'Accra',
        }
        self.client.post('/listings/', first, format='json')

        second = {**first, 'title': 'Paid second listing'}
        response = self.client.post('/listings/', second, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # With an ACTIVE, non-expired subscription in place, the second
        # listing goes through — proves the enforcement genuinely checks
        # the subscription, not just hard-blocking after the first
        # listing unconditionally

    def test_second_listing_blocked_with_expired_subscription(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta

        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() - timedelta(days=1),
            # In the past — expired
        )

        self.client.force_authenticate(user=self.landlord_user)

        first = {
            'title': 'Free listing 3', 'description': 'Test', 'listing_type': 'rent',
            'price_monthly': '2000.00', 'advance_rent_period': '1_year',
            'bedrooms': 1, 'bathrooms': 1, 'address_precise': '1 Test St',
            'neighborhood': 'Osu', 'city': 'Accra',
        }
        self.client.post('/listings/', first, format='json')

        second = {**first, 'title': 'Blocked, expired sub'}
        response = self.client.post('/listings/', second, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        # An existing but EXPIRED subscription must not grant access —
        # this is the exact scenario is_active()'s date check exists for,
        # and confirms even having tier=AGENT stored doesn't matter if
        # is_active() is False — falls back to the FREE cap regardless

    def test_agent_tier_allows_up_to_ten_listings(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta

        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
        )

        self.client.force_authenticate(user=self.landlord_user)

        base = {
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
            'address_precise': '1 Test St', 'neighborhood': 'Osu', 'city': 'Accra',
        }

        for i in range(10):
            response = self.client.post('/listings/', {**base, 'title': f'Agent listing {i}'}, format='json')
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # All 10 succeed — agent tier's cap

        eleventh = self.client.post('/listings/', {**base, 'title': 'Agent listing 11'}, format='json')
        self.assertEqual(eleventh.status_code, status.HTTP_403_FORBIDDEN)
        # The 11th is correctly blocked — proves the cap is genuinely
        # enforced at exactly 10, not "unlimited once you're on a paid
        # tier at all" or some other off-by-one

    def test_lord_tier_has_no_cap(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta

        LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=LandlordSubscription.Tier.LORD,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
        )

        self.client.force_authenticate(user=self.landlord_user)

        base = {
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
            'address_precise': '1 Test St', 'neighborhood': 'Osu', 'city': 'Accra',
        }

        for i in range(15):
            # Deliberately MORE than agent's 10-cap, to prove lord tier
            # genuinely has no limit rather than accidentally inheriting
            # agent's cap
            response = self.client.post('/listings/', {**base, 'title': f'Lord listing {i}'}, format='json')
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class ListingOwnershipTests(APITestCase):

    def setUp(self):
        self.owner = User.objects.create_user(
            email='owner@example.com', password='pass123456', role='landlord'
        )
        self.owner_profile = LandlordProfile.objects.create(
            user=self.owner, full_name='Owner', national_id_number='GHA-1',
            momo_or_bank_details='0551111111'
        )

        self.other_landlord = User.objects.create_user(
            email='other@example.com', password='pass123456', role='landlord'
        )
        self.other_profile = LandlordProfile.objects.create(
            user=self.other_landlord, full_name='Other', national_id_number='GHA-2',
            momo_or_bank_details='0552222222'
        )
        # A SECOND, separate landlord — used to prove they can't touch
        # the first landlord's listing

        self.listing = Listing.objects.create(
            landlord_profile=self.owner_profile,
            title='Owner listing', description='Test',
            listing_type='rent', price_monthly='3000.00',
            advance_rent_period='1_year', bedrooms=3, bathrooms=2,
            address_precise='Test address', neighborhood='Cantonments',
            city='Accra',
        )

    def test_owner_can_update_own_listing(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.patch(
            f'/listings/{self.listing.id}/', {'title': 'Updated title'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.listing.refresh_from_db()
        # IMPORTANT — self.listing was loaded BEFORE the update happened.
        # Python objects don't auto-refresh when the database changes
        # underneath them, so we have to explicitly re-fetch to see the
        # new value

        self.assertEqual(self.listing.title, 'Updated title')

    def test_non_owner_cannot_update_listing(self):
        self.client.force_authenticate(user=self.other_landlord)
        # A DIFFERENT landlord, not the owner

        response = self.client.patch(
            f'/listings/{self.listing.id}/', {'title': 'Hijacked title'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        self.listing.refresh_from_db()
        self.assertEqual(self.listing.title, 'Owner listing')
        # Confirms the title genuinely did NOT change, not just that
        # the response looked like a rejection

    def test_non_owner_cannot_delete_listing(self):
        self.client.force_authenticate(user=self.other_landlord)

        response = self.client.delete(f'/listings/{self.listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Listing.objects.filter(id=self.listing.id).exists())
        # Still exists — nothing was actually deleted


class ListingFilterTests(APITestCase):

    def setUp(self):
        self.renter = User.objects.create_user(
            email='filtertest@example.com', password='pass123456'
        )
        # A plain renter is enough here — filtering applies on TOP of
        # visibility, and all these listings will be published, so a
        # renter can see them same as anyone else

        landlord_user = User.objects.create_user(
            email='filterlandlord@example.com', password='pass123456', role='landlord'
        )
        landlord_profile = LandlordProfile.objects.create(
            user=landlord_user, full_name='Filter Landlord',
            national_id_number='GHA-999', momo_or_bank_details='0559999999'
        )

        # Three listings with deliberately different, testable attributes
        self.accra_cheap = Listing.objects.create(
            landlord_profile=landlord_profile, title='Cheap Accra place',
            description='Test', listing_type='rent', price_monthly='1000.00',
            advance_rent_period='6_months', bedrooms=1, bathrooms=1,
            address_precise='1 Test St', neighborhood='Osu', city='Accra',
            status=Listing.Status.PUBLISHED,
        )

        self.accra_expensive = Listing.objects.create(
            landlord_profile=landlord_profile, title='Expensive Accra place',
            description='Test', listing_type='rent', price_monthly='5000.00',
            advance_rent_period='1_year', bedrooms=3, bathrooms=2,
            address_precise='2 Test St', neighborhood='Cantonments', city='Accra',
            status=Listing.Status.PUBLISHED,
        )

        self.kumasi_listing = Listing.objects.create(
            landlord_profile=landlord_profile, title='Kumasi place',
            description='Test', listing_type='rent', price_monthly='2000.00',
            advance_rent_period='6_months', bedrooms=2, bathrooms=1,
            address_precise='3 Test St', neighborhood='Adum', city='Kumasi',
            status=Listing.Status.PUBLISHED,
        )
        # Note: created with status=PUBLISHED explicitly this time —
        # unlike ListingOwnershipTests, these NEED to be visible to a
        # plain renter for filtering to make sense

    def test_filter_by_city(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/?city=accra')
        # Lowercase 'accra' deliberately — testing the __iexact
        # case-insensitivity actually works

        titles = [item['title'] for item in response.data]
        # Building a plain list of titles from the response, to check
        # membership without caring about exact ordering

        self.assertIn('Cheap Accra place', titles)
        self.assertIn('Expensive Accra place', titles)
        self.assertNotIn('Kumasi place', titles)

    def test_filter_by_price_range(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/?min_price=1500&max_price=3000')

        titles = [item['title'] for item in response.data]

        self.assertNotIn('Cheap Accra place', titles)
        # Excluded — 1000 is below min_price=1500

        self.assertIn('Kumasi place', titles)
        # Included — 2000 is within 1500-3000

        self.assertNotIn('Expensive Accra place', titles)
        # Excluded — 5000 is above max_price=3000

    def test_filter_by_bedrooms(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/?bedrooms=3')

        titles = [item['title'] for item in response.data]

        self.assertEqual(titles, ['Expensive Accra place'])
        # Only one listing has exactly 3 bedrooms — using assertEqual
        # here instead of assertIn, since we want to confirm it's the
        # ONLY result, not just present among others

    def test_combined_filters(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/?city=Accra&max_price=2000')
        # Two filters at once — proves they combine correctly (AND
        # logic, not OR) rather than just testing them in isolation

        titles = [item['title'] for item in response.data]

        self.assertIn('Cheap Accra place', titles)
        # Accra AND <= 2000 — matches

        self.assertNotIn('Expensive Accra place', titles)
        # Accra but NOT <= 2000 — excluded

        self.assertNotIn('Kumasi place', titles)
        # <= 2000 but NOT Accra — excluded

    def test_no_filters_returns_all_published(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/')

        titles = [item['title'] for item in response.data]

        self.assertIn('Cheap Accra place', titles)
        self.assertIn('Expensive Accra place', titles)
        self.assertIn('Kumasi place', titles)
        # Confirms filtering is genuinely OPTIONAL — no params means
        # no narrowing, same as before this feature existed


class ListingMapBoundsTests(APITestCase):
    # Covers the geospatial bounding-box filter specifically — separate
    # class from ListingFilterTests since these listings need REAL
    # coordinates set, which the plain filter tests above don't need

    def setUp(self):
        self.renter = User.objects.create_user(
            email='maptest@example.com', password='pass123456'
        )

        landlord_user = User.objects.create_user(
            email='maplandlord@example.com', password='pass123456', role='landlord'
        )
        landlord_profile = LandlordProfile.objects.create(
            user=landlord_user, full_name='Map Landlord',
            national_id_number='GHA-888', momo_or_bank_details='0558888888'
        )

        # Real-world-ish coordinates: Accra is roughly (lat 5.6, long -0.2),
        # Kumasi is roughly (lat 6.7, long -1.6) — genuinely far apart,
        # so a bounding box drawn around Accra should never accidentally
        # also catch Kumasi

        self.accra_listing = Listing.objects.create(
            landlord_profile=landlord_profile, title='Inside Accra box',
            description='Test', listing_type='rent', price_monthly='2000.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='1 Test St', neighborhood='Osu', city='Accra',
            status=Listing.Status.PUBLISHED,
            location=Point(-0.18, 5.60),
            # Point(longitude, latitude) — GeoDjango takes LONGITUDE
            # first, which is the opposite order from how people usually
            # SAY coordinates out loud ("5.6, -0.18") — easy to flip by
            # accident, worth double-checking whenever writing one
        )

        self.kumasi_listing = Listing.objects.create(
            landlord_profile=landlord_profile, title='Outside box (Kumasi)',
            description='Test', listing_type='rent', price_monthly='2000.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='2 Test St', neighborhood='Adum', city='Kumasi',
            status=Listing.Status.PUBLISHED,
            location=Point(-1.62, 6.69),
        )

        self.no_location_listing = Listing.objects.create(
            landlord_profile=landlord_profile, title='No coordinates set',
            description='Test', listing_type='rent', price_monthly='2000.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='3 Test St', neighborhood='Osu', city='Accra',
            status=Listing.Status.PUBLISHED,
            # location deliberately left unset (stays None) — this is
            # the real-world case of a listing that hasn't been geocoded
            # yet, which the field's null=True was specifically built to
            # allow
        )

        # A rectangle drawn around roughly the Accra area only
        self.accra_box = {
            'north': '5.70', 'south': '5.50', 'east': '-0.10', 'west': '-0.30',
        }

    def test_bounding_box_returns_listing_inside_it(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/', self.accra_box)

        titles = [item['title'] for item in response.data]

        self.assertIn('Inside Accra box', titles)

    def test_bounding_box_excludes_listing_outside_it(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/', self.accra_box)

        titles = [item['title'] for item in response.data]

        self.assertNotIn('Outside box (Kumasi)', titles)
        # Kumasi's real coordinates are genuinely far outside this box —
        # proves the filter is actually doing real geometry, not just
        # letting everything through

    def test_bounding_box_excludes_listing_with_no_location(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/', self.accra_box)

        titles = [item['title'] for item in response.data]

        self.assertNotIn('No coordinates set', titles)
        # Confirms a listing with location=None is safely excluded
        # rather than crashing the query or accidentally matching

    def test_incomplete_bounding_box_is_ignored(self):
        # Sending only SOME of the four corners should be treated as no
        # bounding box at all, not a crash or a partial/broken filter

        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/', {'north': '5.70'})
        # Only one of the four params — south/east/west all missing

        titles = [item['title'] for item in response.data]

        self.assertIn('Inside Accra box', titles)
        self.assertIn('Outside box (Kumasi)', titles)
        self.assertIn('No coordinates set', titles)
        # Everything still comes back, completely unfiltered by location —
        # proves the `if north and south and east and west` guard
        # genuinely requires all four before doing anything

    def test_bounding_box_combines_with_other_filters(self):
        # Proves the geospatial filter and the plain filters from
        # ListingFilterTests genuinely stack together (AND logic),
        # rather than the newer filter accidentally overriding the rest

        self.client.force_authenticate(user=self.renter)

        params = {**self.accra_box, 'bedrooms': '3'}
        # Same Accra box as before, but ALSO requiring 3 bedrooms —
        # our one Accra listing in this box has only 2 bedrooms

        response = self.client.get('/listings/', params)

        titles = [item['title'] for item in response.data]

        self.assertNotIn('Inside Accra box', titles)
        # Inside the box geographically, but wrong bedroom count —
        # correctly excluded, proving both filters are genuinely
        # combined with AND, not just the box filter alone deciding