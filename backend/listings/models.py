from django.db import models
from django.contrib.gis.db import models as gis_models
from django.contrib.postgres.fields import ArrayField
from core.models import Amenity

# A SEPARATE models module, specifically for geospatial fields — GeoDjango's
# own extension on top of the normal ORM. We import it under a different
# name (gis_models) so it doesn't collide with the regular `models` import
# above — we'll use both in this same file, for different fields

from accounts.models import LandlordProfile, StaffProfile
from django.core.validators import FileExtensionValidator
from django.utils.text import slugify


class Listing(models.Model):
    landlord_profile = models.ForeignKey(
        LandlordProfile, on_delete=models.CASCADE, related_name='listings'
    )
    # Many-to-one — one landlord can own many listings

    verified_by_staff = models.ForeignKey(
        StaffProfile, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='verified_listings'
    )
    # Also many-to-one (one staff member can verify many listings), but
    # notice the DIFFERENT on_delete choice here: SET_NULL instead of
    # CASCADE. Reasoning: if a staff member's account is ever deleted,
    # we do NOT want their past-verified listings to disappear too —
    # that would be destroying real product data because of an unrelated
    # HR change. SET_NULL means: keep the Listing, just clear this field
    # back to empty instead.
    # null=True + blank=True together = genuinely optional, both at the
    # database level (null) and the validation level (blank) — makes
    # sense, since a brand new listing has no verifying staff member YET

    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    description = models.TextField()
    # TextField again, same reasoning as About Me earlier — long-form,
    # not length-capped like CharField

    class ListingType(models.TextChoices):
        RENT = 'rent', 'Rent'
        BUY = 'buy', 'Buy'


    class AdvanceRentPeriod(models.TextChoices):
        NONE = 'none', 'None'
        SIX_MONTHS = '6_months', '6 Months'
        ONE_YEAR = '1_year', '1 Year'
        # Same TextChoices pattern as Role/SignInMethod — a fixed,
        # enforced set of valid values

    listing_type = models.CharField(max_length=10, choices=ListingType.choices, default=ListingType.RENT)
    price_monthly = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_one_time = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    advance_rent_period = models.CharField(
        max_length=10, choices=AdvanceRentPeriod.choices, null=True, blank=True
    )

    bedrooms = models.PositiveIntegerField()
    bathrooms = models.PositiveIntegerField()
    # PositiveIntegerField — NEW, a variant of IntegerField that also
    # rejects negative numbers at the database level. A listing can't
    # sensibly have -2 bedrooms, so this enforces that structurally
    # rather than relying on us remembering to check it in a view

    amenities= models.ManyToManyField(Amenity, related_name='listings', blank=True)
    # many-to-many — one listing can have many amenities, and one amenity
    # can be on many listings

    location = gis_models.PointField(geography=True, null=True, blank=True)
    # THE geospatial field — this is the actual payoff of the whole
    # Postgres+PostGIS setup from the start of this project.
    # PointField stores a single lat/long coordinate.
    # geography=True = tells PostGIS to treat coordinates using real-world
    # curved-earth distance calculations (accounts for the Earth being a
    # sphere, not a flat grid) — the standard, correct choice for
    # real-world "how far apart are these two points" queries, which is
    # exactly what the Discovery Hub's map search needs
    # null=True/blank=True = optional for now (e.g. a listing might be
    # created before its exact coordinates are pinned)

    address_precise = models.CharField(max_length=255)
    neighborhood = models.CharField(max_length=100)
    city = models.CharField(max_length=100)

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PENDING_REVIEW = 'pending_review', 'Pending Review'
        PUBLISHED = 'published', 'Published'
        REJECTED = 'rejected', 'Rejected'
        ARCHIVED = 'archived', 'Archived'
        LEASED = 'leased', 'Leased'
        # Set automatically (never via a manual staff/landlord action) the
        # moment a Lease record is created against this listing — see
        # leases/views.py LeaseViewSet.perform_create. Means "a renter has
        # actually signed a tenancy here", not "sold" (BUY-type listings
        # have no Lease model backing them at all). Excluded from public
        # discovery results same as archived — an occupied unit has no
        # vacancy to search for — but stays visible to the owning
        # landlord/staff/admin, AND to the specific renter who holds the
        # Lease (see ListingViewSet.get_queryset's renter branch), so they
        # can still reach their own leased listing's detail/dashboard card.

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    # Defaults to draft — a brand new listing starts unpublished, matches
    # the staff-verification workflow (nothing goes live until reviewed)

    virtual_tour_url = models.URLField(blank=True)
    # URLField — NEW, a CharField variant that also validates the value
    # actually looks like a real URL. blank=True since the photosphere
    # tour might not be ready yet when a listing is first created

    verified_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    # Both optional — stay empty until staff actually verify/publish.
    # Note: NOT auto_now_add, since these are set manually at a specific
    # business moment (staff approval), not automatically at row creation

    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        if self.listing_type == self.ListingType.RENT:
            self.price_one_time = None
        elif self.listing_type == self.ListingType.BUY:
            self.price_monthly = None
            self.advance_rent_period = self.AdvanceRentPeriod.NONE

    def save(self, *args, **kwargs):
        # Django calls save() every time a Listing is created or updated
        # (Listing.objects.create(), admin saves, serializer.save()...).
        # Overriding it lets us fill in the slug automatically.
        if not self.slug:
            self.slug = self._unique_slug_from_title()
            # Only when there isn't one yet: a brand-new listing, or staff
            # cleared the box in admin. An existing slug is never touched.
        super().save(*args, **kwargs)
        # super().save() = "now do Django's normal save". Forgetting this
        # line would mean nothing is ever written to the database.

    def _unique_slug_from_title(self):
        # slugify() is Django's built-in: "Modern 2-bed – East Legon!"
        # becomes "modern-2-bed-east-legon" (lowercase, spaces to
        # hyphens, symbols dropped).
        # Rule is title + neighborhood only (city is NOT included, so a
        # listing in Osu, Accra ends "-osu"). Keeping city out keeps slugs
        # short while neighborhood already disambiguates most cases.
        base = slugify(f'{self.title} {self.neighborhood}')[:200].strip('-') or 'listing'
        # [:200] keeps room for a suffix within max_length.
        # `or 'listing'` covers a title with no usable characters at all.

        candidate = base
        number = 2
        while Listing.objects.filter(slug=candidate).exclude(pk=self.pk).exists():
            candidate = f'{base}-{number}'
            number += 1
        # Keep trying base, base-2, base-3... until nobody else has it.
        # .exclude(pk=self.pk) — don't count THIS listing as a clash
        # with itself when it's being re-saved.
        return candidate

    def __str__(self):
        return self.title
        # Same pattern as RenterProfile/LandlordProfile — makes Django
        # admin show the listing's actual title instead of "Listing object (1)"

class ListingPhoto(models.Model):
    # A separate table, not a field on Listing — because one listing
    # needs MANY photos (a gallery), which a single field can't represent

    listing = models.ForeignKey(
        Listing, on_delete=models.CASCADE, related_name='photos'
    )
    # ForeignKey = many-to-one — many ListingPhoto rows can point at the
    # SAME Listing (one listing, many photos)
    # on_delete=models.CASCADE = if the Listing is deleted, delete all
    # its photos too — an orphaned photo with no listing is meaningless,
    # unlike the staff-verification case which used SET_NULL instead
    # related_name='photos' = lets us write listing.photos.all() to get
    # every photo belonging to a specific listing, going "backward"
    # across the relationship

    image = models.ImageField(upload_to='listing_photos/', validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'webp'])])
    # ImageField = stores an actual uploaded image file. Requires Pillow
    # (the Python imaging library) to be installed — Django uses it
    # internally to validate the upload is really a valid image.
    # upload_to='listing_photos/' = a subfolder name; Django will store
    # uploaded files under MEDIA_ROOT/listing_photos/ once that setting
    # exists (not yet configured — needed before this field can actually
    # be used, more on this below)

    order = models.PositiveIntegerField(default=0)
    # Controls what order photos appear in the gallery — lower numbers
    # shown first. Defaults to 0 so a single photo doesn't need explicit
    # ordering to work

    is_cover = models.BooleanField(default=False)
    # Marks the one photo used as the listing's thumbnail/hero image in
    # search results and the map view — separate from gallery order,
    # since the cover photo isn't necessarily always "first" logically

    created_at = models.DateTimeField(auto_now_add=True)
    # When this specific photo was uploaded — useful for sorting/auditing,
    # not in the ERD explicitly but a sensible, low-cost addition

    class Meta:
        # Meta — a special nested class models can define for
        # table-level configuration (not a field itself, unlike Role/
        # AdvanceRentPeriod which WERE TextChoices field helpers)

        ordering = ['order']
        # Tells Django: whenever photos are queried without an explicit
        # order specified, sort them by the `order` field automatically.
        # So listing.photos.all() comes back already in the right
        # gallery sequence, without every view needing to remember to
        # sort it manually each time

    def __str__(self):
        return f"{self.listing.title} - photo {self.order}"
        # Same __str__ pattern as before — makes Django admin show
        # something readable instead of "ListingPhoto object (1)"
        # self.listing.title = reaching ACROSS the ForeignKey to grab
        # the parent listing's title — this is the "forward" traversal
        # we discussed earlier, working exactly as described


class SavedListing(models.Model):
    # "Saved Homes" — one row = one renter has bookmarked one listing.
    # Deliberately a separate lightweight table, not a ManyToManyField
    # directly on User/RenterProfile — a plain M2M would work for the
    # "which listings has this renter saved" query just fine, but a real
    # table gives us created_at (when they saved it, useful for sorting
    # a "recently saved" list) essentially for free, the same reasoning
    # ListingUnlock already uses instead of a bare M2M

    renter_profile = models.ForeignKey(
        'accounts.RenterProfile', on_delete=models.CASCADE, related_name='saved_listings'
    )
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name='saved_by')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('renter_profile', 'listing')
        # Same database-level guard as ListingUnlock.Meta — a renter
        # can't end up with the same listing saved twice, even under a
        # race (double-click on the save button, etc.)
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.renter_profile} saved {self.listing}"
