from rest_framework import viewsets, status
# viewsets = a different module from what we've used before — provides
# the higher-level class-based building blocks, including ModelViewSet

from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.request import Request
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from django.db import transaction
# transaction.atomic — used by the photo-cover management below (and only
# there) to make "clear siblings + set this cover" a single all-or-nothing
# write. Without it, two near-simultaneous set-cover requests could each
# clear-then-set in an interleaved order and leave two covers behind.

from .models import Listing, ListingPhoto, SavedListing
from accounts.models import User, StaffProfile
from accounts.permissions import require_verified_email
# User — for the Role enum in the review action + admin-visibility
# branches below. Safe as a top-level import: accounts/models.py
# depends only on core (Amenity), never back on listings, so no
# circular-import loop (unlike payments, which IS imported lazily
# inside methods for exactly that reason).
# StaffProfile — to stamp verified_by_staff on review. Fetched via
# .filter().first(), never request.user.staffprofile directly: an
# admin reviewer (and a profile-less staff user) HAS no StaffProfile
# row, and the direct reverse-OneToOne would raise
# RelatedObjectDoesNotExist → 500 instead of recording the review.
from core.models import Amenity
from .serializers import ListingSerializer, ListingPhotoSerializer, SavedListingSerializer
from .location_privacy import snap_bbox


class ListingViewSet(viewsets.ModelViewSet):
    # Inheriting from ModelViewSet — same inheritance pattern as
    # AbstractUser, just a different base class providing different
    # pre-built behavior (all 5 CRUD operations, instead of auth basics)

    queryset = Listing.objects.all()
    # Tells the ViewSet WHERE to pull data from for list/retrieve/update/
    # delete — "start from every Listing row" (we'll narrow this down
    # below for non-staff users)

    serializer_class = ListingSerializer
    # Tells the ViewSet WHICH serializer to validate/format data with —
    # same ListingSerializer we already wrote, reused as-is

    permission_classes = [IsAuthenticated]
    # Default fallback for any action not explicitly listed in
    # get_permissions() below (e.g. custom @action endpoints like
    # upload_photos still require login by default). The list/retrieve
    # override below is what actually opens browsing up to anonymous
    # visitors — this line alone does NOT unblock them.

    def get_permissions(self):
        # Per-action permissions — list/retrieve (browsing the
        # marketplace and viewing one listing) are opened to everyone,
        # matching the actual product decision: browsing is free,
        # precise address + landlord contact stay gated behind
        # pay-to-unlock (ListingSerializer._has_access already returns
        # False for anonymous requests, so nothing sensitive leaks —
        # this change only affects WHO can reach the endpoint at all,
        # not what a given caller sees once they're in it).
        # Every other action (create/update/destroy/photos) keeps
        # requiring login, via the class-level permission_classes above.
        if self.action in ('list', 'retrieve'):
            return [AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        user = self.request.user
        # Overriding this method lets us customize WHICH listings show
        # up, depending on who's asking — this is where "only show
        # published listings to the public" logic goes

        if user.is_authenticated and user.role in (user.Role.STAFF, user.Role.ADMIN):
            queryset = Listing.objects.all()
            # Staff can see everything — the review console's whole job
            # is triaging drafts/pending listings, which no other base
            # includes. Admin (superuser) sees everything too, for the
            # "all activities on the platform" oversight console. Both
            # roles share this branch deliberately: review scope and
            # oversight scope coincide on listings (unlike viewings/
            # leases, where staff visibility is intentionally left alone
            # for the separate viewing-redesign brief).
        elif user.is_authenticated and user.role == user.Role.LANDLORD:
            queryset = Listing.objects.filter(landlord_profile__user=user) | Listing.objects.filter(status=Listing.Status.PUBLISHED)
            # A landlord sees: their OWN listings (any status) OR published
            # listings from anyone (browsing the marketplace like anyone else)
            # landlord_profile__user — the double-underscore lets you filter
            # across a relationship, in one line, without manually
            # traversing it yourself. Reads as "filter by the user field,
            # on the related landlord_profile"
        elif user.is_authenticated and user.role == user.Role.RENTER:
            queryset = (
                Listing.objects.filter(status=Listing.Status.PUBLISHED)
                | Listing.objects.filter(
                    status=Listing.Status.LEASED,
                    leases__renter_profile__user=user,
                )
            ).distinct()
            # A renter sees: published listings (normal browsing) OR
            # their OWN leased listing(s) — a unit that dropped out of
            # public discovery the moment its Lease was created (see
            # LeaseViewSet.perform_create) but must stay reachable for
            # the renter who actually lives there (lease document
            # review, dashboard card, etc.). leases__renter_profile__user
            # crosses the reverse FK from Lease (related_name='leases')
            # — no import of the leases app needed here, same "filter
            # across the relationship" style as landlord_profile__user
            # elsewhere in this method. .distinct() guards against a
            # renter with more than one Lease row on the same listing
            # (e.g. a renewed/re-signed lease) surfacing duplicate rows.
        else:
            queryset = Listing.objects.filter(status=Listing.Status.PUBLISHED)
            # Everyone else (anonymous visitors, landlords browsing)
            # only sees published listings — draft/pending/rejected/
            # leased ones stay hidden. user.is_authenticated is checked
            # FIRST in both branches above — AnonymousUser (the
            # request.user value on a logged-out request now that
            # list/retrieve allow it) has no .role attribute at all, so
            # touching user.role before confirming authentication would
            # throw an AttributeError instead of just falling through
            # to this public-listings-only branch.
        # Stored in a variable now instead of returned immediately —
        # we need to keep narrowing it below before the final return

        if self.request.query_params.get('mine') == 'true' and user.is_authenticated:
            queryset = Listing.objects.filter(landlord_profile__user=user)
            # ?mine=true — the landlord dashboard's "my listings" list
            # (and the subscription-cap count behind it) needs ONLY the
            # requesting user's own rows, any status, instead of the
            # default own-UNION-published mix above. Overriding the base
            # here — rather than adding another .filter() on top — is
            # deliberate: for a landlord the default base already
            # includes everyone else's published listings, and no
            # additional filter could remove those without also
            # restructuring the UNION itself.
            #
            # Three traps this shape deliberately avoids:
            # - Staff + mine=true returns their OWN (usually empty), NOT
            #   "all listings" — falling back to all would make the
            #   dashboard count meaningless for any staff-owned row.
            # - Renter + mine=true is simply empty (renters own no
            #   listings) — still scoped by the same filter, not a
            #   special-cased .none(), so a future role that CAN own
            #   listings composes without a new branch here.
            # - Anonymous + mine=true is deliberately NOT handled here:
            #   user.is_authenticated is False, so this block is skipped
            #   and the public published-only base stands unchanged.
            #   Filtering by landlord_profile__user=AnonymousUser would
            #   return empty (breaking the public Discovery Hub's
            #   anonymous fetch), and touching user.role would throw
            #   AttributeError — same AnonymousUser-has-no-role trap the
            #   base branches above already guard against.
            # .filter(landlord_profile__user=user) — never touching
            # user.landlordprofile directly — a renter/staff user HAS no
            # LandlordProfile row, and touching the reverse OneToOne
            # would raise RelatedObjectDoesNotExist instead of just
            # returning empty. Filtering across the FK is safe for every
            # role, which is exactly why this one line needs no
            # role branching at all.
            #
            # Placed BEFORE every optional filter below so mine composes
            # with all of them via normal chaining (city/max_price/
            # bbox/etc. just keep narrowing this own-only base).

        city = self.request.query_params.get('city')
        # self.request.query_params — DRF's parsed version of the URL's
        # query string (?city=Accra&...). .get('city') returns None if
        # 'city' wasn't provided at all, which is exactly what we want
        # (optional filter)

        if city:
            queryset = queryset.filter(city__iexact=city)
            # city__iexact — __iexact = "exactly equal to,
            # case-insensitive" — so ?city=accra and ?city=Accra both
            # match "Accra" in the database

        min_price = self.request.query_params.get('min_price')
        if min_price:
            queryset = queryset.filter(price_monthly__gte=min_price)
            # __gte = "greater than or equal to"

        max_price = self.request.query_params.get('max_price')
        if max_price:
            queryset = queryset.filter(price_monthly__lte=max_price)
            # __lte = "less than or equal to"

        bedrooms = self.request.query_params.get('bedrooms')
        if bedrooms:
            queryset = queryset.filter(bedrooms=bedrooms)
            # Plain equality here — no __ suffix needed for exact match

        advance_rent_period = self.request.query_params.get('advance_rent_period')
        if advance_rent_period:
            queryset = queryset.filter(advance_rent_period=advance_rent_period)

        amenities = self.request.query_params.getlist('amenities')
        # .getlist(...) instead of .get(...) — this is the key difference from
        # every other filter here. A URL like ?amenities=wifi&amenities=parking
        # can carry MULTIPLE values under the same query param name; .get()
        # would only ever hand you back the first one, .getlist() hands back
        # all of them as a real Python list, e.g. ['wifi', 'parking']

        if amenities:
            queryset = queryset.filter(amenities__slug__in=amenities).distinct()
            # amenities__slug__in=[...] — reads as "keep listings where at
            # least one of their linked Amenity rows has a slug matching
            # something in this list". __in is the same lookup style as
            # __gte/__iexact you've already used elsewhere, just checking
            # membership in a list instead of a single value comparison.
            #
            # .distinct() is NEW and matters here specifically: filtering
            # across a many-to-many relationship can return the SAME listing
            # multiple times in the raw query — once per matching amenity it
            # has (e.g. a listing with both "wifi" AND "parking" would appear
            # twice if you filtered on both without .distinct()). None of your
            # other filters above need this, since none of them cross a M2M
            # relationship — this is the first one that does.


        north = self.request.query_params.get('north')
        south = self.request.query_params.get('south')
        east = self.request.query_params.get('east')
        west = self.request.query_params.get('west')
        # The four corners of whatever rectangle the frontend's map is
        # currently showing. Same .get(...) pattern as every filter
        # above — each one is None if not provided

        if north and south and east and west:
            # ALL FOUR must be present together — a bounding box only
            # makes sense as a complete rectangle, there's no valid
            # meaning to "just north, nothing else". Using `and` here
            # means this whole block is skipped entirely unless the
            # frontend sends a genuinely complete box

            bbox = snap_bbox(float(west), float(south), float(east), float(north))
            # snap_bbox takes (west, south, east, north) in THAT exact
            # order — (min_x, min_y, max_x, max_y) in longitude/latitude
            # terms, same as Polygon.from_bbox, which it wraps. float(...)
            # is required because query_params always arrive as plain
            # TEXT strings (like every other query param we've read so
            # far) — Polygon needs actual numbers, not the string "5.65".
            #
            # snap_bbox (not a raw Polygon.from_bbox) widens the box out
            # to the same ~550m grid locked listings' pins are snapped
            # to. Without that, shrinking the box around a locked
            # listing until it drops out of the results would reveal its
            # exact location — see location_privacy.py.

            queryset = queryset.filter(location__within=bbox)
            # location__within — the geospatial lookup this whole feature
            # was building toward. Reads as "keep only listings whose
            # location point falls inside this rectangle". Listings with
            # location=None (still allowed, since the field is nullable)
            # are automatically excluded here too — a null point can
            # never be "within" any shape, so this naturally handles
            # listings that haven't been geocoded yet without needing a
            # separate check

        return queryset
        # Only NOW do we actually return — after every optional filter
        # has had a chance to narrow things down further

    def perform_create(self, serializer):
        # Called automatically by ModelViewSet during its built-in
        # "create" flow (POST) — this REPLACES our old create_listing
        # function entirely, same underlying logic though

        if self.request.user.role != self.request.user.Role.LANDLORD:
            raise PermissionDenied('Only landlords can create listings')
            # Different mechanism than before (raising an exception
            # instead of manually returning a Response) — ModelViewSet
            # expects errors to be raised this way, and it automatically
            # converts this into the correct 403 response for us

        require_verified_email(self.request.user, 'create a listing')
        # See accounts/permissions.py. A listing ends up in front of the
        # public and in the staff review queue, so its owner's email must
        # be proven (it's also the contact renters get after unlocking).

        landlord_profile = self.request.user.landlordprofile

        existing_listing_count = Listing.objects.filter(landlord_profile=landlord_profile).count()
        # How many listings this landlord already has, REGARDLESS of
        # status (draft/published/etc.) — the free tier's cap counts
        # every listing they've ever created, not just published ones

        from payments.models import LandlordSubscription
        # Imported here, inside the method, rather than at the top of
        # the file — avoids a circular import risk (payments doesn't
        # import from listings, but keeping cross-app imports scoped to
        # where they're actually used is a common, safe habit once an
        # app graph gets more connected)

        subscription = LandlordSubscription.objects.filter(landlord_profile=landlord_profile).first()

        if subscription is not None and subscription.is_active():
            cap = subscription.listing_cap()
            # A genuinely active PAID subscription — use whatever cap
            # their tier grants (10 for agent, None/unlimited for lord)
        else:
            cap = LandlordSubscription.LISTING_CAPS[LandlordSubscription.Tier.FREE]
            # No subscription row at all, OR one that exists but isn't
            # currently active (lapsed/past due/never paid) — falls
            # back to the FREE tier's cap regardless of what tier value
            # happens to be stored on the row, since is_active() being
            # False means we can't trust that tier is currently paid for

        if cap is not None and existing_listing_count >= cap:
            raise PermissionDenied(
                f'You have reached your listing limit ({cap}). '
                'Please upgrade your subscription to publish more listings.'
            )

        serializer.save(landlord_profile=landlord_profile)
        # Exact same line as before — landlord_profile always comes from
        # whoever's logged in, never from the request body

    def perform_update(self, serializer):
        # Called automatically during "update" (PATCH/PUT) — this is
        # NEW, we hadn't written update logic by hand yet

        listing = self.get_object()
        # Fetches the specific listing being updated (ModelViewSet
        # already found it via the URL's <id>, this just retrieves it)

        if listing.landlord_profile.user != self.request.user:
            raise PermissionDenied("You can only edit your own listings")
            # THE actual "only the owner can edit this" check we've been
            # talking about conceptually since the permissions discussion
            # — now finally written, for real

        serializer.save()

    def perform_destroy(self, instance):
        # Called automatically during DELETE /listings/<id>/.
        #
        # KELVIN'S DECISION (2026-09): only ADMINS may permanently delete
        # a listing. Landlords archive instead (see archive() below).
        #
        # Why this matters: deleting a database row also deletes every
        # row that points at it with on_delete=CASCADE. For a Listing
        # that includes ListingUnlock (proof that a renter PAID to unlock
        # it), Lease + LeaseRecord (tenancy history), Viewing and
        # SavedListing rows. A landlord deleting a listing would silently
        # erase other people's payment records — the evidence support
        # needs when someone says "I paid and lost access". Archiving
        # just hides the listing and keeps all of that history.
        #
        # Admins keep hard delete for genuine clean-up (spam, test data,
        # legal takedowns), where erasing everything is the point.

        if self.request.user.role != User.Role.ADMIN:
            raise PermissionDenied({
                'detail': 'Listings can\'t be deleted. Archive it instead to take it off paddy.',
                'code': 'use_archive',
            })
            # `code` lets the frontend offer its Archive button instead of
            # just showing an error.

        instance.delete()

    ARCHIVABLE_STATUSES = (
        Listing.Status.DRAFT,
        Listing.Status.PENDING_REVIEW,
        Listing.Status.PUBLISHED,
        Listing.Status.REJECTED,
    )
    # Which statuses a listing may be archived FROM. Deliberately missing:
    # LEASED — someone lives there under an active Lease, and the listing
    # page is how that renter reaches their lease; end the lease first.
    # (And ARCHIVED itself, since that would be a no-op.)

    @action(detail=True, methods=['post'], url_path='archive')
    def archive(self, request, pk=None):
        # POST /listings/<id>/archive/ — the landlord-facing replacement
        # for delete. Sets status to ARCHIVED, which the public queryset
        # in get_queryset() already excludes (only PUBLISHED is public),
        # so the listing disappears from Discovery immediately while every
        # related record (unlocks, leases, viewings) stays intact.
        listing = self.get_object()
        # get_object() only finds listings inside get_queryset(), so a
        # landlord can't even reach someone else's draft — the explicit
        # owner check below then covers other landlords' PUBLISHED
        # listings, which are in the public part of the queryset.

        is_owner = listing.landlord_profile.user == request.user
        is_staff_or_admin = request.user.role in (User.Role.STAFF, User.Role.ADMIN)
        if not (is_owner or is_staff_or_admin):
            raise PermissionDenied('You can only archive your own listings')
        # Staff/admins can archive too — e.g. to pull a listing that turns
        # out to be misleading after a site visit, without destroying it.

        if listing.status not in self.ARCHIVABLE_STATUSES:
            return Response(
                {'error': f'A {listing.get_status_display().lower()} listing can\'t be archived.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
            # get_status_display() — Django gives every field with
            # `choices` this helper, returning the human label ("Leased")
            # instead of the stored value ("leased").

        listing.status = Listing.Status.ARCHIVED
        listing.save(update_fields=['status'])
        # update_fields — only write the `status` column, not the whole
        # row. Safer when other requests might be editing different
        # fields of the same listing at the same moment.

        return Response(self.get_serializer(listing).data)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        # POST /listings/<id>/restore/ — undo an archive. The listing goes
        # back to DRAFT, NOT straight to published: it may have sat
        # archived for months (price, photos, availability all stale), so
        # it has to go through submit-for-review and staff verification
        # again before the public can see it — the "every listing is
        # staff-verified" promise applies every time it goes live.
        listing = self.get_object()

        if listing.landlord_profile.user != request.user and request.user.role not in (
            User.Role.STAFF, User.Role.ADMIN
        ):
            raise PermissionDenied('You can only restore your own listings')

        if listing.status != Listing.Status.ARCHIVED:
            return Response(
                {'error': 'Only archived listings can be restored.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        listing.status = Listing.Status.DRAFT
        listing.save(update_fields=['status'])
        return Response(self.get_serializer(listing).data)

    @action(detail=True, methods=['post'], url_path='submit-for-review')
    # @action = same tool as upload_photos below — detail=True means one
    # specific listing, so the URL becomes
    # POST /listings/<id>/submit-for-review/. This is the ONLY
    # landlord-driven status transition in the whole API: draft (or a
    # rejected listing, fixed and resubmitted) → pending_review.
    # Publishing/rejecting/archiving deliberately have NO endpoint here
    # at all — those stay staff-only in Django admin, per the brand's
    # staff-verification promise. A free-form PATCH on status is blocked
    # separately (status is read_only on the serializer), so this action
    # is the single, auditable gate landlords pass through.

    def submit_for_review(self, request, pk=None):
        listing = self.get_object()
        # self.get_object() ALREADY respects get_queryset() — but for a
        # landlord that queryset is own-listings UNION all-published, so
        # it SUCCEEDS on another landlord's published listing (same trap
        # upload_photos guards against). The explicit ownership check
        # below is therefore mandatory, not redundant — without it,
        # anyone authenticated could push someone else's published
        # listing back into pending_review.

        if listing.landlord_profile.user != request.user:
            raise PermissionDenied("You can only submit your own listings for review")
            # Same 403-explicit convention as perform_update/
            # perform_destroy/upload_photos — deliberately a 403
            # (PermissionDenied), NOT a 404, once the row is actually
            # visible: the caller found something real and is being told
            # "not yours", rather than "doesn't exist". Runs BEFORE the
            # status check below so a cross-owner attempt on a published
            # listing reports 403 (wrong owner), not a misleading 400
            # (wrong status).

        if listing.status not in (Listing.Status.DRAFT, Listing.Status.REJECTED):
            return Response(
                {'error': 'Only draft or rejected listings can be submitted for review'},
                status=status.HTTP_400_BAD_REQUEST,
            )
            # Allowed transitions ONLY: draft → pending_review (first
            # submission) and rejected → pending_review (resubmission
            # after fixing). Every other current status (pending_review
            # itself, published, archived) is a 400 — same
            # {'error': '...'} shape the rest of this codebase uses
            # (and the frontend unwraps), never a bare string or a
            # different key. Deliberately no minimum-content validation
            # here (photos required? address complete?) — model clean()
            # already enforces the price/listing_type XOR, and anything
            # more is a product decision for Kelvin first.

        listing.status = Listing.Status.PENDING_REVIEW
        listing.save(update_fields=['status'])
        # update_fields=['status'] — only this column is meant to change
        # here; scoping the write means a concurrent edit to some other
        # field (title, price) in the same moment can't be silently
        # clobbered by a full-row save carrying stale values.

        return Response(self.get_serializer(listing).data)
        # self.get_serializer (not a bare ListingSerializer(...)) —
        # the ViewSet's helper injects context={'request': ...}
        # automatically, which ListingSerializer._has_access NEEDS to
        # decide address/contact gating. A bare re-serialization without
        # context would fail closed and hand the owner back a LOCKED
        # view of their own listing right after submitting it; using
        # get_serializer lets the frontend update its cache from this
        # response with no refetch and no gating surprise.

    @action(detail=True, methods=['post'], url_path='review')
    # THE staff-side half of the verification workflow: submit-for-review
    # (above) moves draft/rejected → pending_review from the landlord
    # side; this moves pending_review → published/rejected from the
    # reviewer side. Together they are the complete lifecycle —
    # landlords can never publish themselves (status is read_only on
    # the serializer AND no landlord path sets published), reviewers
    # can never be bypassed. Resulting URL:
    # POST /listings/<id>/review/ with {"decision": "published"} or
    # {"decision": "rejected"}.

    def review_listing(self, request, pk=None):
        listing = self.get_object()
        # Already respects get_queryset() — a landlord/renter reaching
        # this URL for a row outside their visibility (e.g. someone
        # else's draft) 404s here before any role logic runs, same
        # not-403 convention as every other action in this file.

        if request.user.role not in (User.Role.STAFF, User.Role.ADMIN):
            raise PermissionDenied('Only staff or admins can review listings')
            # Runs FIRST, before decision/status validation: a landlord
            # hitting this on their OWN pending listing must hear "not
            # your action" (403), not a misleading "bad decision" (400).
            # No ownership exception — reviewers act on other people's
            # listings by definition, so the owner-check pattern used by
            # upload_photos/submit-for-review deliberately does NOT
            # apply here. Staff here means the (currently single, later
            # multiple) listing-reviewer account(s); per-user checks
            # throughout (verified_by_staff below) mean extra reviewers
            # work normally with zero changes when added.

        decision = request.data.get('decision')
        if decision not in (Listing.Status.PUBLISHED, Listing.Status.REJECTED):
            return Response(
                {'error': 'decision must be "published" or "rejected"'},
                status=status.HTTP_400_BAD_REQUEST,
            )
            # The ONLY two reviewer outcomes — same {'error': '...'}
            # shape the rest of this codebase uses. Validated before
            # the status precondition so a malformed body reports the
            # malformed body, not the row's state.

        if listing.status != Listing.Status.PENDING_REVIEW:
            return Response(
                {'error': 'Only listings pending review can be reviewed'},
                status=status.HTTP_400_BAD_REQUEST,
            )
            # Review consumes pending_review exactly once: drafts must
            # go through submit-for-review first, and published/archived
            # rows can't be re-decided here (no silent re-publish of an
            # archived listing past its review).

        from django.utils import timezone
        # Imported here, not at module top — same deliberate scoping as
        # the payments imports in perform_create: timezone is only ever
        # needed by this one action, and the file's top already carries
        # the import it must (accounts) without growing further.

        now = timezone.now()
        listing.status = decision
        listing.verified_at = now
        # verified_at = "a review happened", whoever performed it. The
        # is_staff_verified badge keys off this (not verified_by_staff
        # — see serializers.py), precisely so an ADMIN approval shows
        # the badge too even though no StaffProfile exists behind it.

        if decision == Listing.Status.PUBLISHED:
            listing.published_at = now
        # published_at set only on approval — a rejection leaves it
        # None, so "first went live at" stays meaningful if a later
        # resubmission is approved instead of being overwritten by a
        # rejection timestamp.

        listing.verified_by_staff = StaffProfile.objects.filter(
            user=request.user
        ).first()
        # .filter().first() (never request.user.staffprofile): a staff
        # reviewer normally HAS a StaffProfile row and gets stamped (the
        # audit trail for "which reviewer approved this"); an admin
        # reviewer has NO StaffProfile table at all, and .first()
        # returns None instead of raising RelatedObjectDoesNotExist →
        # 500. Verified_by_staff is therefore "which staff reviewer",
        # nullable by design — never the gate for the badge.

        listing.save(
            update_fields=['status', 'verified_at', 'published_at', 'verified_by_staff']
        )
        # Scoped write — same update_fields discipline as
        # submit-for-review: only the review columns change, a
        # concurrent edit elsewhere can't be clobbered by a stale
        # full-row save.

        return Response(self.get_serializer(listing).data)
        # Full re-serialization with request context (same reasoning as
        # submit-for-review) so the console updates its cache with no
        # refetch — staff/admin _has_access is unconditional, so the
        # reviewer always sees the unlocked view back.

    @action(detail=True, methods=['post'], url_path='photos')
    # @action = DRF's way of adding a custom endpoint to a ViewSet,
    # beyond the standard 5. detail=True means this operates on ONE
    # specific listing (so the URL includes its ID) — the resulting URL
    # becomes POST /listings/<id>/photos/
    # url_path='photos' = the URL segment, matches what we sketched earlier

    def upload_photos(self, request, pk=None):
        # pk = the listing's ID, automatically extracted from the URL by
        # DRF's routing, since detail=True — same idea as the <id> in
        # accounts/urls.py's manually-written paths, just automatic here

        listing = self.get_object()
        # self.get_object() — a method ModelViewSet already provides,
        # fetches the specific Listing this URL refers to, ALREADY
        # respecting get_queryset() (so a non-owner still can't reach a
        # listing they can't see, same 404-not-403 behavior as before)

        if listing.landlord_profile.user != request.user:
            raise PermissionDenied("You can only upload photos to your own listings")
            # Same ownership check pattern as perform_update/perform_destroy

        images = request.FILES.getlist('images')
        # request.FILES — where Django puts uploaded FILES specifically
        # (separate from request.data, which holds regular text/JSON
        # fields). .getlist('images') grabs every file sent under that
        # key, since one request can carry multiple files at once

        if not images:
            return Response({'error': 'No images provided'}, status=status.HTTP_400_BAD_REQUEST)

        existing_count = listing.photos.count()

        if existing_count + len(images) > MAX_PHOTOS_PER_LISTING:
            return Response(
                {'error': f'A listing can have at most {MAX_PHOTOS_PER_LISTING} photos '
                          f'({existing_count} already uploaded).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # A cap on how many photos one listing can hold. Every photo is
        # stored on (and served from) Cloudflare R2, so an unlimited
        # endpoint would let one account fill the bucket.

        errors = _photo_upload_errors(images)
        if errors:
            return Response({'error': ' '.join(errors)}, status=status.HTTP_400_BAD_REQUEST)
        # EVERY file is checked BEFORE any is saved, so one bad file
        # rejects the whole batch instead of leaving half of it uploaded.
        # See _photo_upload_errors at the bottom of this file for why
        # these checks are needed at all.
        # How many photos this listing already has — needed so a second
        # upload batch continues the `order` sequence instead of
        # restarting at 0 and colliding

        created_photos = []
        for index, image in enumerate(images):
            photo = ListingPhoto.objects.create(
                listing=listing,
                image=image,
                order=existing_count + index,
                is_cover=(existing_count == 0 and index == 0),
                # Only auto-mark as cover if this is the VERY FIRST photo
                # ever uploaded for this listing — avoids accidentally
                # resetting the cover photo on a second upload batch
            )
            created_photos.append(photo)

        serializer = ListingPhotoSerializer(created_photos, many=True)
        # many=True — same concept as before, we're serializing a LIST
        # of objects, not just one

        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post', 'delete'], url_path='save')
    # One @action handling BOTH methods under the same URL
    # (/listings/<id>/save/) — DRF requires a single method name/
    # url_name per URL, so toggling on request.method here is the
    # correct pattern, rather than two separate @action methods trying
    # to share one url_path (which DRF's router would reject as a
    # duplicate URL name)

    def save_listing(self, request, pk=None):
        listing = self.get_object()
        # Already respects get_queryset() — a listing a renter can't
        # even see (e.g. someone else's still-draft listing) 404s here
        # the same way it would on retrieve, rather than letting it be
        # saved/unsaved sight-unseen

        if request.user.role != request.user.Role.RENTER:
            raise PermissionDenied('Only renters can save/unsave listings')

        if request.method == 'DELETE':
            SavedListing.objects.filter(
                renter_profile=request.user.renterprofile, listing=listing
            ).delete()
            # .filter(...).delete() rather than get+delete — deliberately
            # a no-op (not a 404) if it was never saved in the first
            # place; "unsave something not saved" isn't an error worth
            # surfacing
            return Response(status=status.HTTP_204_NO_CONTENT)

        saved, created = SavedListing.objects.get_or_create(
            renter_profile=request.user.renterprofile, listing=listing
        )
        # get_or_create — same idempotency reasoning as ListingUnlock's
        # webhook handling: a double-click/retry on the save button is a
        # harmless no-op, not a 500 from the unique_together constraint

        return Response(
            SavedListingSerializer(saved, context={'request': request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class SavedListingViewSet(viewsets.ReadOnlyModelViewSet):
    # The renter's actual "Saved Homes" list — read-only, since saving/
    # unsaving happens through ListingViewSet's save/unsave actions
    # above (scoped to a specific listing), not by posting directly here

    serializer_class = SavedListingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        if user.role != user.Role.RENTER:
            return SavedListing.objects.none()
            # Non-renters (staff/landlords) simply have no saved-homes
            # list — empty, not an error, same "nothing sensible, don't
            # fail the request over it" spirit as elsewhere in this
            # codebase

        return SavedListing.objects.filter(renter_profile=user.renterprofile)


class ListingPhotoViewSet(viewsets.ModelViewSet):
    # Manages ONE listing's gallery after upload: reorder, change cover,
    # delete. Creation itself deliberately lives elsewhere
    # (ListingViewSet.upload_photos, multipart batch upload with
    # auto-incrementing order + first-ever auto-cover) — this ViewSet
    # never creates rows, which is exactly why POST/PUT are switched
    # off below rather than left to fail confusingly.

    serializer_class = ListingPhotoSerializer
    permission_classes = [IsAuthenticated]
    # Class-level IsAuthenticated with NO AllowAny branch — photos are
    # never public CRUD. Listing bodies are publicly readable (with
    # address/contact gated inside the serializer), but reordering or
    # deleting someone's gallery is an owner-only write, full stop.

    http_method_names = ['get', 'patch', 'delete', 'head', 'options']
    # By default ModelViewSet would also wire up POST (create) and PUT
    # (full replace). Both are wrong here on purpose:
    # - POST would need a listing + image file in one JSON body, but
    #   creation already has its dedicated multipart endpoint
    #   (upload_photos) — a second creation path would split the
    #   order/cover bookkeeping across two places that could drift.
    # - PUT (full-object replace) makes no sense without re-assignable
    #   images: the full representation INCLUDES the image, yet image
    #   is deliberately not re-assignable here (re-upload exists for
    #   that). PATCH-only keeps updates to order/is_cover, the only
    #   two fields this endpoint owns. Same http_method_names technique
    #   ViewingViewSet uses to block PUT/PATCH/DELETE there — here the
    #   blocked set is just different (POST/PUT instead of all writes).

    def get_queryset(self):
        return ListingPhoto.objects.filter(listing__landlord_profile__user=self.request.user)
        # Owner-scoped — get_object() then 404s (not 403s) for
        # non-owners automatically, matching this codebase's existing
        # convention (a stranger's photo URL behaves like "doesn't
        # exist" rather than confirming "exists but not yours").
        # listing__landlord_profile__user — the same double-hop lookup
        # ViewingViewSet uses (Viewing -> listing -> landlord_profile
        # -> user), just starting from ListingPhoto instead of Viewing.
        # .filter (not user.landlordprofile) so renters/staff without a
        # LandlordProfile simply match nothing instead of raising
        # RelatedObjectDoesNotExist.

    def update(self, request, *args, **kwargs):
        if 'image' in request.data:
            return Response(
                {'error': 'Image cannot be changed through this endpoint. Delete and re-upload instead.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
            # image is NOT re-assignable here — the file itself is
            # immutable once uploaded; changing the visual means a new
            # upload (which carries its own order/cover bookkeeping).
            # Explicit 400 with the codebase's {'error': '...'} shape
            # (which the frontend unwraps) rather than silently ignoring
            # the key — silently dropping a field the caller thought
            # they set is the exact class of surprise this codebase
            # avoids with boring, explicit code. Only order/is_cover
            # may change via PATCH.
        return super().update(request, *args, **kwargs)
        # super().update handles partial=True for PATCH (DRF's
        # partial_update calls update(partial=True)) — order and
        # is_cover validate through the normal serializer path.

    def perform_update(self, serializer):
        instance = serializer.instance
        # serializer.instance — the photo being patched, already fetched
        # through the owner-scoped get_queryset above, so by this point
        # ownership is settled and we only handle the cover invariant.

        with transaction.atomic():
            if serializer.validated_data.get('is_cover') is True:
                ListingPhoto.objects.filter(
                    listing=instance.listing
                ).exclude(pk=instance.pk).update(is_cover=False)
                # A listing has AT MOST one cover — clearing every
                # sibling BEFORE setting this one, inside one atomic
                # block, is what makes that invariant hold under
                # concurrency too: without the transaction, two
                # near-simultaneous set-cover requests could interleave
                # (both clear, both set) and leave two covers behind.
                # .update() (not per-row save) — one query, no signals,
                # deliberately blunt for a pure flag-clear.
            serializer.save()
            # Only reached inside the same atomic block, so a failure
            # in save() rolls the sibling-clear back too — never a
            # state where the old cover was cleared but the new one
            # never landed.

    def perform_destroy(self, instance):
        listing = instance.listing
        # Captured BEFORE delete — after instance.delete() the in-memory
        # object's FK is stale for further queries, so the listing
        # reference must be held now to find siblings afterwards.

        was_cover = instance.is_cover
        # Whether promotion is even needed — deleting a non-cover photo
        # changes nothing about which photo fronts the listing.

        with transaction.atomic():
            instance.delete()

            if was_cover:
                replacement = ListingPhoto.objects.filter(
                    listing=listing
                ).order_by('order', 'id').first()
                # First REMAINING photo by gallery order (id as the
                # deterministic tiebreak when two rows share an order
                # value) becomes the new cover — same "first photo fronts
                # the listing" rule upload_photos uses for a brand-new
                # gallery (existing_count == 0 and index == 0).

                if replacement is not None:
                    replacement.is_cover = True
                    replacement.save(update_fields=['is_cover'])
                    # Scoped write — only the flag changes, same
                    # update_fields discipline as submit-for-review.
                # If replacement is None the listing simply has no
                # photos left — the same state as a freshly created
                # listing, and upload_photos' first-ever auto-cover
                # logic re-establishes a cover on the next upload
                # without any special-casing here.

MAX_PHOTOS_PER_LISTING = 20
MAX_PHOTO_BYTES = 10 * 1024 * 1024
# 10 MB per photo — generous for a modern phone photo (typically 2–6 MB),
# small enough that one upload can't tie up the server or the bucket.
ALLOWED_PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
# Same list as ListingPhoto.image's FileExtensionValidator in models.py.


def _photo_upload_errors(images):
    # Returns a list of human-readable problems with the uploaded files
    # (an empty list means every file is fine).
    #
    # WHY THIS EXISTS: upload_photos saves files with
    # ListingPhoto.objects.create(...). A surprising Django fact is that
    # create() does NOT run a model field's `validators` — those only run
    # through a form/serializer or an explicit full_clean(). So the
    # extension rule on ListingPhoto.image was never enforced here, and
    # nothing checked the file was really an image or how big it was.
    # Any file (an .html page, a script, a 2 GB video) went straight into
    # our PUBLIC-read R2 bucket, served from our own media domain — a
    # classic way to host phishing pages or malware on someone else's
    # trusted domain.
    from django import forms
    from django.core.validators import FileExtensionValidator
    from django.core.exceptions import ValidationError as DjangoValidationError

    image_field = forms.ImageField(
        validators=[FileExtensionValidator(allowed_extensions=ALLOWED_PHOTO_EXTENSIONS)]
    )
    # forms.ImageField is Django's form-level image checker. Its clean()
    # method runs the extension validator above AND opens the file with
    # Pillow (the image library in our Pipfile) to confirm it really is
    # an image. That second part is what matters: the extension is just
    # part of the file NAME, which the uploader chooses freely — renaming
    # evil.html to evil.jpg fools an extension check, but not Pillow.

    errors = []
    for image in images:
        if image.size > MAX_PHOTO_BYTES:
            errors.append(f'"{image.name}" is larger than 10 MB.')
            continue
            # Size first: cheap to check, and there's no point asking
            # Pillow to open a file we're going to reject anyway.
        try:
            image_field.clean(image)
        except DjangoValidationError:
            errors.append(f'"{image.name}" is not a JPG, PNG or WebP image.')
        finally:
            image.seek(0)
            # Pillow READ the file to check it, which moves the file's
            # internal "cursor" to the end. seek(0) rewinds it, so when
            # the file is saved to R2 afterwards the whole image is
            # written — not an empty file.
    return errors
