"""
Tests for the subscription lifecycle: cancel, the not_renew/disable
webhooks, the failed-renewal grace clock, plan switching (agent ↔ lord)
and the replay guard on old plan charges.

Paystack is never called for real: every call to payments.paystack is
replaced with a fake (unittest.mock.patch) that returns what Paystack
would, so these tests are fast and don't need network access.
"""

import json
from datetime import timedelta
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import LandlordProfile, User
from listings.models import Listing

from .models import LandlordSubscription
from .tests import sign
from .views import retire_superseded_subscription


PLANS = dict(PAYSTACK_AGENT_PLAN_CODE='PLN_agent_test', PAYSTACK_LORD_PLAN_CODE='PLN_lord_test')
# Fake plan codes for these tests, the same trick payments/tests.py uses.

OK = {'status': True, 'message': 'ok'}
PAYSTACK_DOWN = {'status': False, 'message': 'Could not reach Paystack. Please try again.'}

BASE = {
    'description': 'Test', 'listing_type': 'rent', 'price_monthly': '2000.00',
    'advance_rent_period': '1_year', 'bedrooms': 1, 'bathrooms': 1,
    'address_precise': '1 Sub Rd', 'neighborhood': 'Osu', 'city': 'Accra',
}


@override_settings(**PLANS)
class LifecycleTestBase(APITestCase):

    def setUp(self):
        self.landlord = User.objects.create_user(
            email='lifecycle@example.com', password='pass123456', role='landlord', is_verified=True,
        )
        self.profile = LandlordProfile.objects.create(
            user=self.landlord, full_name='Lifecycle Landlord', national_id_number='GHA-S1',
            preferred_payout_method='momo',
        )

    def webhook(self, event, data):
        body = json.dumps({'event': event, 'data': data}).encode('utf-8')
        response = self.client.post(
            '/payments/webhook/', data=body, content_type='application/json',
            HTTP_X_PAYSTACK_SIGNATURE=sign(body),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response

    def subscription(self):
        return LandlordSubscription.objects.get(landlord_profile=self.profile)

    def active_plan(self, tier, code, plan_code, token='tok_old', days=20, **extra):
        return LandlordSubscription.objects.create(
            landlord_profile=self.profile, tier=tier,
            status=LandlordSubscription.Status.ACTIVE,
            current_period_end=timezone.now() + timedelta(days=days),
            paystack_subscription_code=code, paystack_email_token=token,
            paystack_plan_code=plan_code, **extra,
        )

    def publish(self, count, days_ago=100):
        for i in range(count):
            Listing.objects.create(
                landlord_profile=self.profile, title=f'pub {i}', status=Listing.Status.PUBLISHED,
                published_at=timezone.now() - timedelta(days=days_ago - i), **BASE,
            )

    def charge(self, plan_code, paid_at, reference='ref'):
        return {
            'customer': {'email': self.landlord.email},
            'plan_object': {'plan_code': plan_code},
            'paid_at': paid_at.isoformat(),
            'reference': reference,
        }


class CancelSubscriptionTests(LifecycleTestBase):

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_cancel_keeps_plan_until_period_end(self, mock_disable):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_disable.assert_called_once_with('SUB_1', 'tok_old')
        self.assertTrue(response.data['cancel_at_period_end'])
        self.assertEqual(response.data['effective_tier'], LandlordSubscription.Tier.AGENT)
        # Still agent — they paid for the rest of this period.
        self.assertEqual(response.data['paid_access_ends_at'], self.subscription().current_period_end)
        # No grace period after a cancel.

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_cancel_does_not_need_verified_email(self, mock_disable):
        self.landlord.is_verified = False
        self.landlord.save()
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    @patch('payments.paystack.disable_subscription', return_value=PAYSTACK_DOWN)
    @patch('payments.paystack.fetch_subscription', return_value=PAYSTACK_DOWN)
    def test_cancel_changes_nothing_if_paystack_is_down(self, mock_fetch, mock_disable):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertFalse(self.subscription().cancel_at_period_end)
        # Never tell the landlord "cancelled" while Paystack may still
        # charge them.

    @patch('payments.paystack.disable_subscription', return_value={'status': False, 'message': 'already inactive'})
    @patch('payments.paystack.fetch_subscription', return_value={'status': True, 'data': {'status': 'non-renewing'}})
    def test_cancel_succeeds_if_paystack_already_stopped_it(self, mock_fetch, mock_disable):
        # e.g. the landlord used the cancel link in Paystack's email first.
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(self.subscription().cancel_at_period_end)

    @patch('payments.paystack.disable_subscription', return_value=OK)
    @patch('payments.paystack.fetch_subscription', return_value={'status': True, 'data': {'email_token': 'tok_fetched'}})
    def test_cancel_fetches_missing_email_token(self, mock_fetch, mock_disable):
        # Rows saved before this change have no email token stored.
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test', token='')
        self.client.force_authenticate(user=self.landlord)

        self.client.post('/payments/subscription/cancel/')

        mock_disable.assert_called_once_with('SUB_1', 'tok_fetched')

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_cancel_mid_switch_disables_both_subscriptions(self, mock_disable):
        self.active_plan(
            LandlordSubscription.Tier.AGENT, 'SUB_new', 'PLN_lord_test', token='tok_new',
            superseded_subscription_code='SUB_old', superseded_email_token='tok_old',
        )
        self.client.force_authenticate(user=self.landlord)

        self.client.post('/payments/subscription/cancel/')

        disabled = {call.args for call in mock_disable.call_args_list}
        self.assertEqual(disabled, {('SUB_new', 'tok_new'), ('SUB_old', 'tok_old')})
        self.assertEqual(self.subscription().superseded_subscription_code, '')

    @patch('payments.paystack.disable_subscription')
    def test_free_landlord_cannot_cancel(self, mock_disable):
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'no_paid_plan')
        mock_disable.assert_not_called()

    @patch('payments.paystack.disable_subscription')
    def test_cannot_cancel_twice(self, mock_disable):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test', cancel_at_period_end=True)
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.data['code'], 'already_cancelled')
        mock_disable.assert_not_called()

    def test_renter_cannot_cancel(self):
        renter = User.objects.create_user(email='cancel-renter@example.com', password='pass123456')
        self.client.force_authenticate(user=renter)

        response = self.client.post('/payments/subscription/cancel/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class CancelWebhookTests(LifecycleTestBase):

    def test_not_renew_marks_cancelled(self):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')

        self.webhook('subscription.not_renew', {'subscription_code': 'SUB_1', 'status': 'non-renewing'})

        self.assertTrue(self.subscription().cancel_at_period_end)

    def test_disable_after_period_end_pauses_listings(self):
        sub = self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        sub.current_period_end = timezone.now() - timedelta(minutes=5)
        sub.save()
        self.publish(6)

        self.webhook('subscription.disable', {'subscription_code': 'SUB_1', 'status': 'cancelled'})

        self.assertEqual(Listing.objects.filter(status=Listing.Status.PUBLISHED).count(), 3)
        self.assertEqual(Listing.objects.filter(status=Listing.Status.PAUSED).count(), 3)

    def test_disable_for_an_old_code_does_not_touch_current_plan(self):
        # After a switch, Paystack sends subscription.disable for the OLD
        # plan. It must not mark the NEW plan cancelled.
        self.active_plan(LandlordSubscription.Tier.LORD, 'SUB_new', 'PLN_lord_test')

        self.webhook('subscription.disable', {
            'subscription_code': 'SUB_old', 'customer': {'email': self.landlord.email},
        })

        self.assertFalse(self.subscription().cancel_at_period_end)


class GraceClockTests(LifecycleTestBase):

    def test_first_failure_starts_clock_and_repeats_do_not_restart_it(self):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        failed = {'customer': {'email': self.landlord.email}, 'subscription': {'subscription_code': 'SUB_1'}}

        self.webhook('invoice.payment_failed', failed)
        first = self.subscription().past_due_since
        self.webhook('invoice.payment_failed', failed)

        self.assertIsNotNone(first)
        self.assertEqual(self.subscription().past_due_since, first)
        self.assertEqual(self.subscription().status, LandlordSubscription.Status.PAST_DUE)

    def test_failure_within_grace_does_not_pause(self):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test', days=0)
        self.publish(6)

        self.webhook('invoice.payment_failed', {'customer': {'email': self.landlord.email}})

        self.assertFalse(Listing.objects.filter(status=Listing.Status.PAUSED).exists())

    def test_successful_retry_clears_clock_and_restores_listings(self):
        sub = self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test', days=-10)
        sub.status = LandlordSubscription.Status.PAST_DUE
        sub.past_due_since = timezone.now() - timedelta(days=10)
        sub.save()
        self.publish(3)
        for i in range(3):
            Listing.objects.create(
                landlord_profile=self.profile, title=f'paused {i}', status=Listing.Status.PAUSED,
                published_at=timezone.now() - timedelta(days=5), **BASE,
            )

        self.webhook('invoice.update', {
            'paid': True, 'status': 'success', 'customer': {'email': self.landlord.email},
            'subscription': {'subscription_code': 'SUB_1',
                             'next_payment_date': (timezone.now() + timedelta(days=30)).isoformat()},
        })

        self.assertIsNone(self.subscription().past_due_since)
        self.assertFalse(Listing.objects.filter(status=Listing.Status.PAUSED).exists())


class InitiateSwitchGuardTests(LifecycleTestBase):

    @patch('payments.paystack.initialize_transaction')
    def test_cannot_subscribe_to_current_plan(self, mock_init):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscribe/', {'tier': 'agent', 'amount_kobo': 25000}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'already_on_plan')
        mock_init.assert_not_called()

    @patch('payments.paystack.initialize_transaction', return_value={'status': True, 'data': {'authorization_url': 'x'}})
    def test_can_start_switch_to_other_plan(self, mock_init):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test')
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscribe/', {'tier': 'lord', 'amount_kobo': 100000}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(mock_init.call_args.kwargs['plan_code'], 'PLN_lord_test')

    @patch('payments.paystack.initialize_transaction')
    def test_one_switch_at_a_time(self, mock_init):
        self.active_plan(
            LandlordSubscription.Tier.AGENT, 'SUB_new', 'PLN_lord_test',
            superseded_subscription_code='SUB_old',
        )
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscribe/', {'tier': 'lord', 'amount_kobo': 100000}, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        mock_init.assert_not_called()

    @patch('payments.paystack.initialize_transaction', return_value={'status': True, 'data': {}})
    def test_can_resubscribe_to_same_plan_after_lapse(self, mock_init):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_1', 'PLN_agent_test', days=-10)
        self.client.force_authenticate(user=self.landlord)

        response = self.client.post('/payments/subscribe/', {'tier': 'agent', 'amount_kobo': 25000}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class PlanSwitchTests(LifecycleTestBase):
    # The full agent ↔ lord flow must end with exactly ONE Paystack
    # subscription still running.

    def new_subscription_event(self, code, plan_code, token='tok_new', days=30):
        return {
            'customer': {'email': self.landlord.email, 'customer_code': 'CUS_1'},
            'subscription_code': code, 'email_token': token,
            'plan': {'plan_code': plan_code},
            'next_payment_date': (timezone.now() + timedelta(days=days)).isoformat(),
        }

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_upgrade_agent_to_lord(self, mock_disable):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_old', 'PLN_agent_test',
                         last_plan_charge_at=timezone.now() - timedelta(days=10))

        self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_lord_test'))

        sub = self.subscription()
        self.assertEqual(sub.tier, LandlordSubscription.Tier.AGENT)
        # Mid-switch: still agent until the lord charge is confirmed.
        self.assertEqual(sub.superseded_subscription_code, 'SUB_old')
        self.assertEqual(sub.paystack_subscription_code, 'SUB_new')
        mock_disable.assert_not_called()
        # The old plan is NOT turned off before the new one is paid for.

        self.webhook('charge.success', self.charge('PLN_lord_test', timezone.now()))

        sub = self.subscription()
        self.assertEqual(sub.tier, LandlordSubscription.Tier.LORD)
        self.assertEqual(sub.superseded_subscription_code, '')
        mock_disable.assert_called_once_with('SUB_old', 'tok_old')
        # Exactly one subscription left running: the new one.

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_charge_before_subscription_create_still_retires_old(self, mock_disable):
        # Paystack doesn't promise webhook order.
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_old', 'PLN_agent_test',
                         last_plan_charge_at=timezone.now() - timedelta(days=10))

        self.webhook('charge.success', self.charge('PLN_lord_test', timezone.now()))
        self.assertEqual(self.subscription().tier, LandlordSubscription.Tier.LORD)
        mock_disable.assert_not_called()
        # We don't know the new subscription's code yet, so there's
        # nothing to retire.

        self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_lord_test'))

        mock_disable.assert_called_once_with('SUB_old', 'tok_old')
        sub = self.subscription()
        self.assertEqual(sub.paystack_subscription_code, 'SUB_new')
        self.assertEqual(sub.superseded_subscription_code, '')
        self.assertEqual(sub.tier, LandlordSubscription.Tier.LORD)

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_downgrade_lord_to_agent_pauses_newest_over_ten(self, mock_disable):
        self.active_plan(LandlordSubscription.Tier.LORD, 'SUB_old', 'PLN_lord_test',
                         last_plan_charge_at=timezone.now() - timedelta(days=10))
        self.publish(13)

        self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_agent_test'))
        self.assertFalse(Listing.objects.filter(status=Listing.Status.PAUSED).exists())
        # Still lord until the agent charge lands.

        self.webhook('charge.success', self.charge('PLN_agent_test', timezone.now()))

        self.assertEqual(self.subscription().tier, LandlordSubscription.Tier.AGENT)
        self.assertEqual(Listing.objects.filter(status=Listing.Status.PUBLISHED).count(), 10)
        paused_titles = set(Listing.objects.filter(status=Listing.Status.PAUSED).values_list('title', flat=True))
        self.assertEqual(paused_titles, {'pub 10', 'pub 11', 'pub 12'})
        # The three most recently published.
        mock_disable.assert_called_once_with('SUB_old', 'tok_old')

    @patch('payments.paystack.disable_subscription', return_value=PAYSTACK_DOWN)
    @patch('payments.paystack.fetch_subscription', return_value=PAYSTACK_DOWN)
    def test_old_subscription_kept_for_retry_if_paystack_down(self, mock_fetch, mock_disable):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_old', 'PLN_agent_test',
                         last_plan_charge_at=timezone.now() - timedelta(days=10))

        self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_lord_test'))
        self.webhook('charge.success', self.charge('PLN_lord_test', timezone.now()))

        sub = self.subscription()
        self.assertEqual(sub.tier, LandlordSubscription.Tier.LORD)
        self.assertEqual(sub.superseded_subscription_code, 'SUB_old')
        # Not forgotten: the daily command retries.

        with patch('payments.paystack.disable_subscription', return_value=OK) as retry:
            self.assertTrue(retire_superseded_subscription(sub))
            retry.assert_called_once_with('SUB_old', 'tok_old')
        self.assertEqual(self.subscription().superseded_subscription_code, '')

    @patch('payments.paystack.disable_subscription', return_value=PAYSTACK_DOWN)
    @patch('payments.paystack.fetch_subscription', return_value=PAYSTACK_DOWN)
    def test_old_plan_renewal_after_switch_does_not_flip_tier_back(self, mock_fetch, mock_disable):
        # The switch to lord is confirmed, but the old agent subscription
        # couldn't be turned off yet and has now charged again.
        self.active_plan(
            LandlordSubscription.Tier.LORD, 'SUB_new', 'PLN_lord_test',
            superseded_subscription_code='SUB_old', superseded_email_token='tok_old',
            last_plan_charge_at=timezone.now() - timedelta(days=1),
        )

        self.webhook('charge.success', self.charge('PLN_agent_test', timezone.now()))

        self.assertEqual(self.subscription().tier, LandlordSubscription.Tier.LORD)

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_old_plan_events_are_ignored_mid_switch(self, mock_disable):
        sub = self.active_plan(
            LandlordSubscription.Tier.AGENT, 'SUB_new', 'PLN_lord_test',
            superseded_subscription_code='SUB_old', superseded_email_token='tok_old',
        )
        period_end = sub.current_period_end

        self.webhook('invoice.payment_failed', {
            'customer': {'email': self.landlord.email}, 'subscription': {'subscription_code': 'SUB_old'},
        })
        self.webhook('invoice.update', {
            'paid': True, 'customer': {'email': self.landlord.email},
            'subscription': {'subscription_code': 'SUB_old', 'next_payment_date': '2030-01-01T00:00:00Z'},
        })

        sub = self.subscription()
        self.assertEqual(sub.status, LandlordSubscription.Status.ACTIVE)
        self.assertIsNone(sub.past_due_since)
        self.assertEqual(sub.current_period_end, period_end)

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_mid_switch_period_end_never_moves_earlier(self, mock_disable):
        sub = self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_old', 'PLN_agent_test', days=25)
        period_end = sub.current_period_end

        self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_lord_test', days=5))

        self.assertEqual(self.subscription().current_period_end, period_end)

    @patch('payments.paystack.disable_subscription', return_value=OK)
    def test_resubscribe_after_lapse_retires_leftover_old_subscription(self, mock_disable):
        # Lapsed after failed renewals; the old Paystack subscription may
        # still be alive and retrying. Subscribing again must switch it off.
        sub = self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_old', 'PLN_agent_test', days=-10)
        sub.status = LandlordSubscription.Status.PAST_DUE
        sub.past_due_since = timezone.now() - timedelta(days=10)
        sub.save()

        self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_agent_test'))
        self.webhook('charge.success', self.charge('PLN_agent_test', timezone.now()))

        sub = self.subscription()
        self.assertEqual(sub.status, LandlordSubscription.Status.ACTIVE)
        self.assertEqual(sub.paystack_subscription_code, 'SUB_new')
        mock_disable.assert_called_once_with('SUB_old', 'tok_old')

    def test_new_subscription_clears_old_cancel_flag(self):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_old', 'PLN_agent_test',
                         days=-10, cancel_at_period_end=True)

        with patch('payments.paystack.disable_subscription', return_value=OK):
            self.webhook('subscription.create', self.new_subscription_event('SUB_new', 'PLN_agent_test'))

        self.assertFalse(self.subscription().cancel_at_period_end)


class PlanChargeReplayTests(LifecycleTestBase):
    # GET /payments/verify/ with an OLD charge reference must not change
    # the plan.

    def verify(self, data):
        self.client.force_authenticate(user=self.landlord)
        with patch('payments.paystack.verify_transaction',
                   return_value={'status': True, 'data': {**data, 'status': 'success'}}):
            return self.client.get('/payments/verify/?reference=old-ref')

    def test_replaying_old_lord_charge_after_downgrade_does_nothing(self):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_agent', 'PLN_agent_test',
                         last_plan_charge_at=timezone.now() - timedelta(days=2))

        self.verify(self.charge('PLN_lord_test', timezone.now() - timedelta(days=40)))

        self.assertEqual(self.subscription().tier, LandlordSubscription.Tier.AGENT)

    def test_same_charge_twice_is_a_no_op(self):
        paid_at = timezone.now()
        self.webhook('charge.success', self.charge('PLN_agent_test', paid_at))
        first = self.subscription().updated_at

        self.verify(self.charge('PLN_agent_test', paid_at))

        self.assertEqual(self.subscription().updated_at, first)

    def test_newer_charge_is_applied(self):
        self.active_plan(LandlordSubscription.Tier.AGENT, 'SUB_agent', 'PLN_agent_test',
                         last_plan_charge_at=timezone.now() - timedelta(days=40),
                         past_due_since=timezone.now() - timedelta(days=1))

        self.webhook('charge.success', self.charge('PLN_agent_test', timezone.now()))

        sub = self.subscription()
        self.assertIsNone(sub.past_due_since)
        self.assertGreater(sub.last_plan_charge_at, timezone.now() - timedelta(minutes=1))
