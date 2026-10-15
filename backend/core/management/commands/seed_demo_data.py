"""
Seed the public portfolio demo: 26 published homes across Accra and
Kumasi (plus one in review and one draft), each with real photos, and the
three public demo logins the frontend's "Try the demo" block offers:

    renter+demo@paddy.dev    a renter with a few unlocks and saved homes
    landlord+demo@paddy.dev  a landlord on the paid "paddy agent" plan
    staff+demo@paddy.dev     a staff reviewer (not shown publicly)

All three share one password, DEMO_ACCOUNT_PASSWORD from the
environment. Every other seeded landlord gets no usable password at all.

Safe to run repeatedly: get_or_create everywhere, so re-running only
fills in what's missing.

--reset deletes every account whose email ends in +demo@paddy.dev (and,
through the database's cascades, everything they own), then seeds again.
It runs nightly against the live demo database to undo whatever visitors
did with the public logins, so it must never touch any other account.

USAGE:
    python manage.py seed_demo_data
    python manage.py seed_demo_data --reset
"""
import logging
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.gis.geos import Point
from django.core.files import File
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import User, RenterProfile, LandlordProfile, StaffProfile
from core.models import Amenity
from listings.models import Listing, ListingPhoto, SavedListing
from payments.models import LandlordSubscription, ListingUnlock

logger = logging.getLogger(__name__)

DEMO_EMAIL_SUFFIX = '+demo@paddy.dev'
# THE line between demo and real data. --reset deletes only accounts whose
# email ends with exactly this, so a real sign-up like kofi+demo@gmail.com
# (a Gmail alias) is never caught. Anyone who registers a new
# ...+demo@paddy.dev address does get wiped each night, which is fine:
# that address can only ever be a demo.

PHOTOS_DIR = Path(__file__).resolve().parents[2] / 'demo_photos'
# backend/core/demo_photos/<listing key>/*.jpg, committed to the repo with
# their sources in CREDITS.md. A module-level name so tests can point it
# at a folder of tiny test images.

DEMO_PHOTO_PREFIX = 'listing_photos/demo/'
# Where seeded photos are stored: ListingPhoto.image's upload_to
# ('listing_photos/') plus a demo/ folder. Each file gets a fixed name,
# so a re-seed (and every nightly reset) finds it already in R2 and
# reuses it instead of uploading ~140 photos again. Nothing else can
# write here: Django strips folders from an uploaded file's name, so a
# visitor's upload always lands directly in listing_photos/.

NEIGHBORHOODS = {
    # (latitude, longitude) of each neighbourhood's rough centre. Listings
    # sit a few hundred metres apart around it (see _location).
    'East Legon': (5.6355, -0.1610),
    'Osu': (5.5560, -0.1820),
    'Cantonments': (5.5790, -0.1720),
    'Airport Residential': (5.6050, -0.1780),
    'Labone': (5.5650, -0.1700),
    'Spintex': (5.6300, -0.1050),
    'Adenta': (5.7090, -0.1570),
    'Madina': (5.6830, -0.1660),
    'Haatso': (5.6800, -0.2050),
    'Dzorwulu': (5.6100, -0.2000),
    'Roman Ridge': (5.6000, -0.1890),
    'Tesano': (5.5980, -0.2280),
    'Tema Community 25': (5.7230, -0.0280),
    'Ahodwo': (6.6650, -1.6250),
    'Nhyiaeso': (6.6800, -1.6350),
    'Asokwa': (6.6600, -1.6050),
    'Danyame': (6.6720, -1.6300),
    'Bantama': (6.7000, -1.6370),
    'Kwadaso': (6.6950, -1.6600),
    'Santasi': (6.6600, -1.6500),
}

# The three public logins (contract C3). Usernames make the dashboard URLs
# read /dashboard/demo_renter/... and so on.
DEMO_RENTER = {'email': 'renter+demo@paddy.dev', 'name': 'Akosua Boateng', 'username': 'demo_renter'}
DEMO_LANDLORD = {'email': 'landlord+demo@paddy.dev', 'name': 'Kwabena Asante', 'username': 'demo_landlord'}
DEMO_STAFF = {'email': 'staff+demo@paddy.dev', 'name': 'Esi Ankrah', 'username': 'demo_staff'}

# Other landlords: never log in, so no password and no username. Each has
# at most 3 live listings, the Free plan's limit, so the daily
# enforce_listing_caps job never pauses any of them.
OTHER_LANDLORDS = {
    'ama': 'Ama Owusu',
    'kojo': 'Kojo Mensah',
    'efua': 'Efua Addo',
    'yaw': 'Yaw Darko',
    'adwoa': 'Adwoa Frimpong',
    'nana': 'Nana Agyeman',
}

# Every phone number starts 000: no Ghanaian number does, so tapping
# "call" or WhatsApp on a demo listing can never reach a real person.
PHONES = {
    'demo': '0000000100',
    'ama': '0000000101',
    'kojo': '0000000102',
    'efua': '0000000103',
    'yaw': '0000000104',
    'adwoa': '0000000105',
    'nana': '0000000106',
}

PUBLISHED = Listing.Status.PUBLISHED
SIX_MONTHS = Listing.AdvanceRentPeriod.SIX_MONTHS
ONE_YEAR = Listing.AdvanceRentPeriod.ONE_YEAR

# key: the listing's photo folder name and its identity in this file.
# Addresses are invented street names; prices are monthly rent in GHS.
LISTINGS = [
    # --- the demo landlord (paddy agent plan: up to 10 live) ---
    {
        'key': 'east-legon-2-bed', 'landlord': 'demo', 'neighborhood': 'East Legon', 'city': 'Accra',
        'title': '2-bedroom apartment near the A&C Mall', 'bedrooms': 2, 'bathrooms': 2,
        'price': '8500', 'advance': ONE_YEAR, 'address': 'House 14, Baobab Close',
        'amenities': ['water_storage', 'backup_power', 'walled_gated', 'parking', 'air_conditioning', 'security'],
        'description': (
            'A bright second-floor apartment in a quiet East Legon compound, a short drive from the A&C Mall. '
            'Both bedrooms are en-suite and air-conditioned, the kitchen is fitted, and a 2,000-litre poly tank '
            'plus a standby generator keep water and power steady.'
        ),
    },
    {
        'key': 'cantonments-3-bed-townhouse', 'landlord': 'demo', 'neighborhood': 'Cantonments', 'city': 'Accra',
        'title': '3-bedroom townhouse with a private garden', 'bedrooms': 3, 'bathrooms': 4,
        'price': '16000', 'advance': ONE_YEAR, 'address': 'House 3, Frangipani Row',
        'amenities': ['walled_gated', 'backup_power', 'water_storage', 'parking', 'air_conditioning', 'security'],
        'description': (
            'An end-of-terrace townhouse on a tree-lined Cantonments street. Three en-suite bedrooms, '
            'a guest toilet, a walled garden at the back and parking for two cars. Security is on site day '
            'and night, and the estate runs its own backup power.'
        ),
    },
    {
        'key': 'airport-residential-2-bed', 'landlord': 'demo', 'neighborhood': 'Airport Residential', 'city': 'Accra',
        'title': 'Furnished 2-bedroom flat with a pool', 'bedrooms': 2, 'bathrooms': 2,
        'price': '12500', 'advance': SIX_MONTHS, 'address': 'Flat 6B, Kapok Gardens',
        'amenities': ['furnished', 'swimming_pool', 'gym', 'backup_power', 'air_conditioning', 'wifi', 'security'],
        'description': (
            'Move-in-ready and fully furnished, ten minutes from Kotoka Airport. The building has a shared pool, '
            'a small gym and fibre internet, and the generator covers the whole block. A six-month advance '
            'is accepted.'
        ),
    },
    {
        'key': 'osu-1-bed', 'landlord': 'demo', 'neighborhood': 'Osu', 'city': 'Accra',
        'title': '1-bedroom apartment off Oxford Street', 'bedrooms': 1, 'bathrooms': 1,
        'price': '5000', 'advance': SIX_MONTHS, 'address': 'House 21, Tamarind Lane',
        'amenities': ['water_storage', 'air_conditioning', 'wifi', 'security'],
        'description': (
            'A compact one-bedroom on a side street just off Oxford Street, so the restaurants are close but '
            'the noise isn\'t. Open-plan living and kitchen, an air-conditioned bedroom, and a rooftop water '
            'tank for the dry spells.'
        ),
    },
    {
        'key': 'spintex-2-bed', 'landlord': 'demo', 'neighborhood': 'Spintex', 'city': 'Accra',
        'title': '2-bedroom apartment in a gated compound', 'bedrooms': 2, 'bathrooms': 2,
        'price': '3800', 'advance': ONE_YEAR, 'address': 'House 8, Shea Nut Close',
        'amenities': ['walled_gated', 'water_storage', 'parking', 'security'],
        'description': (
            'One of four apartments in a walled compound off the Spintex Road, with a gate man and space to park. '
            'Two bedrooms, the master en-suite, a separate kitchen and a borehole with storage tanks.'
        ),
    },
    {
        'key': 'ahodwo-3-bed', 'landlord': 'demo', 'neighborhood': 'Ahodwo', 'city': 'Kumasi',
        'title': '3-bedroom house with boys\' quarters', 'bedrooms': 3, 'bathrooms': 3,
        'price': '5500', 'advance': ONE_YEAR, 'address': 'Plot 11, Kente Avenue',
        'amenities': ['walled_gated', 'water_storage', 'backup_power', 'parking'],
        'description': (
            'A detached family house in Ahodwo with a self-contained boys\' quarters at the back. '
            'Three bedrooms, a large living and dining area, a walled yard with parking, and a standby '
            'generator and water tanks.'
        ),
    },
    {
        'key': 'nhyiaeso-2-bed', 'landlord': 'demo', 'neighborhood': 'Nhyiaeso', 'city': 'Kumasi',
        'title': 'Modern 2-bedroom apartment', 'bedrooms': 2, 'bathrooms': 2,
        'price': '4000', 'advance': SIX_MONTHS, 'address': 'Flat 2, Adinkra Court',
        'amenities': ['water_storage', 'backup_power', 'air_conditioning', 'security'],
        'description': (
            'A newly finished apartment in Nhyiaeso with tiled floors throughout, a modern kitchen and two '
            'air-conditioned bedrooms. Backup power and water storage are shared across the building.'
        ),
    },
    {
        'key': 'asokwa-chamber-and-hall', 'landlord': 'demo', 'neighborhood': 'Asokwa', 'city': 'Kumasi',
        'title': 'Chamber and hall near the Kumasi City Mall', 'bedrooms': 1, 'bathrooms': 1,
        'price': '1200', 'advance': SIX_MONTHS, 'address': 'House 5, Cocoa Drive',
        'amenities': ['water_storage', 'walled_gated'],
        'description': (
            'A self-contained chamber and hall with its own bathroom and kitchenette, a short walk from the '
            'Kumasi City Mall. In a walled compound with a shared water tank. Six months advance.'
        ),
    },
    {
        'key': 'labone-3-bed', 'landlord': 'demo', 'neighborhood': 'Labone', 'city': 'Accra',
        'title': '3-bedroom apartment with a rooftop terrace', 'bedrooms': 3, 'bathrooms': 3,
        'price': '11000', 'advance': ONE_YEAR, 'address': 'House 9, Palm Kernel Street',
        'amenities': ['water_storage', 'backup_power', 'air_conditioning', 'security', 'parking'],
        'description': (
            'A top-floor apartment in Labone with a private rooftop terrace. Three bedrooms, two en-suite, '
            'and a large open living space. Waiting for paddy\'s verification visit.'
        ),
        'status': Listing.Status.PENDING_REVIEW,
    },
    {
        'key': 'danyame-4-bed', 'landlord': 'demo', 'neighborhood': 'Danyame', 'city': 'Kumasi',
        'title': '4-bedroom family home', 'bedrooms': 4, 'bathrooms': 4,
        'price': '7500', 'advance': ONE_YEAR, 'address': 'Plot 2, Mahogany Road',
        'amenities': ['walled_gated', 'water_storage', 'backup_power', 'parking'],
        'description': 'A four-bedroom house in Danyame. Draft: photos and details still being finalised.',
        'status': Listing.Status.DRAFT,
    },

    # --- Ama Owusu ---
    {
        'key': 'adenta-2-bed', 'landlord': 'ama', 'neighborhood': 'Adenta', 'city': 'Accra',
        'title': '2-bedroom self-contained apartment', 'bedrooms': 2, 'bathrooms': 1,
        'price': '2800', 'advance': ONE_YEAR, 'address': 'House 17, Neem Tree Close',
        'amenities': ['water_storage', 'walled_gated', 'parking'],
        'description': (
            'A ground-floor apartment in Adenta with its own entrance. Two bedrooms, a shared bathroom, '
            'a separate kitchen and a porch. Walled compound with parking and a water tank.'
        ),
    },
    {
        'key': 'madina-single-room', 'landlord': 'ama', 'neighborhood': 'Madina', 'city': 'Accra',
        'title': 'Single room self-contained', 'bedrooms': 1, 'bathrooms': 1,
        'price': '800', 'advance': SIX_MONTHS, 'address': 'House 40, Groundnut Lane',
        'amenities': ['water_storage'],
        'description': (
            'A clean single room with its own bathroom and a small kitchen corner, ten minutes\' walk from '
            'Madina market. Good for a student or a first job. Six months advance.'
        ),
    },
    {
        'key': 'haatso-chamber-and-hall', 'landlord': 'ama', 'neighborhood': 'Haatso', 'city': 'Accra',
        'title': 'Chamber and hall self-contained', 'bedrooms': 1, 'bathrooms': 1,
        'price': '1500', 'advance': SIX_MONTHS, 'address': 'House 6, Akee Street',
        'amenities': ['water_storage', 'walled_gated', 'security'],
        'description': (
            'A self-contained chamber and hall in a gated house in Haatso, close to the Atomic Road. '
            'Tiled throughout, with a fitted kitchenette and a water tank.'
        ),
    },

    # --- Kojo Mensah ---
    {
        'key': 'dzorwulu-2-bed', 'landlord': 'kojo', 'neighborhood': 'Dzorwulu', 'city': 'Accra',
        'title': '2-bedroom apartment with backup power', 'bedrooms': 2, 'bathrooms': 2,
        'price': '7000', 'advance': ONE_YEAR, 'address': 'Flat 4, Moringa Court',
        'amenities': ['backup_power', 'water_storage', 'air_conditioning', 'parking', 'security'],
        'description': (
            'A first-floor apartment in Dzorwulu with full generator backup and a borehole. Two en-suite '
            'bedrooms, a balcony off the living room, and secure parking behind the gate.'
        ),
    },
    {
        'key': 'roman-ridge-1-bed', 'landlord': 'kojo', 'neighborhood': 'Roman Ridge', 'city': 'Accra',
        'title': 'Furnished 1-bedroom apartment', 'bedrooms': 1, 'bathrooms': 1,
        'price': '6500', 'advance': SIX_MONTHS, 'address': 'Flat 1, Cashew Gardens',
        'amenities': ['furnished', 'wifi', 'air_conditioning', 'backup_power', 'security'],
        'description': (
            'A fully furnished one-bedroom in Roman Ridge, set up for someone relocating: bed, sofa, '
            'kitchenware and fast Wi-Fi are all included. Backup power and a security guard.'
        ),
    },
    {
        'key': 'tesano-3-bed', 'landlord': 'kojo', 'neighborhood': 'Tesano', 'city': 'Accra',
        'title': '3-bedroom house in a quiet neighbourhood', 'bedrooms': 3, 'bathrooms': 2,
        'price': '4500', 'advance': ONE_YEAR, 'address': 'House 12, Avocado Close',
        'amenities': ['walled_gated', 'water_storage', 'parking'],
        'description': (
            'A detached three-bedroom house on a quiet Tesano street. Large living room, separate dining '
            'area, a walled compound with room for two cars, and water storage tanks.'
        ),
    },

    # --- Efua Addo ---
    {
        'key': 'tema-community-25-2-bed', 'landlord': 'efua', 'neighborhood': 'Tema Community 25', 'city': 'Accra',
        'title': '2-bedroom apartment in Community 25', 'bedrooms': 2, 'bathrooms': 2,
        'price': '2800', 'advance': ONE_YEAR, 'address': 'House 31, Lagoon View Close',
        'amenities': ['walled_gated', 'water_storage', 'parking', 'security'],
        'description': (
            'A two-bedroom apartment in a gated estate in Community 25, close to the motorway. '
            'Estate security, parking, and a water tank for each unit.'
        ),
    },
    {
        'key': 'tema-community-25-3-bed', 'landlord': 'efua', 'neighborhood': 'Tema Community 25', 'city': 'Accra',
        'title': '3-bedroom detached house', 'bedrooms': 3, 'bathrooms': 3,
        'price': '4200', 'advance': ONE_YEAR, 'address': 'House 7, Sunbird Avenue',
        'amenities': ['walled_gated', 'water_storage', 'backup_power', 'parking'],
        'description': (
            'A three-bedroom detached house with a front garden and a walled yard. All bedrooms '
            'en-suite, a large kitchen with a store room, and an inverter backup for lights and fans.'
        ),
    },
    {
        'key': 'east-legon-studio', 'landlord': 'efua', 'neighborhood': 'East Legon', 'city': 'Accra',
        'title': 'Studio apartment for young professionals', 'bedrooms': 1, 'bathrooms': 1,
        'price': '3500', 'advance': SIX_MONTHS, 'address': 'Flat 3, Hibiscus Court',
        'amenities': ['furnished', 'wifi', 'air_conditioning', 'water_storage'],
        'description': (
            'A furnished studio in East Legon with a kitchenette, a work desk and air conditioning. '
            'Wi-Fi is included in the rent. Six months advance.'
        ),
    },

    # --- Yaw Darko ---
    {
        'key': 'bantama-2-bed', 'landlord': 'yaw', 'neighborhood': 'Bantama', 'city': 'Kumasi',
        'title': '2-bedroom apartment near Komfo Anokye Hospital', 'bedrooms': 2, 'bathrooms': 1,
        'price': '2000', 'advance': ONE_YEAR, 'address': 'House 19, Odum Street',
        'amenities': ['water_storage', 'walled_gated'],
        'description': (
            'A two-bedroom apartment in Bantama, a few minutes from Komfo Anokye Teaching Hospital, '
            'which suits hospital staff. Walled compound with a shared water tank.'
        ),
    },
    {
        'key': 'kwadaso-single-room', 'landlord': 'yaw', 'neighborhood': 'Kwadaso', 'city': 'Kumasi',
        'title': 'Single room self-contained', 'bedrooms': 1, 'bathrooms': 1,
        'price': '600', 'advance': SIX_MONTHS, 'address': 'House 52, Plantain Lane',
        'amenities': ['water_storage'],
        'description': (
            'An affordable single room with its own bathroom in Kwadaso, on a trotro route into town. '
            'Water storage on site. Six months advance.'
        ),
    },
    {
        'key': 'santasi-2-bed', 'landlord': 'yaw', 'neighborhood': 'Santasi', 'city': 'Kumasi',
        'title': '2-bedroom apartment with parking', 'bedrooms': 2, 'bathrooms': 2,
        'price': '2300', 'advance': ONE_YEAR, 'address': 'House 10, Yam Hill Road',
        'amenities': ['walled_gated', 'parking', 'water_storage'],
        'description': (
            'A two-bedroom apartment in Santasi with an en-suite master, a separate kitchen and a '
            'parking space inside the walled compound.'
        ),
    },

    # --- Adwoa Frimpong ---
    {
        'key': 'nhyiaeso-3-bed-townhouse', 'landlord': 'adwoa', 'neighborhood': 'Nhyiaeso', 'city': 'Kumasi',
        'title': '3-bedroom townhouse with backup power', 'bedrooms': 3, 'bathrooms': 3,
        'price': '6500', 'advance': ONE_YEAR, 'address': 'House 4, Golden Stool Close',
        'amenities': ['backup_power', 'water_storage', 'walled_gated', 'air_conditioning', 'security'],
        'description': (
            'A three-storey townhouse in a small gated Nhyiaeso estate. Three en-suite bedrooms, '
            'a family lounge upstairs, and full generator backup with water storage.'
        ),
    },
    {
        'key': 'ahodwo-1-bed', 'landlord': 'adwoa', 'neighborhood': 'Ahodwo', 'city': 'Kumasi',
        'title': 'Furnished 1-bedroom apartment', 'bedrooms': 1, 'bathrooms': 1,
        'price': '3200', 'advance': SIX_MONTHS, 'address': 'Flat 5, Kola Nut Court',
        'amenities': ['furnished', 'wifi', 'air_conditioning', 'water_storage'],
        'description': (
            'A furnished one-bedroom in Ahodwo with Wi-Fi and air conditioning, a good base for a '
            'short contract in Kumasi. Six months advance.'
        ),
    },
    {
        'key': 'danyame-2-bed', 'landlord': 'adwoa', 'neighborhood': 'Danyame', 'city': 'Kumasi',
        'title': '2-bedroom apartment in a gated estate', 'bedrooms': 2, 'bathrooms': 2,
        'price': '3800', 'advance': ONE_YEAR, 'address': 'House 15, Weaver Bird Lane',
        'amenities': ['walled_gated', 'security', 'water_storage', 'parking'],
        'description': (
            'A two-bedroom apartment in a quiet gated estate in Danyame, with round-the-clock security, '
            'parking and a water tank for each block.'
        ),
    },

    # --- Nana Agyeman ---
    {
        'key': 'east-legon-4-bed', 'landlord': 'nana', 'neighborhood': 'East Legon', 'city': 'Accra',
        'title': '4-bedroom house with a pool', 'bedrooms': 4, 'bathrooms': 5,
        'price': '18000', 'advance': ONE_YEAR, 'address': 'House 2, Flamboyant Drive',
        'amenities': ['swimming_pool', 'walled_gated', 'backup_power', 'water_storage', 'parking', 'air_conditioning', 'security'],
        'description': (
            'A detached four-bedroom house in East Legon with a private pool, a boys\' quarters and '
            'parking for four cars. Full generator backup, a borehole and round-the-clock security.'
        ),
    },
    {
        'key': 'labone-2-bed', 'landlord': 'nana', 'neighborhood': 'Labone', 'city': 'Accra',
        'title': '2-bedroom apartment near Labadi Beach', 'bedrooms': 2, 'bathrooms': 2,
        'price': '6000', 'advance': SIX_MONTHS, 'address': 'Flat 8, Seabreeze Court',
        'amenities': ['water_storage', 'backup_power', 'air_conditioning', 'security'],
        'description': (
            'A two-bedroom apartment in Labone, a short drive from Labadi Beach. Both bedrooms '
            'air-conditioned, a balcony with a sea breeze, and shared backup power.'
        ),
    },
    {
        'key': 'cantonments-1-bed', 'landlord': 'nana', 'neighborhood': 'Cantonments', 'city': 'Accra',
        'title': '1-bedroom serviced apartment', 'bedrooms': 1, 'bathrooms': 1,
        'price': '7500', 'advance': SIX_MONTHS, 'address': 'Flat 12, Ebony Residences',
        'amenities': ['furnished', 'wifi', 'gym', 'backup_power', 'air_conditioning', 'security'],
        'description': (
            'A serviced one-bedroom in Cantonments with weekly cleaning, a residents\' gym and fibre '
            'internet. Fully furnished, with backup power and security.'
        ),
    },
]

RENTER_UNLOCKS = [
    # (listing key, days ago). Different landlords, so the Unlocked
    # Listings page shows varied contacts. amount_pesewas=500 is GHS 5.00.
    ('osu-1-bed', 2),
    ('dzorwulu-2-bed', 9),
    ('nhyiaeso-3-bed-townhouse', 20),
]
RENTER_SAVED = ['east-legon-4-bed', 'airport-residential-2-bed', 'tema-community-25-2-bed', 'osu-1-bed']


class Command(BaseCommand):
    help = 'Seed the public portfolio demo (listings, photos, demo logins). --reset wipes +demo@paddy.dev accounts first.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset', action='store_true',
            help=f'Delete every account ending in {DEMO_EMAIL_SUFFIX} and its data, then seed again',
        )

    def handle(self, *args, **options):
        password = settings.DEMO_ACCOUNT_PASSWORD
        if not password:
            raise CommandError('Set DEMO_ACCOUNT_PASSWORD first: it is the shared password for the demo logins.')

        with transaction.atomic():
            # All or nothing: if seeding fails halfway through a reset, the
            # delete rolls back too, so the live demo keeps yesterday's data
            # instead of being left empty.
            if options['reset']:
                self._delete_demo_accounts()
            listings = self._seed(password)

        published = sum(1 for listing in listings.values() if listing.status == PUBLISHED)
        self.stdout.write(self.style.SUCCESS(f'Demo ready: {published} published listings, {len(listings)} in total.'))

    # --- reset ---------------------------------------------------------

    def _delete_demo_accounts(self):
        users = User.objects.filter(email__iendswith=DEMO_EMAIL_SUFFIX)

        stray_files = [
            name for name in ListingPhoto.objects
            .filter(listing__landlord_profile__user__in=users)
            .values_list('image', flat=True)
            if not name.startswith(DEMO_PHOTO_PREFIX)
        ]
        stray_files += [name for name in users.values_list('profile_image', flat=True) if name]
        # Files visitors uploaded while signed in as a demo account: extra
        # listing photos, profile pictures. Deleting a row never deletes
        # its file in R2, so without this they'd pile up there forever.
        # The seeded photos (under DEMO_PHOTO_PREFIX) are kept for re-use.

        deleted, _ = users.delete()
        # The database's cascades remove everything these accounts own:
        # profiles, listings and their photo rows, subscriptions, unlocks,
        # saved homes. Note what that includes: unlocks, saved homes and
        # viewings that REAL users made on demo listings go too, because
        # those listings are deleted. Rows that merely point at a demo
        # account (a real listing a demo staff member approved) are kept,
        # with that pointer cleared (on_delete=SET_NULL).

        transaction.on_commit(lambda: self._delete_files(stray_files))
        # Only once the reset has committed: if it rolls back, the rows
        # still point at these files, so they must still exist.

        self.stdout.write(self.style.WARNING(f'Reset: deleted {deleted} rows belonging to demo accounts.'))

    def _delete_files(self, names):
        for name in names:
            try:
                default_storage.delete(name)
            except Exception:
                logger.warning('Could not delete demo upload %s from storage.', name, exc_info=True)
                # A leftover file costs a few KB; failing the whole reset
                # over it would leave the demo un-reset.

    # --- seed ----------------------------------------------------------

    def _seed(self, password):
        staff_user = self._user(DEMO_STAFF, User.Role.STAFF, password=password)
        staff_profile, _ = StaffProfile.objects.get_or_create(
            user=staff_user,
            defaults={'full_name': DEMO_STAFF['name'], 'can_approve_listings': True, 'can_host_viewings': True},
        )

        renter_user = self._user(DEMO_RENTER, User.Role.RENTER, password=password)
        renter_profile, _ = RenterProfile.objects.get_or_create(
            user=renter_user,
            defaults={
                'full_name': DEMO_RENTER['name'], 'occupation': RenterProfile.Occupation.PROFESSIONAL,
                'preferred_area': 'East Legon',
                'about_me': 'Software tester moving to Accra for work. Looking for a 1 or 2-bedroom with steady water and power.',
            },
        )

        landlords = {'demo': self._landlord(DEMO_LANDLORD, PHONES['demo'], password=password)}
        for key, name in OTHER_LANDLORDS.items():
            first = name.split(' ')[0].lower()
            last = name.split(' ')[1].lower()
            landlords[key] = self._landlord(
                {'email': f'{first}.{last}{DEMO_EMAIL_SUFFIX}', 'name': name, 'username': None}, PHONES[key],
            )

        LandlordSubscription.objects.update_or_create(
            landlord_profile=landlords['demo'],
            defaults={
                'tier': LandlordSubscription.Tier.AGENT,
                'status': LandlordSubscription.Status.ACTIVE,
                'current_period_end': timezone.now() + timedelta(days=30),
                'cancel_at_period_end': False,
            },
        )
        # update_or_create, so every run pushes the paid period 30 days
        # out again: the nightly reset keeps the demo landlord on "paddy
        # agent" for good. No Paystack codes on purpose: if a visitor
        # presses Cancel, the plan is cancelled locally without calling
        # Paystack, and the next reset restores it.

        amenities = {amenity.slug: amenity for amenity in Amenity.objects.all()}
        listings = {}
        for index, spec in enumerate(LISTINGS):
            listings[spec['key']] = self._listing(spec, index, landlords[spec['landlord']], staff_profile, amenities)

        for number, (key, days_ago) in enumerate(RENTER_UNLOCKS, start=1):
            unlock, created = ListingUnlock.objects.get_or_create(
                user=renter_user, listing=listings[key],
                defaults={'paystack_reference': f'DEMO-UNLOCK-{number:03d}', 'amount_pesewas': 500},
            )
            if created:
                ListingUnlock.objects.filter(pk=unlock.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
                # auto_now_add ignores a value passed to create(), so the
                # receipt dates are back-dated with an update instead.

        for key in RENTER_SAVED:
            SavedListing.objects.get_or_create(renter_profile=renter_profile, listing=listings[key])

        return listings

    def _user(self, account, role, phone='', password=None):
        first, last = account['name'].split(' ', 1)
        user, created = User.objects.get_or_create(
            email=account['email'],
            defaults={
                'role': role, 'is_verified': True, 'username': account['username'],
                'first_name': first, 'last_name': last, 'phone': phone,
            },
        )
        # Role, username and is_verified are set up front, so signing in
        # goes straight to the dashboard (no onboarding, no "verify your
        # email" banner).
        if password is not None:
            user.set_password(password)
            user.save()
            # Set on every run, not only on create, so changing
            # DEMO_ACCOUNT_PASSWORD takes effect on the next seed.
        elif created:
            user.set_unusable_password()
            user.save()
            # Landlords that only exist to own listings can't be signed
            # into at all.
        return user

    def _landlord(self, account, phone, password=None):
        user = self._user(account, User.Role.LANDLORD, phone=phone, password=password)
        profile, _ = LandlordProfile.objects.get_or_create(
            user=user,
            defaults={
                'full_name': account['name'], 'national_id_number': f'GHA-DEMO-{user.pk}',
                'id_verified': True, 'preferred_payout_method': 'momo',
            },
        )
        return profile

    def _listing(self, spec, index, landlord_profile, staff_profile, amenities):
        status = spec.get('status', PUBLISHED)
        reviewed = status == PUBLISHED
        reviewed_at = timezone.now() - timedelta(days=3 + 2 * index) if reviewed else None
        # Staggered publish dates, so "newest" sorting has something to
        # sort and the live-limit rules (oldest stays live) behave
        # predictably.

        listing, created = Listing.objects.get_or_create(
            landlord_profile=landlord_profile, title=spec['title'], neighborhood=spec['neighborhood'],
            defaults={
                'description': spec['description'],
                'listing_type': Listing.ListingType.RENT,
                'price_monthly': Decimal(spec['price']),
                'advance_rent_period': spec['advance'],
                'bedrooms': spec['bedrooms'],
                'bathrooms': spec['bathrooms'],
                'location': self._location(spec['neighborhood'], index),
                'address_precise': spec['address'],
                'city': spec['city'],
                'status': status,
                'verified_by_staff': staff_profile if reviewed else None,
                'verified_at': reviewed_at,
                'published_at': reviewed_at,
            },
        )
        if created:
            listing.amenities.set([amenities[slug] for slug in spec['amenities']])
        if not listing.photos.exists():
            self._attach_photos(listing, spec['key'])
        return listing

    def _location(self, neighborhood, index):
        lat, lng = NEIGHBORHOODS[neighborhood]
        offset = 0.003 * ((index % 5) - 2)
        # Up to ~600 m either side of the centre, so several listings in
        # one neighbourhood don't stack on one map pin.
        return Point(lng + offset, lat - offset / 2, srid=4326)

    def _attach_photos(self, listing, key):
        paths = sorted((PHOTOS_DIR / key).glob('*.jpg'))
        if not paths:
            self.stdout.write(self.style.WARNING(f'No photos found for {key}.'))
            return

        for order, path in enumerate(paths):
            photo = ListingPhoto(listing=listing, order=order, is_cover=order == 0)
            name = f'{DEMO_PHOTO_PREFIX}{key}/{path.name}'
            if default_storage.exists(name):
                photo.image.name = name
                # Already in R2 from an earlier run: point at it.
                # shortcut: a file is reused by name, so swapping a photo
                # in demo_photos/ needs a new file name to be picked up.
            else:
                with path.open('rb') as image:
                    photo.image.save(f'demo/{key}/{path.name}', File(image), save=False)
                    # The normal ImageField upload path (upload_to adds
                    # listing_photos/), so it lands in R2 like any upload.
            photo.save()
