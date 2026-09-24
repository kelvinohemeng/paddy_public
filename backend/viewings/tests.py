from rest_framework.test import APITestCase
from rest_framework import status
from django.core import mail
# mail.outbox — Django's test runner automatically swaps EMAIL_BACKEND to
# an in-memory backend during tests, regardless of what's configured in
# settings.py (console, SMTP, whatever). Every email "sent" during a test
# just gets appended to this list instead of actually going anywhere —
# lets us verify emails were genuinely sent, and inspect their contents,
# without hitting a real inbox or even the console

from datetime import timedelta
from unittest.mock import patch

from anymail.exceptions import AnymailRequestsAPIError
from django.utils import timezone

from accounts.models import User, RenterProfile, LandlordProfile, StaffProfile
from listings.models import Listing
from .models import Viewing


def future_scheduled_at():
    # Relative to "now" rather than a hardcoded date — scheduled_at must
    # be in the future (ViewingSerializer.validate_scheduled_at), so a
    # fixed date would make these tests start failing once it passes
    return (timezone.now() + timedelta(days=7)).isoformat()


class ViewingCreateTests(APITestCase):

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='renter@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Test Renter'
        )

        self.landlord_user = User.objects.create_user(
            email='landlord@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Test Landlord',
            national_id_number='GHA-1', preferred_payout_method='momo'
        )

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Nice 2 bedroom', description='Test',
            listing_type='rent', price_monthly='2500.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='123 Test St', neighborhood='East Legon',
            city='Accra', status=Listing.Status.PUBLISHED,
        )
        # Must be PUBLISHED — a renter can only book a viewing for a
        # listing they can actually see in the first place

    def test_renter_can_request_viewing(self):
        self.client.force_authenticate(user=self.renter_user)

        data = {
            'listing': self.listing.id,
            'scheduled_at': future_scheduled_at(),
        }

        response = self.client.post('/viewings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        viewing = Viewing.objects.get(listing=self.listing)
        self.assertEqual(viewing.renter_profile, self.renter_profile)
        # Confirms renter_profile was set correctly from request.user,
        # not something the client could have faked

        self.assertEqual(viewing.status, Viewing.Status.REQUESTED)
        # Confirms the model default actually applies — every new
        # viewing starts life as REQUESTED, nothing else

        self.assertIsNone(viewing.staff_profile)
        # Confirms no staff is assigned yet at creation time

    def test_landlord_cannot_request_viewing(self):
        # Only renters may create viewing requests — a landlord trying
        # to hit this same endpoint should be blocked

        self.client.force_authenticate(user=self.landlord_user)

        data = {
            'listing': self.listing.id,
            'scheduled_at': future_scheduled_at(),
        }

        response = self.client.post('/viewings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Viewing.objects.filter(listing=self.listing).exists())
        # Confirms NOTHING got created, not just that the response
        # looked like a rejection

    def test_cannot_set_staff_or_status_on_create(self):
        # The same "does the read_only actually hold" worry we tested
        # for Listing.status — proving a malicious/buggy client can't
        # sneak extra fields in

        self.client.force_authenticate(user=self.renter_user)

        staff_user = User.objects.create_user(
            email='staff1@example.com', password='pass123456', role='staff'
        )
        staff_profile = StaffProfile.objects.create(user=staff_user, full_name='Staff One')

        data = {
            'listing': self.listing.id,
            'scheduled_at': future_scheduled_at(),
            'staff_profile': staff_profile.id,
            'status': 'completed',
            # Attempting to sneak these in, even though the serializer
            # marks them read_only
        }

        response = self.client.post('/viewings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # The request still succeeds overall...

        viewing = Viewing.objects.get(listing=self.listing)
        self.assertIsNone(viewing.staff_profile)
        self.assertEqual(viewing.status, Viewing.Status.REQUESTED)
        # ...but both fields stayed at their real defaults, proving
        # read_only_fields genuinely blocks client input rather than
        # trusting it

    def test_requesting_viewing_sends_confirmation_email_with_ics(self):
        # THE real-world check for the feature we just built — not just
        # "did the API return 201", but "did the actual email genuinely
        # get sent, to the right person, with a working calendar file"

        self.client.force_authenticate(user=self.renter_user)

        data = {
            'listing': self.listing.id,
            'scheduled_at': future_scheduled_at(),
        }

        with self.captureOnCommitCallbacks(execute=True):
            # The email is sent via transaction.on_commit — TestCase wraps
            # each test in a transaction that never commits, so the
            # callbacks have to be captured and run explicitly
            response = self.client.post('/viewings/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.assertEqual(len(mail.outbox), 1)
        # Confirms EXACTLY one email was sent during this request —
        # not zero (silently failed), not two (accidentally duplicated)

        sent_email = mail.outbox[0]

        self.assertEqual(sent_email.to, ['renter@example.com'])
        # Confirms it went to the RIGHT person — the renter who
        # actually requested the viewing, not hardcoded or wrong

        self.assertIn('Nice 2 bedroom', sent_email.body)
        # Confirms the email body genuinely mentions the real listing,
        # not a placeholder

        self.assertEqual(len(sent_email.attachments), 1)
        # Confirms the .ics file genuinely got attached — not silently
        # dropped

        filename, content, mimetype = sent_email.attachments[0]
        self.assertEqual(filename, 'viewing.ics')
        self.assertEqual(mimetype, 'text/calendar')
        # This exact mimetype is what makes email clients render the
        # "Add to Calendar" button — worth locking in specifically,
        # not just "some attachment exists"

        self.assertIn('BEGIN:VCALENDAR', content)
        self.assertIn('BEGIN:VEVENT', content)
        self.assertIn('SUMMARY:Property Viewing - Nice 2 bedroom', content)
        # Confirms the actual .ics TEXT is genuinely well-formed and
        # contains the real listing title, not just "an attachment
        # exists with the right name" — this is the part that would
        # silently break if build_ics_content had a typo in the format


    def test_email_failure_still_returns_201_with_one_viewing(self):
        # A Resend outage must not turn a successful booking into a 500 —
        # otherwise the renter retries and creates duplicate viewings

        self.client.force_authenticate(user=self.renter_user)

        data = {
            'listing': self.listing.id,
            'scheduled_at': future_scheduled_at(),
        }

        with patch(
            'viewings.views.send_viewing_confirmation_email',
            side_effect=AnymailRequestsAPIError('Resend unreachable'),
        ) as mock_send:
            with self.assertLogs('viewings.views', level='ERROR'):
                with self.captureOnCommitCallbacks(execute=True):
                    response = self.client.post('/viewings/', data, format='json')

        mock_send.assert_called_once()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Viewing.objects.filter(listing=self.listing).count(), 1)
        self.assertEqual(response.data['id'], Viewing.objects.get(listing=self.listing).id)

    def test_past_scheduled_at_is_rejected(self):
        self.client.force_authenticate(user=self.renter_user)

        data = {
            'listing': self.listing.id,
            'scheduled_at': (timezone.now() - timedelta(days=1)).isoformat(),
        }

        response = self.client.post('/viewings/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('scheduled_at', response.data)
        self.assertFalse(Viewing.objects.exists())

class ViewingVisibilityTests(APITestCase):
    # Covers the three-way get_queryset split — staff/landlord/renter
    # each seeing a different, deliberately scoped slice of viewings

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='renter2@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Renter Two'
        )

        self.other_renter_user = User.objects.create_user(
            email='renter3@example.com', password='pass123456', role='renter'
        )
        self.other_renter_profile = RenterProfile.objects.create(
            user=self.other_renter_user, full_name='Renter Three'
        )
        # A SECOND renter, used to prove renters can't see each other's
        # viewings

        self.landlord_user = User.objects.create_user(
            email='landlord2@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Landlord Two',
            national_id_number='GHA-2', preferred_payout_method='momo'
        )

        self.other_landlord_user = User.objects.create_user(
            email='landlord3@example.com', password='pass123456', role='landlord'
        )
        self.other_landlord_profile = LandlordProfile.objects.create(
            user=self.other_landlord_user, full_name='Landlord Three',
            national_id_number='GHA-3', preferred_payout_method='momo'
        )
        # A SECOND landlord, used to prove landlords only see viewings
        # on THEIR OWN listings, not everyone else's

        self.staff_user = User.objects.create_user(
            email='staff2@example.com', password='pass123456', role='staff'
        )
        self.staff_profile = StaffProfile.objects.create(user=self.staff_user, full_name='Staff Two')

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Landlord Two listing', description='Test',
            listing_type='rent', price_monthly='2000.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='1 Test St', neighborhood='Osu',
            city='Accra', status=Listing.Status.PUBLISHED,
        )

        self.viewing = Viewing.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            scheduled_at='2026-10-01T14:00:00Z',
        )
        # A single real viewing: renter_user booked it, on landlord_user's
        # listing. Everyone else in setUp should NOT be able to see it,
        # except staff

    def test_renter_sees_own_viewing(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.get('/viewings/')

        ids = [item['id'] for item in response.data]
        self.assertIn(self.viewing.id, ids)

    def test_other_renter_cannot_see_viewing(self):
        self.client.force_authenticate(user=self.other_renter_user)

        response = self.client.get('/viewings/')

        ids = [item['id'] for item in response.data]
        self.assertNotIn(self.viewing.id, ids)
        # A different renter, who never booked this viewing, must not
        # see it at all in their own list

    def test_owning_landlord_sees_viewing_on_their_listing(self):
        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.get('/viewings/')

        ids = [item['id'] for item in response.data]
        self.assertIn(self.viewing.id, ids)
        # Confirms the double-hop listing__landlord_profile__user lookup
        # actually works — the landlord didn't create this viewing, but
        # it's on THEIR listing, so they should see it

    def test_other_landlord_cannot_see_viewing(self):
        self.client.force_authenticate(user=self.other_landlord_user)

        response = self.client.get('/viewings/')

        ids = [item['id'] for item in response.data]
        self.assertNotIn(self.viewing.id, ids)
        # A landlord with no relationship to this listing at all must
        # not see it

    def test_staff_sees_all_viewings(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.get('/viewings/')

        ids = [item['id'] for item in response.data]
        self.assertIn(self.viewing.id, ids)
        # Confirms staff visibility is genuinely unrestricted, matching
        # the deliberate decision made earlier


class ViewingActionTests(APITestCase):
    # Covers the three custom @actions: assign-staff, complete, cancel —
    # and their permission boundaries specifically

    def setUp(self):
        self.renter_user = User.objects.create_user(
            email='renter4@example.com', password='pass123456', role='renter'
        )
        self.renter_profile = RenterProfile.objects.create(
            user=self.renter_user, full_name='Renter Four'
        )

        self.other_renter_user = User.objects.create_user(
            email='renter5@example.com', password='pass123456', role='renter'
        )
        self.other_renter_profile = RenterProfile.objects.create(
            user=self.other_renter_user, full_name='Renter Five'
        )

        self.landlord_user = User.objects.create_user(
            email='landlord4@example.com', password='pass123456', role='landlord'
        )
        self.landlord_profile = LandlordProfile.objects.create(
            user=self.landlord_user, full_name='Landlord Four',
            national_id_number='GHA-4', preferred_payout_method='momo'
        )

        self.staff_user = User.objects.create_user(
            email='staff3@example.com', password='pass123456', role='staff'
        )
        self.staff_profile = StaffProfile.objects.create(user=self.staff_user, full_name='Staff Three')

        self.listing = Listing.objects.create(
            landlord_profile=self.landlord_profile,
            title='Action test listing', description='Test',
            listing_type='rent', price_monthly='2000.00',
            advance_rent_period='1_year', bedrooms=2, bathrooms=1,
            address_precise='1 Test St', neighborhood='Osu',
            city='Accra', status=Listing.Status.PUBLISHED,
        )

        self.viewing = Viewing.objects.create(
            listing=self.listing, renter_profile=self.renter_profile,
            scheduled_at='2026-10-01T14:00:00Z',
        )

    def test_staff_can_assign_self_to_viewing(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/assign-staff/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.staff_profile, self.staff_profile)
        self.assertEqual(self.viewing.status, Viewing.Status.SCHEDULED)
        # Confirms BOTH side effects of the action happened together —
        # the assignment AND the status transition

    def test_renter_cannot_assign_staff(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/assign-staff/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.viewing.refresh_from_db()
        self.assertIsNone(self.viewing.staff_profile)
        self.assertEqual(self.viewing.status, Viewing.Status.REQUESTED)
        # Confirms nothing changed at all, not just that the request
        # was rejected

    def test_staff_can_complete_viewing(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/complete/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.COMPLETED)

    def test_renter_cannot_complete_viewing(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/complete/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.REQUESTED)

    def test_renter_can_cancel_own_viewing(self):
        self.client.force_authenticate(user=self.renter_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/cancel/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.CANCELLED_NO_SHOW)

    def test_renter_cannot_cancel_someone_elses_viewing(self):
        # A DIFFERENT renter, who never booked this viewing, tries to
        # cancel it — must be blocked even though they're a renter

        self.client.force_authenticate(user=self.other_renter_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/cancel/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        # 404, not 403 — this viewing isn't even in the other renter's
        # get_queryset() at all (same not-403 reasoning as Listing),
        # since renters only ever see their OWN viewings in the first
        # place, they can never even REACH this URL for someone else's

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.REQUESTED)

    def test_staff_can_cancel_any_viewing(self):
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/cancel/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.CANCELLED_NO_SHOW)

    def test_landlord_cannot_cancel_viewing_on_own_listing(self):
        # An important, easy-to-get-wrong edge case: the landlord CAN
        # see this viewing (it's on their listing), but seeing it is
        # not the same as being allowed to act on it — only the
        # renter who booked it, or staff, may cancel

        self.client.force_authenticate(user=self.landlord_user)

        response = self.client.post(f'/viewings/{self.viewing.id}/cancel/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        # 403, not 404 here — unlike the other-renter case above, the
        # landlord's get_queryset() DOES include this viewing (they can
        # see it), so get_object() succeeds; it's the explicit
        # is_own_viewing/is_staff check inside cancel() that then
        # correctly blocks the action itself

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.REQUESTED)

    def test_cannot_use_generic_patch_to_change_status(self):
        # Confirms http_method_names genuinely blocks PATCH at the
        # router level — status changes must go through the dedicated
        # actions above, never a free-form update

        self.client.force_authenticate(user=self.staff_user)

        response = self.client.patch(
            f'/viewings/{self.viewing.id}/', {'status': 'completed'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

        self.viewing.refresh_from_db()
        self.assertEqual(self.viewing.status, Viewing.Status.REQUESTED)

    def test_cannot_delete_viewing(self):
        # Confirms DELETE is blocked entirely, matching the deliberate
        # decision that cancellation is a status change, not a deletion

        self.client.force_authenticate(user=self.staff_user)

        response = self.client.delete(f'/viewings/{self.viewing.id}/')

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Viewing.objects.filter(id=self.viewing.id).exists())
