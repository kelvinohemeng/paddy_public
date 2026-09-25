from django.db import migrations
from django.utils.text import slugify


def fill_missing_slugs(apps, schema_editor):
    # apps.get_model gives us the Listing model AS IT WAS at this point in
    # the migration history — a stripped-down version WITHOUT our custom
    # save() or methods. That's deliberate (migrations must keep working
    # even if models.py changes later), so the slug logic is repeated here.
    Listing = apps.get_model('listings', 'Listing')

    used = set(
        Listing.objects.exclude(slug__isnull=True).values_list('slug', flat=True)
    )
    # Every slug already taken, kept in a Python set so checking
    # "is this taken?" doesn't hit the database once per attempt.

    for listing in Listing.objects.filter(slug__isnull=True).order_by('id'):
        # order_by('id') — the oldest listing gets the plain slug, newer
        # duplicates get -2, -3... Predictable and repeatable.
        # Same rule as Listing._unique_slug_from_title: title + neighborhood.
        base = slugify(f"{listing.title} {listing.neighborhood}")[:200].strip('-') or 'listing'
        candidate = base
        number = 2
        while candidate in used:
            candidate = f'{base}-{number}'
            number += 1
        used.add(candidate)
        listing.slug = candidate
        listing.save(update_fields=['slug'])
        # update_fields — only write the slug column for each row.


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0009_listing_slug'),
    ]

    operations = [
        migrations.RunPython(fill_missing_slugs, migrations.RunPython.noop),
        # RunPython = "run this Python function as a migration step".
        # The second argument is what to do when rolling the migration
        # BACK: noop (do nothing), since 0009's rollback drops the whole
        # column anyway.
    ]
