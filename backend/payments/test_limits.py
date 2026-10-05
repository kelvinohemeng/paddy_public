"""
Tests for listing limits and what happens when a paid plan lapses
(payments/limits.py, the submit-for-review check, the review/archive
hooks, and the daily enforce_listing_caps command).

Webhook-driven behaviour (cancel, plan switching, grace-period events)
is tested in payments/tests.py next to the other webhook tests.
"""

from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import LandlordProfile, StaffProfile, User
from listings.models import Listing

from . import limits
from .models import LandlordSubscription


BASE = {
    'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
    'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
    'address_precise': '1 Limit Rd', 'neighborhood': 'Osu', 'city': 'Accra',
}


class LimitTestBase(APITestCase):
    # Shared setup: one verified landlord with no subscription (= Free).

    def setUp(self):
        self.landlord = User.objects.create_user(
            email='limits-landlord@example.com', password='pass123456', role='landlord',
            is_verified=True,
        )
        self.profile = LandlordProfile.objects.create(
            user=self.landlord, full_name='Limits Landlord', national_id_number='GHA-L1',
            preferred_payout_method='momo',
        )

    def make(self, status_value, count=1, published_days_ago=None, title=None):
        # Creates listings directly. published_days_ago sets published_at,
        # which decides which listings stay live when a plan lapses (the
        # OLDEST published ones stay).
        created = []
        for i in range(count):
            published_at = None
            if published_days_ago is not None:
                published_at = timezone.now() - timedelta(days=published_days_ago + i)
            created.append(Listing.objects.create(
                landlord_profile=self.profile,
                title=title or f'{status_value} {Listing.objects.count()}',
                status=status_value, published_at=published_at, **BASE,
            ))
        return created

    def subscribe(self, tier, period_end_in_days=20, **extra):
        return LandlordSubscription.objects.create(
            landlord_profile=self.profile, tier=tier,
            status=extra.pop('status', LandlordSubscription.Status.ACTIVE),
            current_period_end=timezone.now() + timedelta(days=period_end_in_days),
            **extra,
        )

    def statuses(self):
        return {l.title: l.status for l in Listing.objects.filter(landlord_profile=self.profile)}


class EffectiveTierTests(LimitTestBase):
    # effective_tier() decides which limits apply right now.

    def test_no_subscription_is_free(self):
        self.assertEqual(limits.effective_tier(None), LandlordSubscription.Tier.FREE)

    def test_active_paid_plan_applies(self):
        sub = self.subscribe(LandlordSubscription.Tier.AGENT)
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.AGENT)

    def test_renewing_plan_keeps_tier_during_three_day_grace(self):
        # Period ended 2 days ago and no renewal has been confirmed yet
        # (slow webhook, or Paystack still retrying): still within grace.
        sub = self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=-2)
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.AGENT)

    def test_renewing_plan_drops_to_free_after_grace(self):
        sub = self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=-4)
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.FREE)

    def test_past_due_keeps_tier_during_grace(self):
        sub = self.subscribe(
            LandlordSubscription.Tier.LORD, period_end_in_days=-1,
            status=LandlordSubscription.Status.PAST_DUE,
            past_due_since=timezone.now() - timedelta(days=1),
        )
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.LORD)

    def test_grace_runs_from_a_late_failure_not_the_period_end(self):
        # The renewal failed 1 day ago, though the period ended 5 days
        # ago: the 3 days are counted from the failure.
        sub = self.subscribe(
            LandlordSubscription.Tier.AGENT, period_end_in_days=-5,
            status=LandlordSubscription.Status.PAST_DUE,
            past_due_since=timezone.now() - timedelta(days=1),
        )
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.AGENT)

    def test_past_due_drops_to_free_after_grace(self):
        sub = self.subscribe(
            LandlordSubscription.Tier.AGENT, period_end_in_days=-4,
            status=LandlordSubscription.Status.PAST_DUE,
            past_due_since=timezone.now() - timedelta(days=4),
        )
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.FREE)

    def test_cancelled_plan_keeps_tier_until_period_end(self):
        sub = self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=5, cancel_at_period_end=True)
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.AGENT)

    def test_cancelled_plan_gets_no_grace(self):
        # Ended 1 hour ago: a renewing plan would still be in grace, but
        # a cancelled one ends exactly at current_period_end.
        sub = self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=0, cancel_at_period_end=True)
        sub.current_period_end = timezone.now() - timedelta(hours=1)
        sub.save()
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.FREE)

    def test_inactive_row_is_free_even_with_future_period(self):
        # subscription.create arrived (tier + period stored) but the
        # payment never went through: no paid access.
        sub = self.subscribe(
            LandlordSubscription.Tier.LORD, status=LandlordSubscription.Status.INACTIVE,
        )
        self.assertEqual(limits.effective_tier(sub), LandlordSubscription.Tier.FREE)


class SubmitForReviewLimitTests(LimitTestBase):
    # The live limit is checked when a listing is submitted for review.

    def submit(self, listing):
        self.client.force_authenticate(user=self.landlord)
        return self.client.post(f'/listings/{listing.id}/submit-for-review/')

    def test_free_can_submit_while_under_three_live(self):
        self.make(Listing.Status.PUBLISHED, count=2)
        [draft] = self.make(Listing.Status.DRAFT)

        response = self.submit(draft)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        draft.refresh_from_db()
        self.assertEqual(draft.status, Listing.Status.PENDING_REVIEW)

    def test_free_blocked_at_three_live_with_upgrade_code(self):
        self.make(Listing.Status.PUBLISHED, count=2)
        self.make(Listing.Status.PENDING_REVIEW, count=1)
        # In review counts as live.
        [draft] = self.make(Listing.Status.DRAFT)

        response = self.submit(draft)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'listing_limit_reached')
        self.assertEqual(response.data['listings_used'], 3)
        self.assertEqual(response.data['listing_cap'], 3)
        draft.refresh_from_db()
        self.assertEqual(draft.status, Listing.Status.DRAFT)

    def test_rejected_resubmission_also_checked(self):
        self.make(Listing.Status.PUBLISHED, count=3)
        [rejected] = self.make(Listing.Status.REJECTED)

        response = self.submit(rejected)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_drafts_rejected_archived_paused_leased_do_not_use_live_slots(self):
        for s in (Listing.Status.DRAFT, Listing.Status.REJECTED, Listing.Status.ARCHIVED,
                  Listing.Status.PAUSED, Listing.Status.LEASED):
            self.make(s, count=2)
        [draft] = self.make(Listing.Status.DRAFT, title='to submit')

        response = self.submit(draft)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_agent_limit_is_ten(self):
        self.subscribe(LandlordSubscription.Tier.AGENT)
        self.make(Listing.Status.PUBLISHED, count=9)
        first, second = self.make(Listing.Status.DRAFT, count=2)

        self.assertEqual(self.submit(first).status_code, status.HTTP_200_OK)
        self.assertEqual(self.submit(second).status_code, status.HTTP_403_FORBIDDEN)

    def test_lord_has_no_live_limit(self):
        self.subscribe(LandlordSubscription.Tier.LORD)
        self.make(Listing.Status.PUBLISHED, count=25)
        [draft] = self.make(Listing.Status.DRAFT)

        self.assertEqual(self.submit(draft).status_code, status.HTTP_200_OK)

    def test_lapsed_plan_uses_free_limit(self):
        self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=-10)
        self.make(Listing.Status.PUBLISHED, count=3)
        [draft] = self.make(Listing.Status.DRAFT)

        self.assertEqual(self.submit(draft).status_code, status.HTTP_403_FORBIDDEN)


class EnforceListingCapsTests(LimitTestBase):
    # What happens to published listings when the limit drops, and how
    # they come back.

    def test_lapse_pauses_newest_and_keeps_oldest_live(self):
        self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=-10)
        # Lapsed long ago → Free limit of 3.
        self.make(Listing.Status.PUBLISHED, title='oldest', published_days_ago=100)
        self.make(Listing.Status.PUBLISHED, title='old', published_days_ago=90)
        self.make(Listing.Status.PUBLISHED, title='middle', published_days_ago=80)
        self.make(Listing.Status.PUBLISHED, title='new', published_days_ago=5)
        self.make(Listing.Status.PUBLISHED, title='newest', published_days_ago=1)

        paused, restored = limits.enforce_listing_caps(self.profile)

        self.assertEqual(len(paused), 2)
        self.assertEqual(restored, [])
        self.assertEqual(self.statuses(), {
            'oldest': Listing.Status.PUBLISHED,
            'old': Listing.Status.PUBLISHED,
            'middle': Listing.Status.PUBLISHED,
            'new': Listing.Status.PAUSED,
            'newest': Listing.Status.PAUSED,
        })

    def test_listing_without_published_at_counts_as_newest(self):
        self.make(Listing.Status.PUBLISHED, count=3, published_days_ago=10)
        self.make(Listing.Status.PUBLISHED, title='no date')

        limits.enforce_listing_caps(self.profile)

        self.assertEqual(self.statuses()['no date'], Listing.Status.PAUSED)

    def test_pending_review_is_never_paused(self):
        # Kelvin: let review finish. Only published listings are paused.
        self.make(Listing.Status.PUBLISHED, count=3, published_days_ago=10)
        self.make(Listing.Status.PENDING_REVIEW, title='in review')

        paused, _ = limits.enforce_listing_caps(self.profile)

        self.assertEqual(paused, [])
        self.assertEqual(self.statuses()['in review'], Listing.Status.PENDING_REVIEW)

    def test_within_grace_nothing_is_paused(self):
        self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=-1)
        self.make(Listing.Status.PUBLISHED, count=6, published_days_ago=10)

        paused, _ = limits.enforce_listing_caps(self.profile)

        self.assertEqual(paused, [])

    def test_payment_restores_paused_oldest_first_up_to_limit(self):
        self.make(Listing.Status.PUBLISHED, count=3, published_days_ago=100)
        for days, title in ((50, 'p-old'), (40, 'p-mid'), (30, 'p-new')):
            self.make(Listing.Status.PAUSED, title=title, published_days_ago=days)
        self.make(Listing.Status.PENDING_REVIEW, count=6)
        # Agent limit 10: 3 published + 6 in review = 9 live, so ONE
        # paused listing fits — the oldest.
        self.subscribe(LandlordSubscription.Tier.AGENT)

        _, restored = limits.enforce_listing_caps(self.profile)

        self.assertEqual(len(restored), 1)
        statuses = self.statuses()
        self.assertEqual(statuses['p-old'], Listing.Status.PUBLISHED)
        self.assertEqual(statuses['p-mid'], Listing.Status.PAUSED)
        self.assertEqual(statuses['p-new'], Listing.Status.PAUSED)

    def test_lord_restores_everything(self):
        self.make(Listing.Status.PAUSED, count=12, published_days_ago=10)
        self.subscribe(LandlordSubscription.Tier.LORD)

        _, restored = limits.enforce_listing_caps(self.profile)

        self.assertEqual(len(restored), 12)
        self.assertFalse(Listing.objects.filter(status=Listing.Status.PAUSED).exists())

    def test_running_twice_changes_nothing_the_second_time(self):
        self.make(Listing.Status.PUBLISHED, count=5, published_days_ago=10)

        limits.enforce_listing_caps(self.profile)
        paused, restored = limits.enforce_listing_caps(self.profile)

        self.assertEqual((paused, restored), ([], []))

    def test_paused_listing_is_hidden_from_public(self):
        [listing] = self.make(Listing.Status.PAUSED)

        response = self.client.get(f'/listings/{listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_owner_can_still_see_paused_listing(self):
        [listing] = self.make(Listing.Status.PAUSED)
        self.client.force_authenticate(user=self.landlord)

        response = self.client.get(f'/listings/{listing.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PAUSED)


class ArchiveAndReviewHookTests(LimitTestBase):

    def test_archiving_a_live_listing_restores_a_paused_one(self):
        live = self.make(Listing.Status.PUBLISHED, count=3, published_days_ago=100)
        self.make(Listing.Status.PAUSED, title='waiting', published_days_ago=5)
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post(f'/listings/{live[0].id}/archive/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.statuses()['waiting'], Listing.Status.PUBLISHED)

    def test_landlord_can_archive_a_paused_listing(self):
        [paused] = self.make(Listing.Status.PAUSED)
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post(f'/listings/{paused.id}/archive/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        paused.refresh_from_db()
        self.assertEqual(paused.status, Listing.Status.ARCHIVED)

    def test_paused_listing_cannot_be_submitted_for_review(self):
        # Paused comes back on its own when the landlord pays; it isn't
        # a draft to resubmit.
        [paused] = self.make(Listing.Status.PAUSED)
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post(f'/listings/{paused.id}/submit-for-review/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_approving_over_the_limit_pauses_the_new_listing(self):
        # The plan lapsed while this listing was in review. Review
        # finishes; on approval the landlord is over the Free limit, so
        # the newly published listing (the newest) is paused.
        staff = User.objects.create_user(
            email='limits-staff@example.com', password='pass123456', role='staff',
        )
        StaffProfile.objects.create(user=staff, full_name='Limits Staff', can_approve_listings=True)
        self.make(Listing.Status.PUBLISHED, count=3, published_days_ago=100)
        [pending] = self.make(Listing.Status.PENDING_REVIEW)
        self.client.force_authenticate(user=staff)

        response = self.client.post(f'/listings/{pending.id}/review/', {'decision': 'published'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Listing.Status.PAUSED)
        pending.refresh_from_db()
        self.assertEqual(pending.status, Listing.Status.PAUSED)
        self.assertIsNotNone(pending.published_at)
        # published_at is still set, so when the landlord pays it comes
        # back in the right order.

    def test_approving_under_the_limit_publishes_normally(self):
        staff = User.objects.create_user(
            email='limits-staff2@example.com', password='pass123456', role='staff',
        )
        StaffProfile.objects.create(user=staff, full_name='Limits Staff 2', can_approve_listings=True)
        [pending] = self.make(Listing.Status.PENDING_REVIEW)
        self.client.force_authenticate(user=staff)

        response = self.client.post(f'/listings/{pending.id}/review/', {'decision': 'published'}, format='json')

        self.assertEqual(response.data['status'], Listing.Status.PUBLISHED)


class SubscriptionUsageEndpointTests(LimitTestBase):
    # GET /payments/subscription/ returns the numbers the card shows.

    def get(self):
        self.client.force_authenticate(user=self.landlord)
        return self.client.get('/payments/subscription/')

    def test_free_landlord_usage(self):
        self.make(Listing.Status.PUBLISHED, count=2)
        self.make(Listing.Status.PENDING_REVIEW)
        self.make(Listing.Status.DRAFT, count=4)
        self.make(Listing.Status.REJECTED)
        self.make(Listing.Status.ARCHIVED, count=2)

        data = self.get().data

        self.assertEqual(data['tier'], LandlordSubscription.Tier.FREE)
        self.assertEqual(data['effective_tier'], LandlordSubscription.Tier.FREE)
        self.assertEqual(data['listings_used'], 3)
        self.assertEqual(data['listing_cap'], 3)
        self.assertEqual(data['listings_draft'], 4)
        self.assertEqual(data['listings_total'], 8)
        # 3 live + 4 drafts + 1 rejected; archived don't count.
        self.assertEqual(data['listing_total_cap'], 10)
        self.assertIsNone(data['paid_access_ends_at'])

    def test_paid_landlord_has_no_total_numbers(self):
        self.subscribe(LandlordSubscription.Tier.AGENT)
        self.make(Listing.Status.PUBLISHED, count=4)

        data = self.get().data

        self.assertEqual(data['effective_tier'], LandlordSubscription.Tier.AGENT)
        self.assertEqual(data['listings_used'], 4)
        self.assertEqual(data['listing_cap'], 10)
        self.assertIsNone(data['listings_total'])
        self.assertIsNone(data['listing_total_cap'])
        self.assertFalse(data['cancel_at_period_end'])

    def test_lapsed_plan_shows_stored_tier_but_free_limits(self):
        self.subscribe(LandlordSubscription.Tier.LORD, period_end_in_days=-10)
        self.make(Listing.Status.PAUSED, count=2)

        data = self.get().data

        self.assertEqual(data['tier'], LandlordSubscription.Tier.LORD)
        self.assertEqual(data['effective_tier'], LandlordSubscription.Tier.FREE)
        self.assertEqual(data['listing_cap'], 3)
        self.assertEqual(data['listings_paused'], 2)


class EnforceListingCapsCommandTests(LimitTestBase):

    def test_command_pauses_lapsed_landlords(self):
        self.subscribe(LandlordSubscription.Tier.AGENT, period_end_in_days=-10)
        self.make(Listing.Status.PUBLISHED, count=5, published_days_ago=10)
        out = StringIO()

        call_command('enforce_listing_caps', stdout=out)

        self.assertEqual(Listing.objects.filter(status=Listing.Status.PAUSED).count(), 2)
        self.assertIn('Paused 2', out.getvalue())

    def test_dry_run_changes_nothing(self):
        self.make(Listing.Status.PUBLISHED, count=5, published_days_ago=10)
        out = StringIO()

        call_command('enforce_listing_caps', '--dry-run', stdout=out)

        self.assertFalse(Listing.objects.filter(status=Listing.Status.PAUSED).exists())
        self.assertIn('would pause 2', out.getvalue())

    def test_dry_run_reports_paused_listings_that_may_come_back(self):
        self.make(Listing.Status.PAUSED, count=2, published_days_ago=10)
        out = StringIO()

        call_command('enforce_listing_caps', '--dry-run', stdout=out)

        self.assertIn('2 paused', out.getvalue())
        self.assertEqual(Listing.objects.filter(status=Listing.Status.PAUSED).count(), 2)


@override_settings(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
class EnforceListingCapsRetryTests(LimitTestBase):
    # The command's first job: finish plan switches where turning off the
    # OLD Paystack subscription failed earlier (Paystack was down).

    def _switched_plan(self):
        return self.subscribe(
            LandlordSubscription.Tier.LORD, paystack_plan_code='PLN_lord_test',
            paystack_subscription_code='SUB_new', paystack_email_token='tok_new',
            superseded_subscription_code='SUB_old', superseded_email_token='tok_old',
        )

    @patch('payments.paystack.disable_subscription', return_value={'status': True})
    def test_retries_turning_off_the_old_subscription(self, mock_disable):
        subscription = self._switched_plan()
        out = StringIO()

        call_command('enforce_listing_caps', stdout=out)

        mock_disable.assert_called_once_with('SUB_old', 'tok_old')
        subscription.refresh_from_db()
        self.assertEqual(subscription.superseded_subscription_code, '')
        self.assertIn('retired 1', out.getvalue())

    @patch('payments.paystack.disable_subscription')
    def test_dry_run_does_not_call_paystack(self, mock_disable):
        subscription = self._switched_plan()
        out = StringIO()

        call_command('enforce_listing_caps', '--dry-run', stdout=out)

        mock_disable.assert_not_called()
        subscription.refresh_from_db()
        self.assertEqual(subscription.superseded_subscription_code, 'SUB_old')
        self.assertIn('Would retry', out.getvalue())
