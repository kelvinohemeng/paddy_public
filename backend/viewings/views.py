from rest_framework import viewsets, status
# Same imports as ListingViewSet — viewsets for ModelViewSet, status for
# readable HTTP status codes

from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from rest_framework.throttling import ScopedRateThrottle

from datetime import timedelta
# timedelta — Python's standard library tool for date/time MATH (adding
# or subtracting a span of time from a datetime). Nothing Django-specific
# about it, plain Python

from django.core.mail import EmailMessage
# EmailMessage — a DIFFERENT tool from send_mail (which accounts/views.py
# uses for the verification email). send_mail is a simple shortcut that
# can ONLY send subject+body+recipients — it has no way to attach a file.
# EmailMessage is the fuller-featured class underneath that send_mail
# itself uses internally — building it directly gives us access to
# .attach(), which is the one thing we actually need here

from .models import Viewing
from .serializers import ViewingSerializer
from accounts.models import User


def build_ics_content(viewing):
    # A plain helper function (no @action, not a URL endpoint itself) —
    # same "reusable logic called FROM a view" role as
    # send_verification_email in accounts/views.py. Its only job: turn one
    # Viewing object into a valid .ics text string

    start = viewing.scheduled_at.strftime('%Y%m%dT%H%M%SZ')
    # .strftime(...) formats a Python datetime into a specific TEXT layout.
    # The iCalendar spec requires EXACTLY this shape for a UTC timestamp:
    # YYYYMMDD, then a literal "T", then HHMMSS, then a literal "Z"
    # (Z = "Zulu time", the standard aviation/computing term for UTC).
    # No dashes, no colons, no spaces — calendar apps parse this literally,
    # so the format has to match exactly or the file is invalid

    end_time = viewing.scheduled_at + timedelta(minutes=45)
    # The model doesn't store a duration, so we're assuming a reasonable
    # fixed length for every viewing. timedelta is Python's standard way
    # to do date/time MATH — "45 minutes after this moment" — same idea
    # as adding to a plain number, just for time values

    end = end_time.strftime('%Y%m%dT%H%M%SZ')

    return (
        "BEGIN:VCALENDAR\n"
        "VERSION:2.0\n"
        "BEGIN:VEVENT\n"
        f"UID:viewing-{viewing.id}@paddy.com\n"
        # UID must be unique per event — using the Viewing's own database
        # id guarantees that automatically, no extra bookkeeping needed
        f"DTSTART:{start}\n"
        f"DTEND:{end}\n"
        f"SUMMARY:Property Viewing - {viewing.listing.title}\n"
        f"DESCRIPTION:Your scheduled viewing with paddy staff\n"
        f"LOCATION:{viewing.listing.address_precise}, {viewing.listing.city}\n"
        "END:VEVENT\n"
        "END:VCALENDAR\n"
    )
    # This whole thing is just a Python string being built with f-strings —
    # nothing here is Django/DRF-specific. The ONLY thing that matters is
    # that the final text follows the iCalendar layout exactly


def send_viewing_confirmation_email(viewing):
    # Another plain helper — builds and sends the actual email, called
    # right after a Viewing is successfully created

    ics_content = build_ics_content(viewing)

    email = EmailMessage(
        subject='Your paddy viewing is confirmed',
        body=(
            f"Your viewing for {viewing.listing.title} is scheduled for "
            f"{viewing.scheduled_at}. Attached is a calendar file you can "
            f"use to add this to your calendar."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        # Was hardcoded as 'noreply@paddy.com' — same real bug as the
        # one caught in accounts/views.py send_verification_email:
        # paddy.com is a domain no one owns or has verified with Resend,
        # so any real viewing-confirmation email would fail with a 403
        # "domain not verified" error. Reusing settings.DEFAULT_FROM_EMAIL
        # keeps this in sync with the one real, Resend-verified domain
        to=[viewing.renter_profile.user.email],
        # to= expects a LIST, even for one recipient — same reason
        # request.FILES.getlist() returns a list, this is just how
        # Django/email libraries model "could be more than one" fields
    )

    email.attach('viewing.ics', ics_content, 'text/calendar')
    # .attach(filename, content, mimetype) — this is the one method
    # send_mail simply doesn't have. filename = what the recipient's email
    # client shows/saves it as; mimetype='text/calendar' is the specific
    # label that tells Gmail/Outlook/Apple Mail "this attachment is a
    # calendar event, render an Add to Calendar button for it" — this
    # exact string is what makes the automatic button appear, not
    # anything we build ourselves

    email.send()
    # Nothing is actually sent until this line runs — same lazy-until-
    # triggered pattern you've seen elsewhere (querysets, serializer.save)


class ViewingViewSet(viewsets.ModelViewSet):
    # Same base class as ListingViewSet — gives us list/retrieve/create for
    # free, we're deliberately NOT using its built-in update/destroy though
    # (see http_method_names below)

    queryset = Viewing.objects.all()
    serializer_class = ViewingSerializer
    permission_classes = [IsAuthenticated]

    http_method_names = ['get', 'post', 'head', 'options']
    # By default ModelViewSet also wires up PUT/PATCH/DELETE. Since we
    # deliberately don't want generic updates or deletes on a Viewing
    # (status changes should only happen through the specific @actions
    # below, never a free-form PATCH), we restrict the ViewSet at the
    # router level to just these four. Any PUT/PATCH/DELETE request to
    # /viewings/<id>/ will now get a clean 405 Method Not Allowed,
    # automatically, without us writing that check ourselves

    def get_throttles(self):
        # Unlike a plain @api_view function (which just gets ONE fixed
        # throttle_scope for its entire body), a ViewSet handles MANY
        # different actions (list, retrieve, create, plus our custom
        # @actions) behind one class — so DRF calls this method fresh
        # on every single request, letting us choose different
        # throttling PER ACTION rather than one blanket rule for
        # everything the class does

        if self.action == 'create':
            # self.action — DRF automatically sets this to a string
            # naming whichever method is actually handling this request
            # ('list', 'retrieve', 'create', 'assign_staff', etc.)

            self.throttle_scope = 'viewing_request'
            # Only booking a NEW viewing gets the strict 10/min limit —
            # this is the actual abuse case worth guarding tightly
            return [ScopedRateThrottle()]

        return super().get_throttles()
        # Every other action (list, retrieve, assign-staff, complete,
        # cancel) falls back to the normal global throttle classes from
        # DEFAULT_THROTTLE_CLASSES in settings.py (anon/user rates) —
        # unchanged from before this method existed

    def get_queryset(self):
        user = self.request.user
        # Same three-way branching shape as ListingViewSet.get_queryset,
        # but the actual filters are different, since visibility here
        # depends on a DIFFERENT relationship for each role

        if user.role in (User.Role.STAFF, User.Role.ADMIN):
            return Viewing.objects.all()
            # Staff see every viewing in the system — matches what you
            # decided: no per-staff assignment restriction on visibility.
            # Admin (superuser) sees everything too, for the "all
            # activities" oversight console. Deliberately visibility
            # ONLY — the assign/complete/cancel role rules below are
            # untouched (their redesign is a separate brief now that
            # viewings are landlord-renter agreements with no staff
            # present).

        if user.role == User.Role.LANDLORD:
            return Viewing.objects.filter(listing__landlord_profile__user=user)
            # listing__landlord_profile__user — a DOUBLE-hop relationship
            # lookup, one level deeper than anything we've written before.
            # Reads right-to-left as: "the Viewing's listing's
            # landlord_profile's user must equal this user". Each __ hop
            # crosses exactly one ForeignKey/OneToOneField, in this case:
            # Viewing -> listing (FK) -> landlord_profile (FK) -> user (O2O)
            # Landlords see viewings booked on THEIR OWN listings, even
            # though they didn't create the viewing themselves

        return Viewing.objects.filter(renter_profile__user=user)
        # Default case (renter): only their own viewings,
        # renter_profile__user — same one-hop pattern as
        # landlord_profile__user in ListingViewSet

    def perform_create(self, serializer):
        # Called automatically during POST — same hook name/timing as
        # ListingViewSet.perform_create

        if self.request.user.role != User.Role.RENTER:
            raise PermissionDenied('Only renters can request viewings')
            # Only renters may CREATE a viewing request — staff/landlords
            # never book viewings themselves through this endpoint

        viewing = serializer.save(renter_profile=self.request.user.renterprofile)
        # renter_profile always comes from whoever's logged in, never from
        # the request body — same non-negotiable pattern as
        # landlord_profile on ListingSerializer.save()
        # We're now KEEPING the return value this time (unlike
        # ListingViewSet.perform_create, which just calls .save() and
        # discards it) — .save() always hands back the actual saved
        # instance, we just hadn't needed it until now. We need a real
        # Viewing object, with a real .id and .scheduled_at, to build the
        # confirmation email below

        send_viewing_confirmation_email(viewing)
        # Fire the confirmation email right after the viewing is
        # successfully saved — same call-site pattern as
        # send_verification_email(user) running right after
        # serializer.save() in accounts/views.py's register()

    @action(detail=True, methods=['post'], url_path='assign-staff')
    # @action = a custom endpoint beyond the standard 5, same tool we used
    # for upload_photos. detail=True -> one specific viewing, so the URL
    # becomes POST /viewings/<id>/assign-staff/

    def assign_staff(self, request, pk=None):
        viewing = self.get_object()
        # Already respects get_queryset() — a landlord/renter trying to
        # hit this URL for a viewing outside their own visibility gets a
        # 404, same not-403 reasoning as before

        if request.user.role != User.Role.STAFF:
            raise PermissionDenied('Only staff can assign themselves to a viewing')

        viewing.staff_profile = request.user.staffprofile
        # Directly setting the field on the Python object — different
        # from going through the serializer, since staff_profile is
        # deliberately read_only there. This is exactly WHY it's
        # read_only on the serializer: the only place it should ever be
        # set is here, through this specific, controlled action

        viewing.status = Viewing.Status.SCHEDULED
        viewing.save()
        # Both changes only actually hit the database once .save() runs —
        # same lazy-until-saved behavior you've seen with querysets, just
        # for a single object update this time

        return Response(ViewingSerializer(viewing).data)

    @action(detail=True, methods=['post'])
    # No url_path given this time — DRF defaults to using the method
    # name itself as the URL segment, so this becomes
    # POST /viewings/<id>/complete/

    def complete(self, request, pk=None):
        viewing = self.get_object()

        if request.user.role != User.Role.STAFF:
            raise PermissionDenied('Only staff can mark a viewing as completed')

        viewing.status = Viewing.Status.COMPLETED
        viewing.save()

        return Response(ViewingSerializer(viewing).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        viewing = self.get_object()

        is_own_viewing = (
            request.user.role == User.Role.RENTER
            and viewing.renter_profile.user == request.user
        )
        # A renter may cancel ONLY their own viewing — checking both the
        # role AND the actual ownership match, not just one or the other

        is_staff = request.user.role == User.Role.STAFF

        if not (is_own_viewing or is_staff):
            raise PermissionDenied('You can only cancel your own viewing')
            # Anyone else — e.g. a different renter, or a landlord — is
            # blocked, even if they could somehow reach this URL

        viewing.status = Viewing.Status.CANCELLED_NO_SHOW
        viewing.save()

        return Response(ViewingSerializer(viewing).data)
