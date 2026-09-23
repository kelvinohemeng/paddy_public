# Ensures the 11 canonical amenities (see core/choices.py) exist in every
# environment with underscore slugs, and heals legacy hyphen-slugged rows
# (minted by slugify() before create()/seed_dev_data normalized to
# underscores). Without this, the public Discovery Hub filter can offer
# slugs that match nothing in the database.
#
# Safe to run anywhere: pure get_or_create/normalize, never deletes a
# listing or an amenity that is still referenced. If a legacy hyphen row
# AND a canonical row both exist for the same amenity, listings pointing
# at the legacy row are repointed to the canonical one before the legacy
# row is removed — the M2M moves, no listing loses an amenity.

from django.db import migrations


# Hardcoded snapshot of core/choices.py at the time of writing —
# migrations must stay self-contained, never import live app code that
# may change shape later.
CANONICAL_AMENITIES = [
    ('water_storage', 'Water Storage'),
    ('backup_power', 'Backup Power'),
    ('walled_gated', 'Walled Gated'),
    ('wifi', 'Wifi'),
    ('parking', 'Parking'),
    ('gym', 'Gym'),
    ('swimming_pool', 'Swimming Pool'),
    ('furnished', 'Furnished'),
    ('air_conditioning', 'Air Conditioning'),
    ('security', 'Security'),
    ('maintenance', 'Maintenance'),
]


def seed_canonical_amenities(apps, schema_editor):
    Amenity = apps.get_model('core', 'Amenity')

    for slug, name in CANONICAL_AMENITIES:
        canonical = Amenity.objects.filter(slug__iexact=slug).first()
        if canonical is None:
            canonical = Amenity.objects.filter(name__iexact=name).first()
            if canonical is not None:
                # Row exists under the right name but a legacy slug
                # (e.g. "water-storage") — adopt the canonical slug.
                # Slug-only update: no other row can own this slug
                # (we just checked), so unique=True can't collide.
                canonical.slug = slug
                canonical.save(update_fields=['slug'])
            else:
                canonical = Amenity.objects.create(name=name, slug=slug)

        # Heal a leftover legacy hyphen twin, if one exists alongside
        # the canonical row (e.g. seeded "Walled & Gated"/"walled-gated"
        # next to canonical "Walled Gated"/"walled_gated").
        legacy_slug = slug.replace('_', '-')
        if legacy_slug != slug:
            legacy = Amenity.objects.filter(slug__iexact=legacy_slug).exclude(
                pk=canonical.pk
            ).first()
            if legacy is not None:
                for listing in legacy.listings.all():
                    listing.amenities.add(canonical)
                    listing.amenities.remove(legacy)
                # Delete only once nothing references it anymore — a
                # legacy row still attached to listings is left alone
                # rather than risk data loss (the loop above already
                # moved every reference, so this normally deletes).
                if not legacy.listings.exists():
                    legacy.delete()


def noop_reverse(apps, schema_editor):
    # Deliberately irreversible: rolling back must not delete amenity
    # rows that listings may reference by now.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
        # listings must exist so legacy-row healing can traverse the
        # Listing.amenities M2M (listings.0006 introduced the M2M field).
        ('listings', '0006_remove_listing_has_backup_power_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_canonical_amenities, noop_reverse),
    ]
