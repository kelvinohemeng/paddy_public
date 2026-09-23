from rest_framework.test import APITestCase
from rest_framework import status

from accounts.models import User
from .models import Amenity


class AmenityPublicReadTests(APITestCase):
    # The Discovery Hub is anonymous by design (SEO/server-rendered),
    # so the amenity filter options must load without login. Writes
    # stay login-gated — covered in AmenityWriteTests below.

    def setUp(self):
        # get_or_create, not create: migration 0002 already seeds the
        # canonical wifi row in every database (including test ones)
        self.amenity, _ = Amenity.objects.get_or_create(
            name='Wifi', slug='wifi'
        )

    def test_anonymous_can_list_amenities(self):
        response = self.client.get('/core/amenities/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = [row['slug'] for row in response.data]
        self.assertIn('wifi', slugs)

    def test_anonymous_can_retrieve_one_amenity(self):
        response = self.client.get(f'/core/amenities/{self.amenity.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['slug'], 'wifi')

    def test_anonymous_cannot_create_amenity(self):
        response = self.client.post(
            '/core/amenities/', {'name': 'Pool'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Amenity.objects.filter(name='Pool').exists())


class AmenityWriteTests(APITestCase):
    # Authenticated writes (the listing-create form's inline "create
    # new amenity" runs as a logged-in landlord), including the
    # canonical underscore slug form.

    def setUp(self):
        self.user = User.objects.create_user(
            email='landlord@example.com', password='pass123456', role='landlord'
        )
        self.client.force_authenticate(user=self.user)

    def test_create_mints_underscore_slug(self):
        # 'Rooftop Deck' is deliberately NOT one of the 11 canonical
        # amenities migration 0002 seeds — this exercises the actual
        # creation path (201), not the get-or-create-existing path
        response = self.client.post(
            '/core/amenities/', {'name': 'Rooftop Deck'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['slug'], 'rooftop_deck')
        # Underscores, not slugify()'s raw hyphens ("swimming-pool"):
        # the frontend filter + ListingViewSet's amenities__slug__in
        # lookup match on the underscore form (see core/choices.py)

    def test_create_duplicate_name_returns_existing(self):
        Amenity.objects.get_or_create(name='Wifi', slug='wifi')

        response = self.client.post(
            '/core/amenities/', {'name': 'WIFI'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['slug'], 'wifi')
        self.assertEqual(Amenity.objects.filter(slug='wifi').count(), 1)

    def test_create_different_name_same_slug_returns_existing(self):
        Amenity.objects.get_or_create(name='Swimming Pool', slug='swimming_pool')

        response = self.client.post(
            '/core/amenities/', {'name': 'Swimming-Pool'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['slug'], 'swimming_pool')
        # No second row: without this guard the slug's unique=True
        # constraint would 500 instead
        self.assertEqual(Amenity.objects.filter(slug='swimming_pool').count(), 1)

    def test_create_without_name_is_400(self):
        response = self.client.post('/core/amenities/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class CanonicalAmenitiesMigrationTests(APITestCase):
    # Migration 0002 seeds the 11 canonical amenities (core/choices.py)
    # with underscore slugs — this is what the anonymous Discovery Hub
    # filter actually loads, so it gets its own assertion.

    def test_eleven_canonical_amenities_exist(self):
        self.assertEqual(Amenity.objects.count(), 11)

    def test_canonical_slugs_use_underscores(self):
        self.assertTrue(Amenity.objects.filter(slug='water_storage').exists())
        self.assertTrue(Amenity.objects.filter(slug='swimming_pool').exists())
        self.assertTrue(Amenity.objects.filter(slug='walled_gated').exists())
        hyphenated = [
            amenity.slug for amenity in Amenity.objects.all() if '-' in amenity.slug
        ]
        self.assertEqual(hyphenated, [])

    def test_anonymous_list_returns_all_eleven(self):
        response = self.client.get('/core/amenities/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 11)
