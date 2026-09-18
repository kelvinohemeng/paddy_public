from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.gis.geos import Point
# Point — GeoDjango's coordinate class, used here to give test listings
# REAL coordinates to filter against. Same toolbox as Polygon in
# views.py, just the "single location" shape instead of "rectangle"

from accounts.models import User, LandlordProfile, RenterProfile
from core.models import Amenity
from .models import Listing, SavedListing


class ListingCreateTests(APITestCase):

    def setUp(self):
        # Runs before EVERY test in this class — same pattern as
        # MeEndpointTests.setUp in accounts/tests.py

        self.landlord_user = User.objects.create_user(
            email='landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Test Landlord',
            national_id_number='GHA-123', preferred_payout_method='momo'
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
            preferred_payout_method='momo'
        )

        self.other_landlord = User.objects.create_user(
            email='other@example.com', password='pass123456', role='landlord'
        )
        self.other_profile = LandlordProfile.objects.create(
            user=self.other_landlord, full_name='Other', national_id_number='GHA-2',
            preferred_payout_method='momo'
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
            national_id_number='GHA-999', preferred_payout_method='momo'
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
            national_id_number='GHA-888', preferred_payout_method='momo'
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


class ListingUnlockGatingTests(APITestCase):
    # Covers _has_access on ListingSerializer — the actual security
    # boundary for the "pay per listing" feature. Every test here
    # checks the RAW response data for address_precise/landlord_contact
    # directly, not just a status code, since the whole point of this
    # feature is exactly WHAT gets included in the response body

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='unlocklandlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Unlock Landlord',
            national_id_number='GHA-777', preferred_payout_method='momo'
        )
        self.landlord_user.phone = '0207654321'
        self.landlord_user.save()
        # Giving this landlord a real phone number specifically so we
        # can assert the UNLOCKED case genuinely returns it, not just
        # that the LOCKED case hides an empty string (which would be a
        # much weaker, less convincing test)

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Gated listing', description='Test', listing_type='rent',
            price_monthly='2000.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='42 Secret Ave',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        self.renter_user = User.objects.create_user(
            email='unlockrenter@example.com', password='pass123456'
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Renter')

        self.other_landlord_user = User.objects.create_user(
            email='otherlandlord@example.com', password='pass123456', role='landlord'
        )
        LandlordProfile.objects.create(
            user=self.other_landlord_user, full_name='Other Landlord',
            national_id_number='GHA-666', preferred_payout_method='momo'
        )
        # A SECOND, unrelated landlord — used to prove landlords don't
        # get a blanket free pass on EVERY listing just for having the
        # landlord role, only their OWN listings or via an active
        # subscription

        self.staff_user = User.objects.create_user(
            email='unlockstaff@example.com', password='pass123456', role='staff'
        )

    def test_renter_without_payment_sees_locked_details(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertIsNone(response.data['address_precise'])
        self.assertIsNone(response.data['landlord_contact'])
        self.assertFalse(response.data['is_unlocked'])
        # The actual security check — not just a locked-looking flag,
        # but confirming the REAL address text and contact dict never
        # made it into the response body at all

    def test_owner_landlord_sees_own_listing_unlocked(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.data['address_precise'], '42 Secret Ave')
        self.assertEqual(response.data['landlord_contact']['phone'], '0207654321')
        self.assertTrue(response.data['is_unlocked'])

    def test_other_landlord_without_subscription_sees_locked_details(self):
        # THE key negative case for this feature's actual product
        # decision — a landlord role alone is NOT a free pass on
        # someone ELSE's listing, only an ACTIVE subscription is

        self.client.force_authenticate(user=self.other_landlord_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertIsNone(response.data['address_precise'])
        self.assertIsNone(response.data['landlord_contact'])
        self.assertFalse(response.data['is_unlocked'])

    def test_landlord_with_active_subscription_sees_unlocked(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta

        LandlordSubscription.objects.create(
            landlord_profile=self.other_landlord_user.landlordprofile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=20),
        )

        self.client.force_authenticate(user=self.other_landlord_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.data['address_precise'], '42 Secret Ave')
        self.assertTrue(response.data['is_unlocked'])
        # An ACTIVE paid subscription is a genuine platform-wide perk —
        # unlocks OTHER landlords' listings too, not just raising their
        # own listing cap

    def test_landlord_with_expired_subscription_stays_locked(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta

        LandlordSubscription.objects.create(
            landlord_profile=self.other_landlord_user.landlordprofile,
            tier=LandlordSubscription.Tier.AGENT,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() - timedelta(days=1),
            # Expired
        )

        self.client.force_authenticate(user=self.other_landlord_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertIsNone(response.data['address_precise'])
        self.assertFalse(response.data['is_unlocked'])

    def test_staff_always_sees_unlocked(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.data['address_precise'], '42 Secret Ave')
        self.assertTrue(response.data['is_unlocked'])

    def test_renter_who_paid_sees_unlocked(self):
        from payments.models import ListingUnlock

        ListingUnlock.objects.create(user=self.renter_user, listing=self.listing)
        # Simulates what the webhook does on a confirmed charge.success —
        # we're testing the GATING logic here, not the Paystack
        # round-trip itself, so creating the row directly is correct

        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.data['address_precise'], '42 Secret Ave')
        self.assertEqual(response.data['landlord_contact']['phone'], '0207654321')
        self.assertTrue(response.data['is_unlocked'])

    def test_unlock_is_per_listing_not_platform_wide(self):
        # THE test proving this is genuinely pay-PER-LISTING, not a
        # platform-wide pass — a real risk if _has_access were ever
        # accidentally written to check "has this user unlocked ANY
        # listing" instead of "has this user unlocked THIS listing"

        from payments.models import ListingUnlock

        other_listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='A different listing', description='Test', listing_type='rent',
            price_monthly='1500.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='99 Other Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        ListingUnlock.objects.create(user=self.renter_user, listing=self.listing)
        # Paid to unlock ONLY self.listing, not other_listing

        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{other_listing.id}/')

        self.assertIsNone(response.data['address_precise'])
        self.assertFalse(response.data['is_unlocked'])
        # The unlock for a DIFFERENT listing must not leak access here

    def test_map_pin_stays_visible_when_locked(self):
        # Per the explicit product decision: the lat/long point (used
        # for the Discovery Hub map) is NOT part of the paywall — only
        # address_precise (the text address) and landlord contact are
        # gated. Confirms `location` is never touched by _has_access at
        # all, since it's excluded from the gating logic entirely

        from django.contrib.gis.geos import Point

        self.listing.location = Point(-0.18, 5.60)
        self.listing.save()

        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertIsNone(response.data['address_precise'])
        self.assertFalse(response.data['is_unlocked'])
        self.assertIsNotNone(response.data['location'])
        # Locked on address/contact, but the map pin is still there


class ListingAnonymousAccessTests(APITestCase):
    # Regression tests for issue #8: "Unblock unauthenticated users
    # from listing backend" — browsing the marketplace must be free,
    # per the documented business model (AGENTS.md), while precise
    # address + landlord contact stay gated behind pay-to-unlock. A
    # separate class from ListingCreateTests since none of these tests
    # authenticate at all — that absence of force_authenticate IS the
    # thing being tested.

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='anon-test-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Test Landlord',
            national_id_number='GHA-456', preferred_payout_method='momo'
        )

    def test_anonymous_user_can_list_published_listings(self):
        # THE regression test for issue #8: an unauthenticated request
        # (no force_authenticate call at all — self.client is a plain,
        # logged-out client here) must be able to browse published
        # listings. Before the get_permissions() override, this
        # endpoint required IsAuthenticated for every action including
        # list/retrieve, so this request would have come back 401.

        Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Public listing', description='Test', listing_type='rent',
            price_monthly='1800.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='5 Public Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        response = self.client.get('/listings/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data['results'] if 'results' in response.data else response.data
        self.assertGreaterEqual(len(results), 1)

    def test_anonymous_user_can_retrieve_a_published_listing(self):
        listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Public single listing', description='Test', listing_type='rent',
            price_monthly='1800.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='6 Public Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        response = self.client.get(f'/listings/{listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_anonymous_user_cannot_see_precise_address_or_contact(self):
        # Opening list/retrieve to anonymous visitors must NOT leak the
        # paywalled fields — _has_access() already returns False for a
        # request with no authenticated user (see serializers.py), this
        # just confirms that still holds now that the request can
        # actually reach the endpoint at all.

        listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Gated listing', description='Test', listing_type='rent',
            price_monthly='1800.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='7 Secret Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        response = self.client.get(f'/listings/{listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['address_precise'])
        self.assertIsNone(response.data['landlord_contact'])
        self.assertFalse(response.data['is_unlocked'])

    def test_anonymous_user_cannot_see_draft_listings(self):
        # Anonymous browsing must still respect the same
        # published-only visibility rule as a logged-in renter —
        # get_queryset()'s public branch, not some separate unfiltered
        # path opened up by mistake alongside the permission change.

        Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Draft listing', description='Test', listing_type='rent',
            price_monthly='1800.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='8 Draft Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.DRAFT,
        )

        response = self.client.get('/listings/')

        results = response.data['results'] if 'results' in response.data else response.data
        titles = [item['title'] for item in results]
        self.assertNotIn('Draft listing', titles)

    def test_anonymous_user_cannot_create_listing(self):
        # Only list/retrieve were opened up — create must still require
        # login, same as before this change.

        data = {
            'title': 'Should be blocked',
            'description': 'Test',
            'listing_type': 'rent',
            'price_monthly': '1000.00',
            'advance_rent_period': '1_year',
            'bedrooms': 1,
            'bathrooms': 1,
            'address_precise': '1 Blocked Rd',
            'neighborhood': 'Osu',
            'city': 'Accra',
        }

        response = self.client.post('/listings/', data)

        self.assertIn(response.status_code,
                       (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))


class SavedListingTests(APITestCase):
    # "Saved Homes" — covers the save/unsave toggle on ListingViewSet and
    # the read-only SavedListingViewSet list endpoint

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='saved-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Saved Test Landlord',
            national_id_number='GHA-500', preferred_payout_method='momo'
        )

        self.renter_user = User.objects.create_user(
            email='saved-renter@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Saved Test Renter'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Saveable listing', description='Test', listing_type='rent',
            price_monthly='1500.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='9 Save Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

    def test_renter_can_save_a_listing(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/listings/{self.listing.id}/save/')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(SavedListing.objects.filter(
            renter_profile=self.renter_profile, listing=self.listing
        ).count(), 1)

    def test_saving_twice_is_idempotent(self):
        self.client.force_authenticate(user=self.renter_user)

        self.client.post(f'/listings/{self.listing.id}/save/')
        response = self.client.post(f'/listings/{self.listing.id}/save/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # 200 the SECOND time (already existed), not another 201 —
        # and critically, no IntegrityError from unique_together
        self.assertEqual(SavedListing.objects.filter(
            renter_profile=self.renter_profile, listing=self.listing
        ).count(), 1)

    def test_renter_can_unsave_a_listing(self):
        self.client.force_authenticate(user=self.renter_user)
        self.client.post(f'/listings/{self.listing.id}/save/')

        response = self.client.delete(f'/listings/{self.listing.id}/save/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SavedListing.objects.filter(
            renter_profile=self.renter_profile, listing=self.listing
        ).exists())

    def test_unsaving_something_never_saved_is_a_harmless_noop(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.delete(f'/listings/{self.listing.id}/save/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_landlord_cannot_save_a_listing(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post(f'/listings/{self.listing.id}/save/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_saved_listings_endpoint_returns_only_own_saved_listings(self):
        other_renter_user = User.objects.create_user(
            email='other-saved-renter@example.com', password='pass123456', role='renter'
        )
        other_renter_profile = RenterProfile.objects.create(
            user=other_renter_user, full_name='Other Renter'
        )
        SavedListing.objects.create(renter_profile=other_renter_profile, listing=self.listing)

        self.client.force_authenticate(user=self.renter_user)
        self.client.post(f'/listings/{self.listing.id}/save/')

        response = self.client.get('/listings/saved/')

        results = response.data['results'] if 'results' in response.data else response.data
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['listing'], self.listing.id)

    def test_saved_listings_endpoint_requires_authentication(self):
        response = self.client.get('/listings/saved/')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class ListingSerializerExpandedFieldsTests(APITestCase):
    # Covers the newer read-only fields on ListingSerializer:
    # landlord_public, is_staff_verified, is_saved, photos,
    # amenities_detail — none of these gate on _has_access (unlike
    # address_precise/landlord_contact), they're either always safe to
    # show or scoped to the CURRENT requester's own state

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='expanded-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Expanded Landlord',
            national_id_number='GHA-900', id_verified=True,
            preferred_payout_method='momo',
        )

        self.staff_user = User.objects.create_user(
            email='expanded-staff@example.com', password='pass123456', role='staff'
        )
        from accounts.models import StaffProfile
        self.staff_profile = StaffProfile.objects.create(
            user=self.staff_user, full_name='Expanded Staff', can_approve_listings=True,
        )

        self.renter_user = User.objects.create_user(
            email='expanded-renter@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Expanded Renter'
        )

        from django.utils import timezone
        self.verified_listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Verified expanded listing', description='Test', listing_type='rent',
            price_monthly='1700.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='20 Expanded Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
            verified_by_staff=self.staff_profile, verified_at=timezone.now(),
        )

        self.unverified_listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Unverified expanded listing', description='Test', listing_type='rent',
            price_monthly='1600.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='21 Expanded Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

        amenity_1 = Amenity.objects.create(name='Wifi Demo', slug='wifi-demo')
        amenity_2 = Amenity.objects.create(name='Parking Demo', slug='parking-demo')
        self.verified_listing.amenities.set([amenity_1, amenity_2])

    def test_landlord_public_is_always_visible_and_has_no_contact_info(self):
        # Anonymous request — landlord_contact stays locked, but
        # landlord_public should still be there with a name + verified flag
        response = self.client.get(f'/listings/{self.verified_listing.id}/')

        self.assertIsNone(response.data['landlord_contact'])
        self.assertEqual(response.data['landlord_public']['full_name'], 'Expanded Landlord')
        self.assertTrue(response.data['landlord_public']['id_verified'])
        self.assertNotIn('phone', response.data['landlord_public'])
        self.assertNotIn('email', response.data['landlord_public'])

    def test_is_staff_verified_reflects_verification_state(self):
        response = self.client.get(f'/listings/{self.verified_listing.id}/')
        self.assertTrue(response.data['is_staff_verified'])

        response = self.client.get(f'/listings/{self.unverified_listing.id}/')
        self.assertFalse(response.data['is_staff_verified'])

    def test_is_saved_reflects_current_renters_own_saved_state(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.verified_listing.id}/')
        self.assertFalse(response.data['is_saved'])

        self.client.post(f'/listings/{self.verified_listing.id}/save/')

        response = self.client.get(f'/listings/{self.verified_listing.id}/')
        self.assertTrue(response.data['is_saved'])

    def test_is_saved_is_false_for_anonymous_and_non_renter_roles(self):
        response = self.client.get(f'/listings/{self.verified_listing.id}/')
        self.assertFalse(response.data['is_saved'])

        self.client.force_authenticate(user=self.landlord_user)
        response = self.client.get(f'/listings/{self.verified_listing.id}/')
        self.assertFalse(response.data['is_saved'])

    def test_amenities_detail_returns_nested_objects_while_amenities_stays_ids(self):
        response = self.client.get(f'/listings/{self.verified_listing.id}/')

        self.assertEqual(set(response.data['amenities']), set(
            self.verified_listing.amenities.values_list('id', flat=True)
        ))
        # amenities stays a plain list of PKs — write shape unchanged

        detail_names = {a['name'] for a in response.data['amenities_detail']}
        self.assertEqual(detail_names, {'Wifi Demo', 'Parking Demo'})

    def test_photos_field_is_present_and_empty_when_no_photos_uploaded(self):
        response = self.client.get(f'/listings/{self.verified_listing.id}/')

        self.assertIn('photos', response.data)
        self.assertEqual(response.data['photos'], [])

    def test_photos_field_reflects_uploaded_photos(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        self.client.force_authenticate(user=self.landlord_user)

        image = SimpleUploadedFile(
            'test.jpg', b'fake-image-bytes', content_type='image/jpeg'
        )

        # Force an in-memory storage backend for JUST this test —
        # without this, ImageField.save() goes through whatever
        # STORAGES['default'] settings.py configures, which is real
        # Cloudflare R2 (django-storages/boto3). That's correct for the
        # real app, but CI deliberately supplies dummy R2 credentials
        # (see backend-ci.yml) on the assumption no test ever performs
        # a genuine upload — this is the first test that does, so it
        # needs its own isolated, network-free storage to match that
        # assumption rather than breaking it
        with override_settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.memory.InMemoryStorage'},
            'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
        }):
            self.client.post(
                f'/listings/{self.verified_listing.id}/photos/',
                {'images': [image]}, format='multipart',
            )

            response = self.client.get(f'/listings/{self.verified_listing.id}/')

        self.assertEqual(len(response.data['photos']), 1)
        self.assertTrue(response.data['photos'][0]['is_cover'])