"""
One-off management command to create a superuser from environment
variables, non-interactively — needed because Render's free tier has
no Shell access (the normal `createsuperuser` command requires an
interactive terminal to prompt for a password, which doesn't exist
during Render's build step).

USAGE (temporary, meant to be removed from the build command after
running once):
    python manage.py create_superuser_from_env

Reads DJANGO_SUPERUSER_EMAIL and DJANGO_SUPERUSER_PASSWORD from the
environment (set as temporary env vars on Render, deleted afterward).
Safe to run multiple times — does nothing if a user with that email
already exists, rather than erroring or creating a duplicate.
"""
import os

from django.core.management.base import BaseCommand

from accounts.models import User


class Command(BaseCommand):
    help = "Create a superuser from DJANGO_SUPERUSER_EMAIL/DJANGO_SUPERUSER_PASSWORD env vars, non-interactively"

    def handle(self, *args, **options):
        email = os.environ.get('DJANGO_SUPERUSER_EMAIL')
        password = os.environ.get('DJANGO_SUPERUSER_PASSWORD')

        if not email or not password:
            # Deliberately does NOT raise an error here — this lets the
            # command stay safely in the build command indefinitely
            # without breaking every future deploy, in case the env
            # vars get removed later (which they should be, once the
            # superuser exists) but the command line itself is
            # forgotten and left in place
            self.stdout.write(self.style.WARNING(
                'DJANGO_SUPERUSER_EMAIL/DJANGO_SUPERUSER_PASSWORD not set — skipping superuser creation.'
            ))
            return

        if User.objects.filter(email=email).exists():
            # Already exists — this is what makes the command safe to
            # leave in the build command across multiple deploys
            # without erroring or creating a second conflicting user
            self.stdout.write(self.style.SUCCESS(
                f'Superuser with email {email} already exists — skipping.'
            ))
            return

        User.objects.create_superuser(email=email, password=password)
        # create_superuser — a method Django's own UserManager provides
        # automatically (built on top of the create_user method your
        # own UserManager already customizes), which additionally sets
        # is_staff=True and is_superuser=True, granting full Django
        # admin access
        self.stdout.write(self.style.SUCCESS(f'Superuser {email} created.'))
