from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from accounts.models import User
from .models import Lease, LeaseRecord
from .serializers import LeaseSerializer, LeaseRecordSerializer


class LeaseViewSet(viewsets.ModelViewSet):
    # The renter "Active Leases" dashboard's backing endpoint, plus the
    # staff/landlord record-keeping side of the same data. Leases are
    # never created by a renter and never created automatically by a
    # payment webhook — see the model docstring for why (rent/deposit
    # moves off-platform, paddy has no payment event to hang this on)

    queryset = Lease.objects.all()
    serializer_class = LeaseSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']
    # No DELETE — a real tenancy record should never simply disappear,
    # only move to ended/terminated status. Same style choice as
    # ViewingViewSet restricting its method list, different reasoning

    def get_queryset(self):
        user = self.request.user

        if user.role in (User.Role.STAFF, User.Role.ADMIN):
            return Lease.objects.all()
            # Staff see every lease; admin (superuser) sees everything
            # too, for the "all activities" oversight console. Renter/
            # landlord branches below are unchanged.

        if user.role == User.Role.LANDLORD:
            return Lease.objects.filter(landlord_profile__user=user)
            # A landlord sees leases on their own listings only — same
            # one-hop double-underscore pattern as ListingViewSet

        return Lease.objects.filter(renter_profile__user=user)
        # Default (renter): only their own leases — this IS the "Active
        # Leases" dashboard's data source

    def perform_create(self, serializer):
        user = self.request.user

        if user.role not in (User.Role.STAFF, User.Role.ADMIN, User.Role.LANDLORD):
            raise PermissionDenied('Only staff, admins, or landlords can record a lease')
            # Admin added alongside staff: the oversight console records
            # leases the same way a reviewer would. Renters still
            # blocked — a tenant must never conjure their own tenancy
            # record.

        listing = serializer.validated_data.get('listing')
        landlord_profile = serializer.validated_data.get('landlord_profile')

        if user.role == User.Role.LANDLORD:
            if listing is not None and listing.landlord_profile.user != user:
                raise PermissionDenied('You can only record leases on your own listings')
            # A landlord can't be trusted to pass their own landlord_profile
            # correctly either — force it from who's logged in, same
            # non-negotiable pattern as landlord_profile on Listing.create
            lease = serializer.save(landlord_profile=user.landlordprofile)
            self._mark_listing_leased(lease.listing)
            return

        # Staff AND admin: trust the submitted landlord_profile, but it
        # must actually match the listing's real landlord — otherwise the
        # record would misrepresent who the landlord on this lease is.
        # Same guard for both roles; the console gets no free pass on
        # data integrity just for being internal.
        if listing is not None and landlord_profile is not None and listing.landlord_profile_id != landlord_profile.id:
            raise PermissionDenied("landlord_profile must match the listing's landlord")

        lease = serializer.save()
        self._mark_listing_leased(lease.listing)

    def _mark_listing_leased(self, listing):
        # THE automatic (and only) published -> leased transition, per
        # the product decision: no manual staff/landlord action exists
        # for this status at all — creating a real Lease record IS what
        # "leased" means. Deliberately scoped to PUBLISHED only: a
        # staff/admin backfilling historical lease data against a
        # draft/archived/already-leased listing shouldn't silently flip
        # unrelated status machinery (e.g. resurrecting an archived
        # listing as "leased" would be a lie about its current state).
        from listings.models import Listing
        # Imported here, not at module top — avoids a circular import:
        # listings/views.py already imports nothing from leases, so this
        # keeps that one-directional graph intact rather than assuming
        # it's safe and finding out otherwise later.

        if listing.status == Listing.Status.PUBLISHED:
            listing.status = Listing.Status.LEASED
            listing.save(update_fields=['status'])
            # Scoped write — same update_fields discipline as
            # ListingViewSet's submit-for-review/review actions.

    def perform_update(self, serializer):
        lease = self.get_object()
        user = self.request.user

        if user.role == User.Role.RENTER:
            raise PermissionDenied('Renters cannot edit lease records')

        if user.role == User.Role.LANDLORD and lease.landlord_profile.user != user:
            raise PermissionDenied('You can only edit leases on your own listings')

        serializer.save()
        # Staff and admin both fall through to the save — staff keeps
        # its existing record-keeping access (narrowing staff out of
        # leases entirely rides with the viewing-redesign brief, not
        # this change), admin gains console edit access.


class LeaseRecordViewSet(viewsets.ModelViewSet):
    # Contract/receipt entries attached to a Lease — the "contract
    # downloads, receipts" part of the Active Leases dashboard (item 4).
    # Structured data only, no file attachments yet (MVP scope)

    queryset = LeaseRecord.objects.all()
    serializer_class = LeaseRecordSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']
    # No update/delete — a receipt/contract entry, once logged, is a
    # historical fact; corrections should be a new note, not a silent edit

    def get_queryset(self):
        user = self.request.user

        if user.role in (User.Role.STAFF, User.Role.ADMIN):
            return LeaseRecord.objects.all()
            # Same staff+admin reasoning as LeaseViewSet above.

        if user.role == User.Role.LANDLORD:
            return LeaseRecord.objects.filter(lease__landlord_profile__user=user)

        return LeaseRecord.objects.filter(lease__renter_profile__user=user)
        # Renters can read their own receipts/contracts (the actual
        # "contract downloads, receipts" dashboard need) but never create
        # them — see perform_create below

    def perform_create(self, serializer):
        user = self.request.user

        if user.role not in (User.Role.STAFF, User.Role.ADMIN, User.Role.LANDLORD):
            raise PermissionDenied('Only staff, admins, or landlords can log a lease record')

        lease = serializer.validated_data.get('lease')

        if user.role == User.Role.LANDLORD and lease is not None and lease.landlord_profile.user != user:
            raise PermissionDenied('You can only log records for leases on your own listings')

        serializer.save()
