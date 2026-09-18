from rest_framework import serializers
from .models import Listing, ListingPhoto, SavedListing
from core.serializers import AmenitySerializer


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ['id', 'image', 'order', 'is_cover']
        # Simple include-list — every field here is safe to both accept
        # and return, no sensitive/staff-only fields on this model at all


class ListingSerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()
    # A COMPUTED field — doesn't exist on the Listing model at all,
    # calculated fresh on every serialization instead. Lets the
    # frontend show a clear "unlock this listing" prompt vs. already-
    # unlocked state, without needing to guess from whether
    # address_precise/landlord_contact happen to be null or missing

    landlord_contact = serializers.SerializerMethodField()
    # Also computed, not a real model field — "contact info" isn't one
    # single field on Listing OR LandlordProfile, it's assembled here
    # from the landlord's User (phone, email) at serialization time,
    # and only included at all when access is actually earned

    landlord_public = serializers.SerializerMethodField()
    # Deliberately the OPPOSITE of landlord_contact: a small, always-
    # visible, non-sensitive snippet (display name + verified badge) —
    # a renter browsing a still-locked listing currently sees NOTHING
    # about who's renting it out at all, which reads as untrustworthy/
    # broken on the frontend. Never includes phone/email — that stays
    # behind landlord_contact's real access gate

    is_staff_verified = serializers.SerializerMethodField()
    # Whether staff have verified this specific listing — safe to
    # expose unconditionally (it's a badge, not contact info), but
    # verified_at itself stays excluded below since the exact
    # TIMESTAMP isn't something the frontend needs and verified_by_staff
    # (WHICH staff member) definitely shouldn't be exposed at all

    is_saved = serializers.SerializerMethodField()
    # Lets a renter's listing card/detail page show a filled-in vs.
    # outline "save" icon immediately, without a second round trip to
    # /listings/saved/ just to check. Always False for non-renters/
    # anonymous visitors — saving isn't something they can do anyway

    photos = ListingPhotoSerializer(many=True, read_only=True)
    # Nested read-only gallery — related_name='photos' on ListingPhoto
    # already matches this field name, so no explicit source= needed.
    # read_only=True because photos are attached through the dedicated
    # upload_photos action (multipart file upload), never through this
    # serializer's own create/update — same reasoning landlord_profile
    # is excluded from Meta below, just via a different mechanism since
    # this field doesn't exist as a plain model column at all

    amenities_detail = AmenitySerializer(source='amenities', many=True, read_only=True)
    # `amenities` (below, via Meta's default M2M handling) stays a
    # plain list of PKs — that's what listing CREATE/UPDATE needs to
    # accept from the frontend's amenity picker, and changing that
    # would break existing writes. This is a SEPARATE, read-only,
    # nested view of the exact same relationship, purely for display —
    # same "write shape stays simple, read shape gets richer" pattern
    # as SavedListingSerializer's listing/listing_detail pair

    class Meta:
        model = Listing
        exclude = ['landlord_profile', 'verified_at', 'published_at', 'verified_by_staff']
        # exclude = "every field on the model EXCEPT these" — status is
        # deliberately NOT in this list anymore (it used to be): the
        # owner and staff genuinely need to READ it (dashboard lifecycle
        # UI, "what state is my listing in"), and public callers can
        # only ever receive published rows via get_queryset anyway, so
        # exposing the value leaks nothing to them.
        #
        # landlord_profile still excluded because the VIEW sets it
        # explicitly (from request.user) — never trust the client to say
        # who owns this.
        #
        # verified_at/published_at/verified_by_staff stay excluded —
        # these are staff-controlled fields. verified_by_staff identity
        # must stay private in particular; is_staff_verified above gives
        # the frontend a safe yes/no without exposing WHO verified it.
        extra_kwargs = {
            'status': {'read_only': True},
        }
        # read_only (not writable) — THE load-bearing half of exposing
        # status safely. Without this, removing status from exclude
        # would make it writable too, and a landlord could POST
        # {'status': 'published'} and self-publish past staff review —
        # the exact bypass test_landlord_cannot_set_status_on_create
        # guards against. read_only keeps the read (dashboard needs it)
        # while create/update silently ignore any client-supplied value
        # and the model's own default (draft) stands. The ONLY
        # landlord-driven transition is the dedicated submit-for-review
        # action on the ViewSet; publishing itself stays staff-only in
        # Django admin.

    def _has_access(self, listing):
        # THE actual security boundary for this whole feature — every
        # other method below (address gating, contact gating,
        # is_unlocked) all just call this ONE method, so the access
        # rule only needs to be correct in exactly one place

        request = self.context.get('request')
        if request is None or not request.user or not request.user.is_authenticated:
            return False
            # No logged-in user at all (e.g. this serializer used
            # somewhere without a request in context) — never grant
            # access by default; fail closed, not open

        user = request.user

        if user.role == user.Role.STAFF:
            return True
            # Staff always see everything — matches every other
            # visibility rule in this codebase (get_queryset, etc.)

        if listing.landlord_profile.user == user:
            return True
            # A landlord always sees their OWN listing's full details —
            # they wrote the address themselves, paying to see it again
            # would be absurd

        if user.role == user.Role.LANDLORD:
            from payments.models import LandlordSubscription
            # Imported here, not at the top of the file — same
            # deliberate scoping reason as listings/views.py's
            # perform_create: avoids a circular import risk between
            # listings and payments, which already reference each
            # other in both directions (ListingUnlock.listing is a
            # string reference to Listing for the same reason)

            subscription = LandlordSubscription.objects.filter(
                landlord_profile=user.landlordprofile
            ).first()

            if subscription is not None and subscription.is_active():
                return True
            # A landlord with an ACTIVE paid subscription (any tier) —
            # per the actual product decision, this is a genuine perk
            # of paying for a subscription at all, not just a higher
            # listing cap. A FREE-tier landlord (no active subscription)
            # does NOT get a free pass here — they pay per-listing like
            # anyone else, same as a renter would

        return listing.unlocks.filter(user=user).exists()
        # The fallback for everyone else (renters, and landlords without
        # an active subscription): have THEY specifically paid to
        # unlock THIS listing? .exists() rather than .first() — we only
        # need a yes/no, no need to fetch the actual row's data here

    def get_is_unlocked(self, listing):
        return self._has_access(listing)

    def get_landlord_contact(self, listing):
        if not self._has_access(listing):
            return None
            # Returning None (not omitting the key) means the frontend
            # can always safely check `listing.landlord_contact`
            # without a KeyError, and cleanly distinguish "locked" (None)
            # from "unlocked but genuinely has no phone on file" (would
            # be a different case entirely, not something we handle yet)

        landlord_user = listing.landlord_profile.user
        return {
            'phone': landlord_user.phone,
            'email': landlord_user.email,
        }

    def get_landlord_public(self, listing):
        # Always visible, regardless of unlock status — deliberately
        # NEVER includes phone/email, only what's safe for anyone
        # browsing to see. This is what fills the trust gap a locked
        # listing currently has: a renter sees WHO is renting it out
        # and whether they're verified, before ever paying to unlock
        # the direct contact details

        landlord_profile = listing.landlord_profile
        return {
            'full_name': landlord_profile.full_name,
            'id_verified': landlord_profile.id_verified,
        }

    def get_is_staff_verified(self, listing):
        return listing.verified_by_staff_id is not None
        # verified_by_staff_id (the raw FK column) rather than touching
        # .verified_by_staff itself — avoids an extra query just to
        # check existence, and avoids ever accidentally serializing the
        # related StaffProfile object by mistake later if this method
        # were refactored carelessly

    def get_is_saved(self, listing):
        request = self.context.get('request')
        if request is None or not request.user or not request.user.is_authenticated:
            return False
            # Same fail-closed defaulting as _has_access — anonymous
            # visitors can't have saved anything

        user = request.user
        if user.role != user.Role.RENTER:
            return False
            # Only renters can save listings at all (see
            # ListingViewSet.save_listing) — staff/landlords always
            # get False here rather than hitting RenterProfile.DoesNotExist

        return listing.saved_by.filter(renter_profile__user=user).exists()
        # listing.saved_by — the related_name SavedListing.listing
        # declares — .exists() since, same as _has_access, we only need
        # yes/no, not the actual SavedListing row

    def to_representation(self, instance):
        # Runs AFTER all the normal field serialization above — this is
        # our chance to REMOVE something that's already been included,
        # specifically address_precise. Unlike landlord_contact (which
        # we control entirely via SerializerMethodField and never touch
        # the real model field), address_precise IS a real field on
        # Listing, included automatically by `exclude` in Meta above —
        # so we let it serialize normally, then strip it out here if
        # access hasn't been earned. This ordering matters: reversing
        # it (checking access first) would mean re-implementing every
        # other field's serialization by hand instead of reusing DRF's
        # default behavior for everything else

        data = super().to_representation(instance)

        if not self._has_access(instance):
            data['address_precise'] = None
            # Same None-not-omitted reasoning as landlord_contact above —
            # consistent shape for the frontend regardless of lock state

        return data


class SavedListingSerializer(serializers.ModelSerializer):
    listing_detail = ListingSerializer(source='listing', read_only=True)
    # Nested, read-only — lets the "Saved Homes" list render straight
    # from this one endpoint (title/photo/price/etc.) without the
    # frontend needing a second round trip per saved listing to resolve
    # what was actually saved

    class Meta:
        model = SavedListing
        fields = ['id', 'listing', 'listing_detail', 'created_at']
        # renter_profile deliberately not exposed — the view always sets
        # it from whoever's logged in, same non-negotiable pattern as
        # landlord_profile on ListingSerializer.save()
