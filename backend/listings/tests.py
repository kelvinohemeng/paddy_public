from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.gis.geos import Point, GEOSGeometry
# Point — GeoDjango's coordinate class, used here to give test listings
# REAL coordinates to filter against. Same toolbox as Polygon in
# views.py, just the "single location" shape instead of "rectangle"

from accounts.models import User, LandlordProfile, RenterProfile, StaffProfile
# StaffProfile — the review action stamps verified_by_staff, so review
# tests need a real staff reviewer row behind the staff user.
from core.models import Amenity
from .models import Listing, ListingPhoto, SavedListing


class ListingCreateTests(APITestCase):

    def setUp(self):
        # Runs before EVERY test in this class — same pattern as
        # MeEndpointTests.setUp in accounts/tests.py

        self.landlord_user = User.objects.create_user(
            email='landlord@example.com', password='pass123456', role='landlord',
            is_verified=True,
            # is_verified — creating a listing now requires a verified
            # email (accounts/permissions.py); these tests are about the
            # create/cap rules, so the landlord starts verified.
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

    # ---- Listing limits (Kelvin's decisions, 2026-09-28) ----
    # Creating a DRAFT is always allowed, except that a Free landlord may
    # hold at most 10 listings in total. The live limit (Free 3, agent 10,
    # lord unlimited) is checked when a listing is SUBMITTED for review —
    # see ListingLimitSubmitTests below. The old tests here expected the
    # 2nd listing to be blocked at create time: that was the
    # "3 of 1 — limit reached" bug.

    BASE = {
        'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
        'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
        'address_precise': '1 Test St', 'neighborhood': 'Osu', 'city': 'Accra',
    }

    def _make(self, count, status_value):
        # Creates listings straight in the database (no API), so a test
        # can set up "this landlord already has N of these" in one line.
        for i in range(count):
            Listing.objects.create(
                landlord_profile=self.landlord_profile, title=f'{status_value} {i}',
                status=status_value, **self.BASE,
            )

    def _subscribe(self, tier, days=20):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta
        return LandlordSubscription.objects.create(
            landlord_profile=self.landlord_profile,
            tier=tier,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=days),
        )

    def test_free_landlord_can_create_drafts_beyond_live_limit(self):
        # Free's live limit is 3, but drafts don't use live slots —
        # creating a 5th listing (as a draft) must work.
        self._make(4, Listing.Status.DRAFT)
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Fifth draft'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_free_landlord_with_three_live_can_still_create_draft(self):
        # The exact "3 of 1 — limit reached" scenario: being at the live
        # limit must NOT stop a landlord from starting a new draft.
        self._make(3, Listing.Status.PUBLISHED)
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Draft while full'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_free_total_limit_blocks_the_eleventh_listing(self):
        self._make(3, Listing.Status.PUBLISHED)
        self._make(5, Listing.Status.DRAFT)
        self._make(2, Listing.Status.REJECTED)
        # 10 in total — rejected listings count toward the total.
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Eleventh'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'listing_total_limit_reached')
        self.assertFalse(Listing.objects.filter(title='Eleventh').exists())

    def test_paused_listings_count_toward_free_total(self):
        self._make(9, Listing.Status.DRAFT)
        self._make(1, Listing.Status.PAUSED)
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Over'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_archived_and_leased_do_not_count_toward_free_total(self):
        self._make(9, Listing.Status.DRAFT)
        self._make(3, Listing.Status.ARCHIVED)
        self._make(2, Listing.Status.LEASED)
        # 9 counted, so a 10th is still allowed.
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Tenth'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_paid_plan_has_no_total_limit(self):
        from payments.models import LandlordSubscription
        self._subscribe(LandlordSubscription.Tier.AGENT)
        self._make(15, Listing.Status.DRAFT)
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Sixteenth'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_expired_paid_plan_falls_back_to_free_total_limit(self):
        from payments.models import LandlordSubscription
        from django.utils import timezone
        from datetime import timedelta
        subscription = self._subscribe(LandlordSubscription.Tier.AGENT)
        subscription.current_period_end = timezone.now() - timedelta(days=10)
        subscription.save()
        # Ended 10 days ago — well past the 3-day grace period.
        self._make(10, Listing.Status.DRAFT)
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {**self.BASE, 'title': 'Blocked'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


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

    def test_landlord_with_active_subscription_stays_locked(self):
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

        self.assertIsNone(response.data['address_precise'])
        self.assertIsNone(response.data['landlord_contact'])
        self.assertFalse(response.data['is_unlocked'])
        # A paid plan only raises the landlord's own listing cap — it
        # does NOT unlock other landlords' listings (perk removed
        # 2026-09-27; see ListingSerializer._has_access)

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
        # A locked listing still gets a map pin (the Discovery Hub needs
        # something to plot) — but only the COARSENED one, not null.
        # The exact-vs-coarse split itself is covered in detail by
        # ListingLocationPrivacyTests below; this just confirms locking
        # never blanks the pin out entirely

        from django.contrib.gis.geos import Point

        self.listing.location = Point(-0.18, 5.60)
        self.listing.save()

        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertIsNone(response.data['address_precise'])
        self.assertFalse(response.data['is_unlocked'])
        self.assertIsNotNone(response.data['location'])
        # Locked on address/contact, but a (coarsened) map pin is still
        # there


class ListingLocationPrivacyTests(APITestCase):
    # The exact lat/lng is as much "the precise address" as
    # address_precise is — so it sits behind the same _has_access gate.
    # Locked viewers get the centre of a ~550m grid cell instead (see
    # listings/location_privacy.py); anyone _has_access lets through
    # keeps the exact point. Also covers the bbox filter, which could
    # otherwise leak the exact point on its own without ever
    # serializing it.

    EXACT = (-0.182, 5.556)
    # Real point: lng -0.182, lat 5.556. Its grid cell is lng
    # [-0.185, -0.180) × lat [5.555, 5.560), whose centre is
    # (-0.1825, 5.5575) — worked out by hand here, deliberately NOT by
    # calling snap_point, so a bug in snap_point can't also "fix" the
    # expected value
    COARSE = (-0.1825, 5.5575)

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='privacylandlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Privacy Landlord',
            national_id_number='GHA-321', preferred_payout_method='momo'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Located listing', description='Test', listing_type='rent',
            price_monthly='2000.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='42 Secret Ave',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
            location=Point(*self.EXACT, srid=4326),
        )

        self.renter_user = User.objects.create_user(
            email='privacyrenter@example.com', password='pass123456'
        )
        RenterProfile.objects.create(user=self.renter_user, full_name='Renter')

        self.staff_user = User.objects.create_user(
            email='privacystaff@example.com', password='pass123456', role='staff'
        )

    def _coords(self, wkt):
        # Parses the serialized "SRID=4326;POINT (lng lat)" string back
        # into numbers — asserting on coordinates rather than the raw
        # string keeps these tests about WHERE the point is, not about
        # how many decimal places the WKT writer happens to print
        point = GEOSGeometry(wkt)
        return (point.x, point.y)

    def _assert_point(self, wkt, expected):
        x, y = self._coords(wkt)
        self.assertAlmostEqual(x, expected[0], places=6)
        self.assertAlmostEqual(y, expected[1], places=6)

    def test_anonymous_viewer_gets_coarsened_point(self):
        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self._assert_point(response.data['location'], self.COARSE)
        self.assertTrue(response.data['location'].startswith('SRID=4326;POINT ('))
        # Same string shape as the real field, so the frontend's
        # parseWktPoint keeps working unchanged

    def test_anonymous_list_gets_coarsened_point(self):
        # The list endpoint is what feeds the Discovery Hub's map pins —
        # the main place the exact point was leaking
        response = self.client.get('/listings/')

        results = response.data['results'] if 'results' in response.data else response.data
        row = next(item for item in results if item['id'] == self.listing.id)
        self._assert_point(row['location'], self.COARSE)

    def test_locked_renter_gets_coarsened_point(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self._assert_point(response.data['location'], self.COARSE)

    def test_owner_gets_exact_point(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self._assert_point(response.data['location'], self.EXACT)
        # Also what the listing edit form reads back to place its pin —
        # a coarsened point here would silently move the landlord's pin
        # on every save

    def test_renter_who_unlocked_gets_exact_point(self):
        from payments.models import ListingUnlock

        ListingUnlock.objects.create(user=self.renter_user, listing=self.listing)
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self._assert_point(response.data['location'], self.EXACT)

    def test_staff_gets_exact_point(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self._assert_point(response.data['location'], self.EXACT)

    def test_coarsened_point_is_stable_across_requests(self):
        # THE property that makes coarsening worth anything: random
        # per-request jitter could be averaged away over many fetches,
        # a fixed grid can't
        first = self.client.get(f'/listings/{self.listing.id}/').data['location']
        second = self.client.get(f'/listings/{self.listing.id}/').data['location']
        third = self.client.get('/listings/').data
        third = third['results'] if 'results' in third else third
        third = next(item for item in third if item['id'] == self.listing.id)['location']

        self.assertEqual(first, second)
        self.assertEqual(first, third)

    def test_coarsened_point_reveals_only_the_grid_cell(self):
        # Moving the real point around WITHIN its cell must not move the
        # coarse point at all — otherwise the coarse point would still
        # encode (some of) the exact location
        self.listing.location = Point(-0.1849, 5.5599, srid=4326)
        self.listing.save()

        response = self.client.get(f'/listings/{self.listing.id}/')

        self._assert_point(response.data['location'], self.COARSE)

    def test_listing_without_location_stays_null(self):
        self.listing.location = None
        self.listing.save()

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertIsNone(response.data['location'])

    def test_bbox_filter_cannot_pinpoint_exact_location(self):
        # A tiny box INSIDE the listing's grid cell that does NOT contain
        # the real point. Filtering on the raw box would exclude the
        # listing — and shrinking boxes like that step by step would
        # binary-search the exact coordinates. Snapped to the grid, the
        # box covers the whole cell, so the listing is still returned:
        # the filter can't tell anything finer than the cell apart
        response = self.client.get('/listings/', {
            'west': '-0.1845', 'south': '5.5590', 'east': '-0.1840', 'north': '5.5595',
        })

        results = response.data['results'] if 'results' in response.data else response.data
        self.assertIn(self.listing.id, [item['id'] for item in results])

    def test_bbox_filter_still_excludes_other_cells(self):
        # The snapping only widens a box to its OWN cells — a box
        # entirely inside the next cell over (lng [-0.180, -0.175))
        # must still exclude the listing, or the map filter would stop
        # filtering anything useful
        response = self.client.get('/listings/', {
            'west': '-0.1795', 'south': '5.5560', 'east': '-0.1790', 'north': '5.5570',
        })

        results = response.data['results'] if 'results' in response.data else response.data
        self.assertNotIn(self.listing.id, [item['id'] for item in results])


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
            'test.jpg', _real_jpeg_bytes(), content_type='image/jpeg'
        )
        # A REAL (tiny) JPEG — upload_photos now opens every file with
        # Pillow to confirm it's genuinely an image, so the old
        # b'fake-image-bytes' placeholder is (correctly) rejected.

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


def _real_jpeg_bytes(size=(8, 8), color=(200, 30, 60)):
    # Builds a genuine JPEG in memory with Pillow — no file on disk.
    # Used by every test that uploads a listing photo, because the
    # upload endpoint verifies files really are images.
    from io import BytesIO
    from PIL import Image

    buffer = BytesIO()
    Image.new('RGB', size, color).save(buffer, format='JPEG')
    return buffer.getvalue()


def _titles_from_list_response(response):
    # The list endpoint returns a plain list locally but a paginated
    # {'results': [...]} shape once pagination is enabled — every other
    # list test in this file already handles both, so new tests reuse
    # the same helper instead of each re-implementing the branch.
    data = response.data['results'] if 'results' in response.data else response.data
    return [item['title'] for item in data]


class ListingMineFilterTests(APITestCase):
    # Covers ?mine=true on GET /listings/ — the landlord dashboard's
    # "my listings" list and the subscription-cap count behind it.
    # Each test asserts the FULL matrix row from the task contract,
    # not just the happy path, since the failure modes (leaking other
    # landlords' rows, breaking anonymous Discovery Hub) are the actual
    # product risks here.

    def setUp(self):
        self.owner = User.objects.create_user(
            email='mine-owner@example.com', password='pass123456', role='landlord'
        )
        self.owner_profile = LandlordProfile.objects.create(
            user=self.owner, full_name='Mine Owner', national_id_number='GHA-M1',
            preferred_payout_method='momo'
        )

        self.other_landlord = User.objects.create_user(
            email='mine-other@example.com', password='pass123456', role='landlord'
        )
        self.other_profile = LandlordProfile.objects.create(
            user=self.other_landlord, full_name='Mine Other', national_id_number='GHA-M2',
            preferred_payout_method='momo'
        )

        self.renter = User.objects.create_user(
            email='mine-renter@example.com', password='pass123456', role='renter'
        )

        self.staff = User.objects.create_user(
            email='mine-staff@example.com', password='pass123456', role='staff'
        )

        base = {
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 2, 'bathrooms': 1,
            'address_precise': '1 Mine Rd', 'neighborhood': 'Osu',
        }

        self.owner_draft = Listing.objects.create(
            landlord_profile=self.owner_profile, title='My draft', city='Accra',
            status=Listing.Status.DRAFT, **base
        )
        self.owner_published = Listing.objects.create(
            landlord_profile=self.owner_profile, title='My published', city='Accra',
            status=Listing.Status.PUBLISHED, **base
        )
        self.other_published = Listing.objects.create(
            landlord_profile=self.other_profile, title='Other published', city='Accra',
            status=Listing.Status.PUBLISHED, **base
        )

    def test_landlord_mine_true_returns_only_own_including_drafts(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.get('/listings/?mine=true')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = _titles_from_list_response(response)

        self.assertIn('My draft', titles)
        # Drafts included — the dashboard lists every status here.
        self.assertIn('My published', titles)
        self.assertNotIn('Other published', titles)
        # THE point of the param: without it, the default landlord base
        # (own UNION all-published) would include this row.

    def test_renter_mine_true_returns_empty(self):
        self.client.force_authenticate(user=self.renter)

        response = self.client.get('/listings/?mine=true')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = _titles_from_list_response(response)

        self.assertEqual(titles, [])
        # Renters own no listings — empty, not an error, and definitely
        # not a fallback to "all published".

    def test_staff_mine_true_returns_only_own_not_all(self):
        self.client.force_authenticate(user=self.staff)

        response = self.client.get('/listings/?mine=true')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = _titles_from_list_response(response)

        self.assertEqual(titles, [])
        # Staff own nothing here — must NOT fall back to "all listings"
        # (their default base without the param), or the dashboard
        # count would be meaningless for any staff-owned row.

    def test_anonymous_mine_true_ignores_param_returns_published_only(self):
        # No force_authenticate at all — the public Discovery Hub
        # fetches this endpoint anonymously and must be unaffected.
        response = self.client.get('/listings/?mine=true')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Never a 500 (AnonymousUser has no .role / no landlordprofile
        # — the view must not touch either before the auth guard).
        titles = _titles_from_list_response(response)

        self.assertIn('My published', titles)
        self.assertIn('Other published', titles)
        self.assertNotIn('My draft', titles)
        # Same published-only set as a plain anonymous GET /listings/.

    def test_mine_true_composes_with_city_filter(self):
        self.client.force_authenticate(user=self.owner)

        # Move the owner's published row to Kumasi so the city filter
        # has something to exclude while mine=true stays active.
        self.owner_published.city = 'Kumasi'
        self.owner_published.save(update_fields=['city'])

        response = self.client.get('/listings/?mine=true&city=Accra')

        titles = _titles_from_list_response(response)

        self.assertIn('My draft', titles)
        # Own + in Accra — matches both filters (AND logic).
        self.assertNotIn('My published', titles)
        # Own but in Kumasi — correctly excluded by the city filter.
        self.assertNotIn('Other published', titles)
        # Would already be excluded by mine=true alone; confirms the
        # two filters stack rather than one overriding the other.


class ListingSubmitForReviewTests(APITestCase):
    # Covers POST /listings/<id>/submit-for-review/ — the ONLY
    # landlord-driven status transition. Tests pin both allowed
    # transitions, every forbidden one, the cross-owner 403, and that
    # status is actually readable by the owner afterwards.

    def setUp(self):
        self.owner = User.objects.create_user(
            email='review-owner@example.com', password='pass123456', role='landlord',
            is_verified=True,  # creating a listing requires a verified email
        )
        self.owner_profile = LandlordProfile.objects.create(
            user=self.owner, full_name='Review Owner', national_id_number='GHA-R1',
            preferred_payout_method='momo'
        )

        self.other_landlord = User.objects.create_user(
            email='review-other@example.com', password='pass123456', role='landlord'
        )
        LandlordProfile.objects.create(
            user=self.other_landlord, full_name='Review Other', national_id_number='GHA-R2',
            preferred_payout_method='momo'
        )

        base = {
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
            'address_precise': '1 Review Rd', 'neighborhood': 'Osu', 'city': 'Accra',
        }

        self.draft = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Draft listing',
            status=Listing.Status.DRAFT, **base
        )
        self.rejected = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Rejected listing',
            status=Listing.Status.REJECTED, **base
        )
        self.published = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Published listing',
            status=Listing.Status.PUBLISHED, **base
        )
        self.pending = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Pending listing',
            status=Listing.Status.PENDING_REVIEW, **base
        )
        self.archived = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Archived listing',
            status=Listing.Status.ARCHIVED, **base
        )

    def test_draft_to_pending_review_succeeds(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(f'/listings/{self.draft.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PENDING_REVIEW)
        # Full re-serialized listing comes back so the frontend can
        # update its cache without a refetch.

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, Listing.Status.PENDING_REVIEW)

    def test_rejected_to_pending_review_succeeds(self):
        # Resubmission after fixing — the second (and only other)
        # allowed transition.
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(f'/listings/{self.rejected.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PENDING_REVIEW)

        self.rejected.refresh_from_db()
        self.assertEqual(self.rejected.status, Listing.Status.PENDING_REVIEW)

    def test_published_cannot_be_submitted(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(f'/listings/{self.published.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        # {'error': '...'} shape — the contract the frontend unwraps.

        self.published.refresh_from_db()
        self.assertEqual(self.published.status, Listing.Status.PUBLISHED)

    def test_pending_review_cannot_be_resubmitted(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(f'/listings/{self.pending.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

    def test_archived_cannot_be_submitted(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(f'/listings/{self.archived.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

    def test_cross_landlord_submit_is_forbidden(self):
        # The ownership trap: get_queryset for a landlord is
        # own-UNION-all-published, so get_object() SUCCEEDS on another
        # landlord's published listing — only the explicit check inside
        # the action stops the transition. Uses the published row
        # deliberately: its status would otherwise be a 400, so a 403
        # here proves the ownership check runs FIRST.
        self.client.force_authenticate(user=self.other_landlord)

        response = self.client.post(f'/listings/{self.published.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.published.refresh_from_db()
        self.assertEqual(self.published.status, Listing.Status.PUBLISHED)

    def test_status_is_exposed_to_owner_on_read(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.get(f'/listings/{self.draft.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.DRAFT)

    def test_status_is_visible_but_harmless_on_public_published_row(self):
        # Anonymous callers only ever receive published rows, so the
        # exposed value ('published') leaks nothing new — this just pins
        # that contract so a future visibility change can't silently
        # start leaking draft rows WITH their status attached.
        response = self.client.get(f'/listings/{self.published.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PUBLISHED)

    def test_landlord_still_cannot_set_status_directly_on_create_or_update(self):
        # Removing status from Meta.exclude must NOT reopen the
        # self-publish bypass — status is read_only, so client-supplied
        # values are silently ignored on both write paths and the only
        # transition stays the submit-for-review action. Uses a FRESH
        # landlord for the create half, so the create below is tested on
        # its own and not mixed up with self.owner's existing listings.
        fresh = User.objects.create_user(
            email='review-fresh@example.com', password='pass123456', role='landlord',
            is_verified=True,  # creating a listing requires a verified email
        )
        LandlordProfile.objects.create(
            user=fresh, full_name='Review Fresh', national_id_number='GHA-R9',
            preferred_payout_method='momo'
        )
        self.client.force_authenticate(user=fresh)

        data = {
            'title': 'Sneaky published', 'description': 'Test', 'listing_type': 'rent',
            'price_monthly': '2000.00', 'advance_rent_period': '1_year',
            'bedrooms': 1, 'bathrooms': 1, 'address_precise': '9 Sneaky Rd',
            'neighborhood': 'Osu', 'city': 'Accra', 'status': 'published',
        }
        create_response = self.client.post('/listings/', data, format='json')

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        sneaky = Listing.objects.get(title='Sneaky published')
        self.assertEqual(sneaky.status, Listing.Status.DRAFT)

        self.client.force_authenticate(user=self.owner)
        patch_response = self.client.patch(
            f'/listings/{self.draft.id}/', {'status': 'published'}, format='json'
        )

        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, Listing.Status.DRAFT)


class ListingPhotoManagementTests(APITestCase):
    # Covers the /listings/photos/<id>/ management endpoint (PATCH
    # order/is_cover, DELETE with cover promotion). Photos are created
    # directly as DB rows with stub image names — no storage backend
    # involved, since management never touches file bytes at all.

    def setUp(self):
        self.owner = User.objects.create_user(
            email='photo-owner@example.com', password='pass123456', role='landlord'
        )
        self.owner_profile = LandlordProfile.objects.create(
            user=self.owner, full_name='Photo Owner', national_id_number='GHA-P1',
            preferred_payout_method='momo'
        )

        self.other_landlord = User.objects.create_user(
            email='photo-other@example.com', password='pass123456', role='landlord'
        )
        LandlordProfile.objects.create(
            user=self.other_landlord, full_name='Photo Other', national_id_number='GHA-P2',
            preferred_payout_method='momo'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Photo listing',
            description='Test', listing_type='rent', price_monthly='2000.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='1 Photo Rd', neighborhood='Osu', city='Accra',
            status=Listing.Status.DRAFT,
        )

    def _make_photo(self, order, is_cover=False):
        return ListingPhoto.objects.create(
            listing=self.listing, image=f'listing_photos/test-{order}.jpg',
            order=order, is_cover=is_cover,
        )

    def test_owner_can_update_order(self):
        photo = self._make_photo(order=0, is_cover=True)
        self.client.force_authenticate(user=self.owner)

        response = self.client.patch(
            f'/listings/photos/{photo.id}/', {'order': 5}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        photo.refresh_from_db()
        self.assertEqual(photo.order, 5)

    def test_setting_cover_clears_siblings_so_only_one_cover_remains(self):
        first = self._make_photo(order=0, is_cover=True)
        second = self._make_photo(order=1, is_cover=False)
        self.client.force_authenticate(user=self.owner)

        response = self.client.patch(
            f'/listings/photos/{second.id}/', {'is_cover': True}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertFalse(first.is_cover)
        self.assertTrue(second.is_cover)
        self.assertEqual(
            ListingPhoto.objects.filter(listing=self.listing, is_cover=True).count(), 1
        )
        # At most one cover — the invariant the atomic clear-then-set
        # exists to hold, even under concurrent set-cover requests.

    def test_deleting_cover_promotes_first_remaining_by_order(self):
        cover = self._make_photo(order=0, is_cover=True)
        nxt = self._make_photo(order=1, is_cover=False)
        later = self._make_photo(order=2, is_cover=False)
        self.client.force_authenticate(user=self.owner)

        response = self.client.delete(f'/listings/photos/{cover.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        nxt.refresh_from_db()
        later.refresh_from_db()
        self.assertTrue(nxt.is_cover)
        # Lowest remaining order wins promotion.
        self.assertFalse(later.is_cover)

    def test_deleting_last_photo_leaves_listing_with_none(self):
        only = self._make_photo(order=0, is_cover=True)
        self.client.force_authenticate(user=self.owner)

        response = self.client.delete(f'/listings/photos/{only.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(ListingPhoto.objects.filter(listing=self.listing).count(), 0)
        # Same state as a freshly created listing — the next upload's
        # first-ever auto-cover logic re-establishes a cover from here.

    def test_non_owner_patch_and_delete_404(self):
        photo = self._make_photo(order=0, is_cover=True)
        self.client.force_authenticate(user=self.other_landlord)

        patch_response = self.client.patch(
            f'/listings/photos/{photo.id}/', {'order': 9}, format='json'
        )
        delete_response = self.client.delete(f'/listings/photos/{photo.id}/')

        self.assertEqual(patch_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(delete_response.status_code, status.HTTP_404_NOT_FOUND)
        # 404 (not 403) — the owner-scoped get_queryset makes a
        # stranger's photo behave like "doesn't exist", never
        # confirming "exists but not yours".
        self.assertTrue(ListingPhoto.objects.filter(id=photo.id).exists())

    def test_patch_image_is_rejected(self):
        photo = self._make_photo(order=0, is_cover=True)
        self.client.force_authenticate(user=self.owner)

        response = self.client.patch(
            f'/listings/photos/{photo.id}/', {'image': 'listing_photos/sneaky.jpg'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        # image is immutable here — changing the visual means delete +
        # re-upload, never a PATCH of the file field.

    def test_photo_endpoints_require_authentication(self):
        photo = self._make_photo(order=0, is_cover=True)

        list_response = self.client.get('/listings/photos/')
        patch_response = self.client.patch(
            f'/listings/photos/{photo.id}/', {'order': 3}, format='json'
        )

        self.assertEqual(list_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(patch_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_owner_list_returns_only_own_photos(self):
        self._make_photo(order=0, is_cover=True)
        other_listing = Listing.objects.create(
            landlord_profile=LandlordProfile.objects.get(user=self.other_landlord),
            title='Other photo listing', description='Test', listing_type='rent',
            price_monthly='2000.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='2 Photo Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.DRAFT,
        )
        ListingPhoto.objects.create(
            listing=other_listing, image='listing_photos/other.jpg',
            order=0, is_cover=True,
        )
        self.client.force_authenticate(user=self.owner)

        response = self.client.get('/listings/photos/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data['results'] if 'results' in response.data else response.data
        self.assertEqual(len(data), 1)


class ListingReviewTests(APITestCase):
    # Covers POST /listings/<id>/review/ — the reviewer-side half of
    # verification (landlords submit via submit-for-review, staff/admin
    # decide here). Pins both outcomes, every rejection path, and the
    # audit stamping (verified_by_staff/verified_at/published_at).

    def setUp(self):
        self.owner = User.objects.create_user(
            email='reviewer-owner@example.com', password='pass123456', role='landlord'
        )
        self.owner_profile = LandlordProfile.objects.create(
            user=self.owner, full_name='Reviewer Owner', national_id_number='GHA-V1',
            preferred_payout_method='momo'
        )

        self.staff_user = User.objects.create_user(
            email='reviewer-staff@example.com', password='pass123456', role='staff'
        )
        self.staff_profile = StaffProfile.objects.create(
            user=self.staff_user, full_name='Reviewer Staff', can_approve_listings=True,
        )

        self.admin_user = User.objects.create_user(
            email='reviewer-admin@example.com', password='pass123456', role='admin'
        )
        # No StaffProfile for admin — by design (admins have no profile
        # table), and exactly the shape the review action must handle
        # without 500ing.

        self.renter_user = User.objects.create_user(
            email='reviewer-renter@example.com', password='pass123456', role='renter'
        )

        base = {
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
            'address_precise': '1 Review Rd', 'neighborhood': 'Osu', 'city': 'Accra',
        }

        self.pending = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Pending review',
            status=Listing.Status.PENDING_REVIEW, **base
        )
        self.draft = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Draft review',
            status=Listing.Status.DRAFT, **base
        )
        self.published = Listing.objects.create(
            landlord_profile=self.owner_profile, title='Published review',
            status=Listing.Status.PUBLISHED, **base
        )

    def test_staff_can_publish_pending_listing(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(
            f'/listings/{self.pending.id}/review/', {'decision': 'published'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PUBLISHED)
        self.assertTrue(response.data['is_staff_verified'])
        # Full re-serialization comes back for cache updates — and the
        # badge is already True on it, no refetch needed.

        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Listing.Status.PUBLISHED)
        self.assertEqual(self.pending.verified_by_staff, self.staff_profile)
        self.assertIsNotNone(self.pending.verified_at)
        self.assertIsNotNone(self.pending.published_at)

    def test_staff_can_reject_pending_listing(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(
            f'/listings/{self.pending.id}/review/', {'decision': 'rejected'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.REJECTED)

        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Listing.Status.REJECTED)
        self.assertEqual(self.pending.verified_by_staff, self.staff_profile)
        self.assertIsNotNone(self.pending.verified_at)
        self.assertIsNone(self.pending.published_at)
        # Rejection records WHEN (verified_at) but never fabricates a
        # "first went live" timestamp — published_at stays None so a
        # later approval of the resubmission stamps the real go-live.

    def test_landlord_cannot_review_own_listing(self):
        # The role check runs before any status logic: this is the
        # owner's OWN pending row, so a 403 here proves "not your
        # action", not a visibility accident.
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(
            f'/listings/{self.pending.id}/review/', {'decision': 'published'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Listing.Status.PENDING_REVIEW)

    def test_renter_cannot_review(self):
        # Uses the PUBLISHED row deliberately: renters can SEE published
        # listings, so get_object() succeeds and the 403 below proves
        # the role check itself — on the pending row a renter would 404
        # on visibility before ever reaching it (same not-403
        # convention as every other action). Also proves role runs
        # before status: published would otherwise be a 400.
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(
            f'/listings/{self.published.id}/review/', {'decision': 'published'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_cannot_review(self):
        response = self.client.post(
            f'/listings/{self.pending.id}/review/', {'decision': 'published'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_draft_cannot_be_reviewed_directly(self):
        # Drafts must travel draft → submit-for-review → pending_review
        # first — reviewers can't pull a draft straight to published.
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(
            f'/listings/{self.draft.id}/review/', {'decision': 'published'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, Listing.Status.DRAFT)

    def test_published_listing_cannot_be_re_reviewed(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(
            f'/listings/{self.published.id}/review/', {'decision': 'rejected'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

    def test_invalid_decision_is_rejected(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(
            f'/listings/{self.pending.id}/review/', {'decision': 'archived'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Listing.Status.PENDING_REVIEW)

    def test_admin_can_review_without_staff_profile(self):
        # Admin approvals are a first-class path (oversight console),
        # and admins have no StaffProfile table — verified_by_staff
        # stays None while status + timestamps still land, and the
        # badge still shows (it keys off verified_at, deliberately).
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.post(
            f'/listings/{self.pending.id}/review/', {'decision': 'published'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PUBLISHED)
        self.assertTrue(response.data['is_staff_verified'])

        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Listing.Status.PUBLISHED)
        self.assertIsNone(self.pending.verified_by_staff)
        self.assertIsNotNone(self.pending.verified_at)
        self.assertIsNotNone(self.pending.published_at)


class AdminVisibilityTests(APITestCase):
    # Pins the admin (superuser) oversight contract: sees every listing
    # regardless of status, with contact/address unlocked — the read
    # foundation the admin console builds on.

    def setUp(self):
        self.admin_user = User.objects.create_user(
            email='oversight-admin@example.com', password='pass123456', role='admin'
        )

        landlord_user = User.objects.create_user(
            email='oversight-landlord@example.com', password='pass123456', role='landlord'
        )
        landlord_profile = LandlordProfile.objects.create(
            user=landlord_user, full_name='Oversight Landlord',
            national_id_number='GHA-O1', preferred_payout_method='momo'
        )
        landlord_user.phone = '0201112222'
        landlord_user.save()

        base = {
            'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
            'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
            'address_precise': '7 Oversight Rd', 'neighborhood': 'Osu', 'city': 'Accra',
        }

        self.draft = Listing.objects.create(
            landlord_profile=landlord_profile, title='Oversight draft',
            status=Listing.Status.DRAFT, **base
        )
        self.published = Listing.objects.create(
            landlord_profile=landlord_profile, title='Oversight published',
            status=Listing.Status.PUBLISHED, **base
        )

    def test_admin_list_sees_all_statuses(self):
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.get('/listings/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = _titles_from_list_response(response)

        self.assertIn('Oversight draft', titles)
        self.assertIn('Oversight published', titles)
        # Previously admins fell into the renter branch (published
        # only) — the draft row proves full oversight visibility.

    def test_admin_detail_sees_unlocked_contact_and_address(self):
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.get(f'/listings/{self.published.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['address_precise'], '7 Oversight Rd')
        self.assertEqual(response.data['landlord_contact']['phone'], '0201112222')
        self.assertTrue(response.data['is_unlocked'])

IN_MEMORY_STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.memory.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}
# Same trick as test_photos_field_reflects_uploaded_photos above: keep
# uploaded test files in memory instead of sending them to real R2.


class ListingLifecycleRuleTests(APITestCase):
    # Kelvin's 2026-09 decisions for listings: verified email to create,
    # archive instead of delete (hard delete is admin-only), and photo
    # uploads must be real, reasonably-sized images.

    def setUp(self):
        self.landlord_user = User.objects.create_user(
            email='life-landlord@example.com', password='pass123456', role='landlord',
            is_verified=True,
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Life Landlord',
            national_id_number='GHA-L1', preferred_payout_method='momo'
        )
        self.other_landlord = User.objects.create_user(
            email='life-other@example.com', password='pass123456', role='landlord'
        )
        LandlordProfile.objects.create(
            user=self.other_landlord, full_name='Life Other',
            national_id_number='GHA-L2', preferred_payout_method='momo'
        )
        self.admin_user = User.objects.create_user(
            email='life-admin@example.com', password='pass123456', role='admin'
        )
        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Lifecycle listing', description='Test', listing_type='rent',
            price_monthly='1500.00', advance_rent_period='1_year',
            bedrooms=2, bathrooms=1, address_precise='3 Life Rd',
            neighborhood='Osu', city='Accra', status=Listing.Status.PUBLISHED,
        )

    # ---- verified email to create -----------------------------------------

    def test_unverified_landlord_cannot_create_listing(self):
        self.landlord_user.is_verified = False
        self.landlord_user.save()
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post('/listings/', {
            'title': 'New', 'description': 'Test', 'listing_type': 'rent',
            'price_monthly': '1000.00', 'advance_rent_period': '1_year',
            'bedrooms': 1, 'bathrooms': 1, 'address_precise': '1 New Rd',
            'neighborhood': 'Osu', 'city': 'Accra',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'email_not_verified')

    # ---- archive instead of delete ----------------------------------------

    def test_landlord_cannot_delete_own_listing(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.delete(f'/listings/{self.listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'use_archive')
        self.assertTrue(Listing.objects.filter(id=self.listing.id).exists())

    def test_admin_can_delete_listing(self):
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.delete(f'/listings/{self.listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Listing.objects.filter(id=self.listing.id).exists())

    def test_archive_hides_listing_from_public(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post(f'/listings/{self.listing.id}/archive/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.ARCHIVED)

        self.client.force_authenticate(user=None)
        public = self.client.get(f'/listings/{self.listing.id}/')
        self.assertEqual(public.status_code, status.HTTP_404_NOT_FOUND)

    def test_other_landlord_cannot_archive(self):
        self.client.force_authenticate(user=self.other_landlord)

        response = self.client.post(f'/listings/{self.listing.id}/archive/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.PUBLISHED)

    def test_leased_listing_cannot_be_archived(self):
        self.listing.status = Listing.Status.LEASED
        self.listing.save()
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post(f'/listings/{self.listing.id}/archive/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_restore_returns_archived_listing_to_draft(self):
        self.listing.status = Listing.Status.ARCHIVED
        self.listing.save()
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post(f'/listings/{self.listing.id}/restore/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.DRAFT)
        # Draft, not published — it must be re-verified before going live.

    def test_restore_only_works_on_archived_listings(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post(f'/listings/{self.listing.id}/restore/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # ---- photo upload validation ------------------------------------------

    def _upload(self, *files):
        from django.test import override_settings
        self.client.force_authenticate(user=self.landlord_user)
        with override_settings(STORAGES=IN_MEMORY_STORAGES):
            return self.client.post(
                f'/listings/{self.listing.id}/photos/', {'images': list(files)}, format='multipart'
            )

    def test_real_image_is_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self._upload(SimpleUploadedFile('ok.jpg', _real_jpeg_bytes(), content_type='image/jpeg'))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.listing.photos.count(), 1)

    def test_html_renamed_to_jpg_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        fake = SimpleUploadedFile(
            'evil.jpg', b'<html><script>alert(1)</script></html>', content_type='image/jpeg'
        )

        response = self._upload(fake)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.listing.photos.count(), 0)

    def test_wrong_extension_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self._upload(SimpleUploadedFile('photo.gif', _real_jpeg_bytes(), content_type='image/gif'))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_one_bad_file_rejects_the_whole_batch(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        good = SimpleUploadedFile('good.jpg', _real_jpeg_bytes(), content_type='image/jpeg')
        bad = SimpleUploadedFile('bad.jpg', b'not an image', content_type='image/jpeg')

        response = self._upload(good, bad)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.listing.photos.count(), 0)

    def test_oversized_file_is_rejected(self):
        from unittest.mock import patch
        from django.core.files.uploadedfile import SimpleUploadedFile

        with patch('listings.views.MAX_PHOTO_BYTES', 100):
            # Temporarily lower the limit to 100 bytes instead of building
            # a real 10 MB file — the check is the same either way.
            response = self._upload(SimpleUploadedFile('big.jpg', _real_jpeg_bytes(), content_type='image/jpeg'))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_photo_count_is_capped(self):
        from unittest.mock import patch
        from django.core.files.uploadedfile import SimpleUploadedFile
        files = [SimpleUploadedFile(f'p{i}.jpg', _real_jpeg_bytes(), content_type='image/jpeg') for i in range(3)]

        with patch('listings.views.MAX_PHOTOS_PER_LISTING', 2):
            response = self._upload(*files)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.listing.photos.count(), 0)


class ListingSlugTests(APITestCase):

    def setUp(self):
        landlord = User.objects.create_user(
            email='slug-landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=landlord, full_name='Slug Landlord',
            national_id_number='GHA-S1', preferred_payout_method='momo'
        )

    def _listing(self, title, status=Listing.Status.PUBLISHED):
        # Every listing made here is in Osu, Accra — so every slug below
        # ends with "-osu" (the neighbourhood the slug rule appends).
        return Listing.objects.create(
            landlord_profile=self.landlord_profile, title=title, description='Test',
            listing_type='rent', price_monthly='1000.00', advance_rent_period='1_year',
            bedrooms=1, bathrooms=1, address_precise='1 Slug Rd',
            neighborhood='Osu', city='Accra', status=status,
        )

    def test_slug_is_built_from_title_and_neighbourhood(self):
        listing = self._listing('Modern 2-bedroom – East Legon!')

        self.assertEqual(listing.slug, 'modern-2-bedroom-east-legon-osu')
        # "East Legon" comes from the TITLE; "osu" is the listing's actual
        # neighbourhood field, appended by the rule.

    def test_duplicate_titles_get_numbered_slugs(self):
        first = self._listing('Cozy Studio')
        second = self._listing('Cozy Studio')

        self.assertEqual(first.slug, 'cozy-studio-osu')
        self.assertEqual(second.slug, 'cozy-studio-osu-2')

    def test_editing_title_keeps_slug(self):
        listing = self._listing('Old Title')
        listing.title = 'Brand New Title'
        listing.save()

        listing.refresh_from_db()
        self.assertEqual(listing.slug, 'old-title-osu')

    def test_public_lookup_by_slug(self):
        listing = self._listing('Findable Flat')

        response = self.client.get('/listings/by-slug/findable-flat-osu/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], listing.id)
        self.assertIsNone(response.data['address_precise'])
        # Still locked for an anonymous visitor.

    def test_draft_is_not_found_by_slug_for_public(self):
        self._listing('Hidden Draft', status=Listing.Status.DRAFT)

        response = self.client.get('/listings/by-slug/hidden-draft-osu/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_slug_cannot_be_set_through_api(self):
        listing = self._listing('Locked Slug')
        self.client.force_authenticate(user=self.landlord_profile.user)

        self.client.patch(f'/listings/{listing.id}/', {'slug': 'my-own-slug'}, format='json')

        listing.refresh_from_db()
        self.assertEqual(listing.slug, 'locked-slug-osu')


def _make_landlord(email, national_id):
    # Small helper for the classes below: a landlord user plus profile.
    user = User.objects.create_user(email=email, password='pass123456', role='landlord', is_verified=True)
    profile = LandlordProfile.objects.create(
        user=user, full_name=email.split('@')[0], national_id_number=national_id,
        preferred_payout_method='momo',
    )
    return user, profile


def _make_listing(profile, title, **overrides):
    fields = dict(
        landlord_profile=profile, title=title, description='Test', listing_type='rent',
        price_monthly='1500.00', advance_rent_period='1_year', bedrooms=2, bathrooms=1,
        address_precise='5 Extra Rd', neighborhood='Osu', city='Accra',
        status=Listing.Status.PUBLISHED,
    )
    fields.update(overrides)
    return Listing.objects.create(**fields)


class ListingMoreFilterTests(APITestCase):
    # The two Discovery Hub filters ListingFilterTests doesn't cover:
    # ?advance_rent_period= and ?amenities=.

    def setUp(self):
        _, profile = _make_landlord('more-filters@example.com', 'GHA-MF1')
        self.water = Amenity.objects.create(name='Water MF', slug='water_mf')
        self.power = Amenity.objects.create(name='Power MF', slug='power_mf')

        self.six_months = _make_listing(profile, 'Six months', advance_rent_period='6_months')
        self.one_year = _make_listing(profile, 'One year', advance_rent_period='1_year')
        self.both_amenities = _make_listing(profile, 'Water and power')
        self.both_amenities.amenities.set([self.water, self.power])
        self.one_year.amenities.set([self.water])

    def test_filter_by_advance_rent_period(self):
        response = self.client.get('/listings/?advance_rent_period=6_months')

        self.assertEqual(_titles_from_list_response(response), ['Six months'])

    def test_filter_by_one_amenity(self):
        response = self.client.get('/listings/?amenities=power_mf')

        self.assertEqual(_titles_from_list_response(response), ['Water and power'])

    def test_amenities_filter_matches_any_and_lists_each_home_once(self):
        response = self.client.get('/listings/?amenities=water_mf&amenities=power_mf')

        titles = _titles_from_list_response(response)
        self.assertCountEqual(titles, ['One year', 'Water and power'])
        # assertCountEqual = same items, any order. 'Water and power'
        # matches BOTH slugs; the .distinct() in get_queryset is what
        # stops it appearing twice, and this is the line that catches it
        # if someone removes it.

    def test_unknown_amenity_returns_nothing(self):
        response = self.client.get('/listings/?amenities=helipad')

        self.assertEqual(_titles_from_list_response(response), [])


class ListingOtherLandlordWriteTests(APITestCase):
    # Another landlord CAN see a published listing (it's public), so the
    # 404-from-get_queryset trick doesn't protect it. These pin the
    # explicit ownership checks that do.

    def setUp(self):
        self.owner, self.owner_profile = _make_landlord('pub-owner@example.com', 'GHA-PO1')
        self.other, _ = _make_landlord('pub-other@example.com', 'GHA-PO2')
        self.listing = _make_listing(self.owner_profile, 'Public listing')

    def test_other_landlord_cannot_edit_a_published_listing(self):
        self.client.force_authenticate(user=self.other)

        response = self.client.patch(f'/listings/{self.listing.id}/', {'title': 'Hijacked'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.title, 'Public listing')

    def test_other_landlord_cannot_upload_photos_to_a_published_listing(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        self.client.force_authenticate(user=self.other)
        image = SimpleUploadedFile('x.jpg', _real_jpeg_bytes(), content_type='image/jpeg')
        with override_settings(STORAGES=IN_MEMORY_STORAGES):
            response = self.client.post(
                f'/listings/{self.listing.id}/photos/', {'images': [image]}, format='multipart'
            )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.listing.photos.count(), 0)

    def test_other_landlord_cannot_archive_a_published_listing(self):
        self.client.force_authenticate(user=self.other)

        response = self.client.post(f'/listings/{self.listing.id}/archive/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.PUBLISHED)

    def test_owner_upload_with_no_images_is_400(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.post(f'/listings/{self.listing.id}/photos/', {}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class StaffRestoreTests(APITestCase):

    def test_staff_can_restore_an_archived_listing_to_draft(self):
        _, profile = _make_landlord('restore-owner@example.com', 'GHA-R1')
        listing = _make_listing(profile, 'Archived one', status=Listing.Status.ARCHIVED)
        staff = User.objects.create_user(email='restore-staff@example.com', password='pass123456', role='staff')
        self.client.force_authenticate(user=staff)

        response = self.client.post(f'/listings/{listing.id}/restore/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.DRAFT)
        # Draft, not published: it has to be reviewed again before it
        # goes back on the map.


class LeasedListingVisibilityTests(APITestCase):
    # A leased home is off the public map, but the renter who leased it
    # can still open it (from their lease). Nobody else can, including
    # other renters: a tenant must never be able to see another
    # tenant's lease.

    def setUp(self):
        from datetime import date
        from leases.models import Lease

        _, profile = _make_landlord('leased-owner@example.com', 'GHA-LV1')
        self.listing = _make_listing(profile, 'Leased home', status=Listing.Status.LEASED)

        self.tenant = User.objects.create_user(email='tenant@example.com', password='pass123456', role='renter')
        tenant_profile = RenterProfile.objects.create(user=self.tenant, full_name='Tenant')
        self.stranger = User.objects.create_user(email='stranger@example.com', password='pass123456', role='renter')
        RenterProfile.objects.create(user=self.stranger, full_name='Stranger')

        Lease.objects.create(
            listing=self.listing, renter_profile=tenant_profile, landlord_profile=profile,
            rent_amount_monthly='1500.00', deposit_amount='18000.00', advance_rent_period='1_year',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

    def test_renter_on_the_lease_can_open_the_listing(self):
        self.client.force_authenticate(user=self.tenant)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_other_renter_cannot_open_the_listing(self):
        self.client.force_authenticate(user=self.stranger)

        response = self.client.get(f'/listings/{self.listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_leased_listing_is_not_in_public_results(self):
        response = self.client.get('/listings/')

        self.assertNotIn('Leased home', _titles_from_list_response(response))


class SavedListingsForOtherRolesTests(APITestCase):

    def test_landlord_saved_list_is_empty_not_an_error(self):
        landlord, profile = _make_landlord('saved-landlord@example.com', 'GHA-SV1')
        _make_listing(profile, 'Some home')
        self.client.force_authenticate(user=landlord)

        response = self.client.get('/listings/saved/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data['results'] if 'results' in response.data else response.data
        self.assertEqual(list(data), [])


class ListingCleanTests(APITestCase):
    # Listing.clean() tidies prices that don't apply to the listing type.
    # Django calls clean() from ModelForms (so: the Django admin) via
    # full_clean(); a plain .save() does not call it.

    def setUp(self):
        _, self.profile = _make_landlord('clean-owner@example.com', 'GHA-CL1')

    def test_rent_listing_drops_one_time_price(self):
        listing = Listing(
            landlord_profile=self.profile, title='Rent', listing_type=Listing.ListingType.RENT,
            price_monthly='1500.00', price_one_time='90000.00',
        )

        listing.clean()

        self.assertIsNone(listing.price_one_time)
        self.assertEqual(listing.price_monthly, '1500.00')

    def test_buy_listing_drops_monthly_price_and_advance(self):
        listing = Listing(
            landlord_profile=self.profile, title='Buy', listing_type=Listing.ListingType.BUY,
            price_monthly='1500.00', price_one_time='90000.00',
            advance_rent_period=Listing.AdvanceRentPeriod.ONE_YEAR,
        )

        listing.clean()

        self.assertIsNone(listing.price_monthly)
        self.assertEqual(listing.advance_rent_period, Listing.AdvanceRentPeriod.NONE)
        self.assertEqual(listing.price_one_time, '90000.00')
