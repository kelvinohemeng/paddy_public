"""
Daily clean-up for listing limits. Run once a day (a Render Cron Job, or
any scheduler):

    python manage.py enforce_listing_caps

WHY IT'S NEEDED: most limit changes are triggered by Paystack webhooks
(a failed renewal, a cancel, a successful payment). But some changes
happen with NO event at all — time just passes:
  - a cancelled plan reaches its current_period_end,
  - the 3-day grace period after a failed renewal runs out,
  - a renewal we never heard about (lost webhook) leaves the period
    ended.
Nothing calls our server at those moments, so this command checks every
landlord who could be affected and pauses (or restores) listings to
match their limit right now.

It also retries turning off OLD Paystack subscriptions left over from a
plan switch, in case Paystack was unreachable when the switch happened —
otherwise a landlord could keep being charged for a plan they left.

Safe to run as often as you like: when nothing needs to change, nothing
changes. Use --dry-run to see what WOULD change without changing it.
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from accounts.models import LandlordProfile
from listings.models import Listing
from payments import limits
from payments.models import LandlordSubscription
from payments.views import retire_superseded_subscription


class Command(BaseCommand):
    help = 'Pause/restore listings so every landlord matches their current plan limit (run daily).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Only report which landlords are over their limit; change nothing.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        retried = 0
        for subscription in LandlordSubscription.objects.exclude(superseded_subscription_code=''):
            if dry_run:
                self.stdout.write(f'Would retry retiring old Paystack subscription for {subscription.landlord_profile}')
                continue
            if retire_superseded_subscription(subscription):
                retried += 1
        # Plan-switch leftovers first, so the limits below are worked out
        # after any switch has been tidied up.

        candidates = LandlordProfile.objects.filter(
            Q(listings__status=Listing.Status.PUBLISHED) | Q(listings__status=Listing.Status.PAUSED)
        ).distinct()
        # Only landlords with something that could change: published
        # listings (might need pausing) or paused ones (might come back).
        # Everyone else is skipped, so the daily run stays cheap.

        total_paused = 0
        total_restored = 0
        for landlord_profile in candidates:
            if dry_run:
                usage = limits.usage_for(landlord_profile)
                cap = usage['listing_cap']
                published = Listing.objects.filter(
                    landlord_profile=landlord_profile, status=Listing.Status.PUBLISHED
                ).count()
                if cap is not None and published > cap:
                    self.stdout.write(f'{landlord_profile}: {published} published, limit {cap} — would pause {published - cap}')
                elif usage['listings_paused']:
                    self.stdout.write(f'{landlord_profile}: {usage["listings_paused"]} paused — some may be restored')
                continue

            paused, restored = limits.enforce_listing_caps(landlord_profile)
            total_paused += len(paused)
            total_restored += len(restored)
            if paused or restored:
                self.stdout.write(f'{landlord_profile}: paused {len(paused)}, restored {len(restored)}')

        if not dry_run:
            self.stdout.write(self.style.SUCCESS(
                f'Done. Paused {total_paused}, restored {total_restored}, '
                f'retired {retried} old Paystack subscription(s).'
            ))
