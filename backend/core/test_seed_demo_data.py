import shutil
import tempfile
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from accounts.models import User, RenterProfile, LandlordProfile, StaffProfile
from leases.models import Lease
from listings.models import Listing, ListingPhoto, SavedListing
from payments import limits
from payments.models import LandlordSubscription, ListingUnlock
from core.management.commands import seed_demo_data
from core.management.commands.seed_demo_data import DEMO_PHOTO_PREFIX, LISTINGS, PHOTOS_DIR

PASSWORD = 'demo-test-password'
PHOTO_KEYS = ['east-legon-2-bed', 'osu-1-bed']
# Only two listings get test photos: enough to prove photos are attached
# and reused, without pushing ~140 images through storage in every test.


def _jpeg_bytes():
    buffer = BytesIO()
    Image.new('RGB', (8, 8), (200, 120, 40)).save(buffer, 'JPEG')
    return buffer.getvalue()


@override_settings(
    DEMO_ACCOUNT_PASSWORD=PASSWORD,
    STORAGES={
        'default': {'BACKEND': 'django.core.files.storage.memory.InMemoryStorage'},
        'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
    },
    # In-memory file storage: the seed must never upload test files to R2.
)
class SeedDemoDataTests(TestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.photos_dir = Path(tempfile.mkdtemp())
        for key in PHOTO_KEYS:
            (cls.photos_dir / key).mkdir()
            for number in range(1, 5):
                (cls.photos_dir / key / f'{number}.jpg').write_bytes(_jpeg_bytes())

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.photos_dir)
        super().tearDownClass()

    def setUp(self):
        patcher = patch.object(seed_demo_data, 'PHOTOS_DIR', self.photos_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    def seed(self, **options):
        call_command('seed_demo_data', stdout=StringIO(), **options)

    def counts(self):
        return {
            model.__name__: model.objects.count()
            for model in (User, Listing, ListingPhoto, ListingUnlock, SavedListing, LandlordSubscription)
        }

    # --- what gets seeded ---------------------------------------------

    @override_settings(DEMO_ACCOUNT_PASSWORD='')
    def test_refuses_to_run_without_a_password(self):
        with self.assertRaises(CommandError):
            self.seed()
        self.assertFalse(User.objects.exists())

    def test_public_accounts_can_sign_in_without_onboarding(self):
        self.seed()

        for email, role, username in [
            ('renter+demo@paddy.dev', User.Role.RENTER, 'demo_renter'),
            ('landlord+demo@paddy.dev', User.Role.LANDLORD, 'demo_landlord'),
            ('staff+demo@paddy.dev', User.Role.STAFF, 'demo_staff'),
        ]:
            user = User.objects.get(email=email)
            self.assertEqual(user.role, role)
            self.assertEqual(user.username, username)
            self.assertTrue(user.is_verified)
            self.assertTrue(user.check_password(PASSWORD))

    def test_other_landlords_cannot_sign_in(self):
        self.seed()

        others = User.objects.filter(role=User.Role.LANDLORD).exclude(email='landlord+demo@paddy.dev')
        self.assertEqual(others.count(), 6)
        self.assertFalse(any(user.has_usable_password() for user in others))

    def test_demo_landlord_is_on_the_agent_plan(self):
        self.seed()

        profile = LandlordProfile.objects.get(user__email='landlord+demo@paddy.dev')
        subscription = limits.get_subscription(profile)
        self.assertEqual(limits.effective_tier(subscription), LandlordSubscription.Tier.AGENT)
        self.assertGreaterEqual(profile.listings.filter(status=Listing.Status.PUBLISHED).count(), 5)

    def test_published_listings_fit_the_brief(self):
        self.seed()

        published = Listing.objects.filter(status=Listing.Status.PUBLISHED)
        self.assertTrue(20 <= published.count() <= 30)
        self.assertEqual(set(published.values_list('city', flat=True)), {'Accra', 'Kumasi'})
        self.assertEqual(
            set(published.values_list('advance_rent_period', flat=True)),
            {Listing.AdvanceRentPeriod.SIX_MONTHS, Listing.AdvanceRentPeriod.ONE_YEAR},
        )
        self.assertFalse(published.filter(location__isnull=True).exists())
        self.assertFalse(published.filter(verified_at__isnull=True).exists())
        self.assertFalse(Listing.objects.filter(title__icontains='demo').exists())
        # The site-wide banner says it's a demo; titles read like real ones.

    def test_daily_cap_job_pauses_nothing(self):
        # Every seeded landlord stays within their plan's live limit, so
        # the daily enforce_listing_caps job leaves the demo untouched.
        self.seed()

        for profile in LandlordProfile.objects.all():
            usage = limits.usage_for(profile)
            if usage['listing_cap'] is not None:
                self.assertLessEqual(usage['listings_used'], usage['listing_cap'], profile.full_name)

        call_command('enforce_listing_caps', stdout=StringIO())

        self.assertFalse(Listing.objects.filter(status=Listing.Status.PAUSED).exists())

    def test_demo_renter_has_unlocks_and_saved_homes_but_no_leases(self):
        self.seed()

        renter = User.objects.get(email='renter+demo@paddy.dev')
        unlocks = ListingUnlock.objects.filter(user=renter)
        self.assertEqual(unlocks.count(), 3)
        for unlock in unlocks:
            self.assertEqual(unlock.amount_pesewas, 500)
            self.assertTrue(unlock.paystack_reference.startswith('DEMO-'))
            self.assertEqual(unlock.listing.status, Listing.Status.PUBLISHED)
        self.assertGreaterEqual(SavedListing.objects.filter(renter_profile__user=renter).count(), 3)
        self.assertFalse(Lease.objects.exists())

    def test_photos_are_attached_in_order_with_a_cover(self):
        self.seed()

        listing = Listing.objects.get(title='2-bedroom apartment near the A&C Mall')
        photos = list(listing.photos.order_by('order'))
        self.assertEqual(len(photos), 4)
        self.assertTrue(photos[0].is_cover)
        self.assertFalse(any(photo.is_cover for photo in photos[1:]))
        for photo in photos:
            self.assertTrue(photo.image.name.startswith(f'{DEMO_PHOTO_PREFIX}east-legon-2-bed/'))
            self.assertTrue(default_storage.exists(photo.image.name))

    def test_running_twice_adds_nothing(self):
        self.seed()
        first = self.counts()

        self.seed()

        self.assertEqual(self.counts(), first)

    def test_reset_reuses_uploaded_photos(self):
        self.seed()
        names_before = set(ListingPhoto.objects.values_list('image', flat=True))

        self.seed(reset=True)

        self.assertEqual(set(ListingPhoto.objects.values_list('image', flat=True)), names_before)
        # Same file names: the reset pointed the new rows at the files
        # already in storage instead of uploading them again.

    def test_reset_restores_what_visitors_changed(self):
        self.seed()
        Listing.objects.filter(landlord_profile__user__email='landlord+demo@paddy.dev').update(
            status=Listing.Status.ARCHIVED,
        )
        SavedListing.objects.filter(renter_profile__user__email='renter+demo@paddy.dev').delete()

        self.seed(reset=True)

        self.assertTrue(Listing.objects.filter(
            landlord_profile__user__email='landlord+demo@paddy.dev', status=Listing.Status.PUBLISHED,
        ).exists())
        self.assertTrue(SavedListing.objects.filter(renter_profile__user__email='renter+demo@paddy.dev').exists())

    # --- the reset must never touch real data ----------------------------

    def test_reset_never_touches_real_accounts_or_their_data(self):
        self.seed()

        real_landlord = User.objects.create_user(
            email='real.landlord@example.com', password='pass123456', role='landlord',
        )
        real_profile = LandlordProfile.objects.create(
            user=real_landlord, full_name='Real Landlord',
            national_id_number='GHA-REAL', preferred_payout_method='momo',
        )
        demo_staff = StaffProfile.objects.get(user__email='staff+demo@paddy.dev')
        real_listing = Listing.objects.create(
            landlord_profile=real_profile, title='Real home', description='Real', listing_type='rent',
            price_monthly='2000.00', advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='1 Real Rd', neighborhood='Osu', city='Accra',
            location=Point(-0.18, 5.55, srid=4326), status=Listing.Status.PUBLISHED,
            verified_by_staff=demo_staff,
            # Approved by the demo staff account: the reset deletes that
            # account, which must NOT take this listing with it.
        )
        real_photo = ListingPhoto(listing=real_listing, order=0, is_cover=True)
        real_photo.image.save('real.jpg', ContentFile(_jpeg_bytes()), save=False)
        real_photo.save()

        gmail_alias = User.objects.create_user(
            email='kofi+demo@gmail.com', password='pass123456', role='renter',
        )
        # "+demo@" in a real address: must survive, only +demo@paddy.dev
        # is demo.
        alias_profile = RenterProfile.objects.create(user=gmail_alias, full_name='Kofi')
        SavedListing.objects.create(renter_profile=alias_profile, listing=real_listing)
        ListingUnlock.objects.create(user=gmail_alias, listing=real_listing, amount_pesewas=500)

        demo_user_ids = set(User.objects.filter(email__endswith='+demo@paddy.dev').values_list('id', flat=True))

        with self.captureOnCommitCallbacks(execute=True):
            self.seed(reset=True)

        self.assertTrue(User.objects.filter(pk=real_landlord.pk).exists())
        self.assertTrue(User.objects.filter(pk=gmail_alias.pk).exists())
        real_listing.refresh_from_db()
        self.assertEqual(real_listing.status, Listing.Status.PUBLISHED)
        self.assertIsNone(real_listing.verified_by_staff)
        self.assertTrue(ListingPhoto.objects.filter(pk=real_photo.pk).exists())
        self.assertTrue(default_storage.exists(real_photo.image.name))
        self.assertTrue(SavedListing.objects.filter(renter_profile=alias_profile, listing=real_listing).exists())
        self.assertTrue(ListingUnlock.objects.filter(user=gmail_alias, listing=real_listing).exists())

        new_demo_ids = set(User.objects.filter(email__endswith='+demo@paddy.dev').values_list('id', flat=True))
        self.assertEqual(len(new_demo_ids), len(demo_user_ids))
        self.assertFalse(new_demo_ids & demo_user_ids)
        # The demo accounts were really deleted and created again.

    def test_reset_deletes_files_visitors_uploaded_as_demo_accounts(self):
        self.seed()
        demo_listing = Listing.objects.get(title='2-bedroom apartment near the A&C Mall')
        visitor_photo = ListingPhoto(listing=demo_listing, order=9)
        visitor_photo.image.save('visitor.jpg', ContentFile(_jpeg_bytes()), save=False)
        visitor_photo.save()
        renter = User.objects.get(email='renter+demo@paddy.dev')
        renter.profile_image.save('visitor-avatar.jpg', ContentFile(_jpeg_bytes()))
        uploads = [visitor_photo.image.name, renter.profile_image.name]
        seeded = list(ListingPhoto.objects.filter(
            image__startswith=DEMO_PHOTO_PREFIX,
        ).values_list('image', flat=True))

        with self.captureOnCommitCallbacks(execute=True):
            self.seed(reset=True)

        for name in uploads:
            self.assertFalse(default_storage.exists(name), name)
        for name in seeded:
            self.assertTrue(default_storage.exists(name), name)


class DemoPhotoFilesTests(TestCase):
    # Checks the real committed photos, without uploading anything.

    def test_every_listing_has_four_to_six_credited_photos(self):
        credits = (PHOTOS_DIR / 'CREDITS.md').read_text(encoding='utf-8')
        for spec in LISTINGS:
            photos = sorted((PHOTOS_DIR / spec['key']).glob('*.jpg'))
            self.assertTrue(4 <= len(photos) <= 6, f"{spec['key']} has {len(photos)} photos")
            for photo in photos:
                self.assertIn(f"{spec['key']}/{photo.name}", credits)
