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

        if user.role == User.Role.STAFF:
            return Lease.objects.all()

        if user.role == User.Role.LANDLORD:
            return Lease.objects.filter(landlord_profile__user=user)
            # A landlord sees leases on their own listings only — same
            # one-hop double-underscore pattern as ListingViewSet

        return Lease.objects.filter(renter_profile__user=user)
        # Default (renter): only their own leases — this IS the "Active
        # Leases" dashboard's data source

    def perform_create(self, serializer):
        user = self.request.user

        if user.role not in (User.Role.STAFF, User.Role.LANDLORD):
            raise PermissionDenied('Only staff or landlords can record a lease')

        listing = serializer.validated_data.get('listing')
        landlord_profile = serializer.validated_data.get('landlord_profile')

        if user.role == User.Role.LANDLORD:
            if listing is not None and listing.landlord_profile.user != user:
                raise PermissionDenied('You can only record leases on your own listings')
            # A landlord can't be trusted to pass their own landlord_profile
            # correctly either — force it from who's logged in, same
            # non-negotiable pattern as landlord_profile on Listing.create
            serializer.save(landlord_profile=user.landlordprofile)
            return

        # Staff: trust the submitted landlord_profile, but it must
        # actually match the listing's real landlord — otherwise the
        # record would misrepresent who the landlord on this lease is
        if listing is not None and landlord_profile is not None and listing.landlord_profile_id != landlord_profile.id:
            raise PermissionDenied("landlord_profile must match the listing's landlord")

        serializer.save()

    def perform_update(self, serializer):
        lease = self.get_object()
        user = self.request.user

        if user.role == User.Role.RENTER:
            raise PermissionDenied('Renters cannot edit lease records')

        if user.role == User.Role.LANDLORD and lease.landlord_profile.user != user:
            raise PermissionDenied('You can only edit leases on your own listings')

        serializer.save()


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

        if user.role == User.Role.STAFF:
            return LeaseRecord.objects.all()

        if user.role == User.Role.LANDLORD:
            return LeaseRecord.objects.filter(lease__landlord_profile__user=user)

        return LeaseRecord.objects.filter(lease__renter_profile__user=user)
        # Renters can read their own receipts/contracts (the actual
        # "contract downloads, receipts" dashboard need) but never create
        # them — see perform_create below

    def perform_create(self, serializer):
        user = self.request.user

        if user.role not in (User.Role.STAFF, User.Role.LANDLORD):
            raise PermissionDenied('Only staff or landlords can log a lease record')

        lease = serializer.validated_data.get('lease')

        if user.role == User.Role.LANDLORD and lease is not None and lease.landlord_profile.user != user:
            raise PermissionDenied('You can only log records for leases on your own listings')

        serializer.save()
