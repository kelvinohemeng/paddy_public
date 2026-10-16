from rest_framework import serializers
# Import DRF's serializers module — same pattern as importing `models` from django.db,
# just a different toolbox, this one specifically for validation + JSON conversion

from .models import User, RenterProfile, LandlordProfile, StaffProfile
# Import the models this serializer needs to know about.
# StaffProfile is now needed too — not for RegisterSerializer below (staff
# accounts still can't self-register, that hasn't changed), but for
# StaffProfileSerializer further down this file, used by UserSerializer's
# get_profile() to expose a logged-in staff member's own profile data.


class RegisterSerializer(serializers.ModelSerializer):
    # ModelSerializer = a serializer that already knows how to map to a specific
    # model's fields, saving us from manually declaring every field by hand
    # (there's also a plain serializers.Serializer for cases with no direct model —
    # we don't need that here)

    password = serializers.CharField(write_only=True, min_length=8)
    # write_only=True = accept this field when data comes IN, but never include
    # it when sending data back OUT as JSON (we never want to expose a password,
    # even hashed, in an API response)
    # min_length=8 = basic validation rule, rejects short passwords automatically

    class Meta:
        # Meta = a special nested class ModelSerializer looks for, to know which
        # model this serializer is based on and which fields to expose
        model = User
        fields = ['email', 'password', 'phone', 'role', 'first_name', 'last_name']
        # Only these four fields are accepted from incoming signup requests —
        # anything else in the request body gets ignored (e.g. is_staff, is_superuser
        # can't be set this way, protecting against someone trying to self-promote)
        extra_kwargs = {
            'first_name': {'required': True},
            'last_name': {'required': True},
            'role': {'required': False, 'allow_null': True},
            # Role is now optional at registration — omitting it (or
            # sending null) is valid and defers the choice to the
            # post-auth onboarding screen (POST /accounts/onboarding/).
            # ModelSerializer would infer required=False from the model's
            # blank=True on its own, but allow_null needs to be explicit.
        }

    def create(self, validated_data):
        # Overriding the default create() behavior — ModelSerializer normally
        # knows how to create a plain model instance, but we need EXTRA logic:
        # hashing the password correctly, and creating the matching profile row

        role = validated_data.get('role')
        # Pull the role out of the already-validated incoming data. role is
        # now OPTIONAL at registration (model field is nullable, no default)
        # — omitting it entirely is valid and leaves role=None, the signal
        # the frontend's onboarding gate checks for on every auth path. The
        # matching profile row is deliberately NOT created in that case —
        # POST /accounts/onboarding/ below creates it once a role is chosen.

        user = User.objects.create_user(
            email=validated_data['email'],
            password=validated_data['password'],
            phone=validated_data.get('phone', ''),
            role=role,
            first_name=validated_data['first_name'],
            last_name=validated_data['last_name'],
        )
        # Calls OUR custom create_user (the manager we wrote earlier) —
        # this is what correctly hashes the password via set_password,
        # instead of accidentally storing it as plain text.
        # first_name/last_name: required by `extra_kwargs` above, but
        # until now never passed on here, so the names people typed at
        # sign-up were validated and then thrown away. The onboarding
        # screen pre-fills from them, so they're saved now.

        full_name = f"{user.first_name} {user.last_name}".strip()
        if role == User.Role.RENTER:
            RenterProfile.objects.create(user=user, full_name=full_name)
        elif role == User.Role.LANDLORD:
            LandlordProfile.objects.create(user=user, full_name=full_name)
        # Only runs when a role WAS supplied at registration (still fully
        # supported, e.g. a client that hasn't moved to the deferred
        # onboarding flow yet) — role=None skips this, onboarding handles
        # it later. The profile starts with the sign-up name; the person
        # can still change it on their profile page.

        return user
        # Return the created user — DRF uses this to build the response

    def validate_role(self, value):
        # DRF automatically calls any method named validate_<fieldname> —
        # this one runs specifically for the `role` field, after the basic
        # type/choices validation already passed. Not called at all when
        # role is omitted from the request body (optional field), so no
        # None-handling needed here.

        if value in [User.Role.ADMIN, User.Role.STAFF]:
            # Block these two values specifically — admin and staff accounts
            # must never be creatable through the public signup endpoint,
            # only renter/landlord are allowed to self-register

            raise serializers.ValidationError(
                'You cannot register with this role.'
            )
            # Raising this stops validation immediately — is_valid() in the
            # View will return False, and this message will show up in
            # serializer.errors, e.g. {"role": ["You cannot register with this role."]}

        return value
        # If it passed the check, return the value unchanged so it can
        # continue on to be saved normally


class RenterProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = RenterProfile
        exclude = ['user']
        # 'user' is the OneToOneField back to User — meaningless to send
        # to the frontend (it'd just be the same user's own ID again,
        # already present at the top level of the response). Everything
        # else on RenterProfile is exposed automatically — if you add a
        # new field to the model later, it appears here for free, no
        # edit needed, same benefit as UserSerializer's exclude pattern.


class LandlordProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = LandlordProfile
        exclude = ['user', 'national_id_number']
        # Same 'user' exclusion as above, PLUS national_id_number —
        # a real government ID number. Excluding it here means it's
        # simply never included in any response using this serializer,
        # no matter what calls it, now or in the future. If a specific
        # admin-only screen genuinely needs to show it later, that's a
        # deliberate separate serializer for that specific case, not a
        # default every /accounts/me/ call returns.


class StaffProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffProfile
        exclude = ['user']


class UserSerializer(serializers.ModelSerializer):
    profile = serializers.SerializerMethodField()
    # A "computed" field — unlike email/role/phone (real columns on the
    # User table), this one has no matching database column at all. Its
    # value comes from running the get_profile() method below, every
    # time a User gets serialized.

    class Meta:
        model = User
        exclude = ['password', 'groups', 'user_permissions']
        # Every real column on User except password, automatically. No
        # manual list to maintain; if a new field is added to the User
        # model later, it shows up here for free, with zero edits needed.

    def get_profile(self, obj):
        # DRF calls this automatically because the field above is named
        # `profile`; it looks for a method named exactly
        # `get_<field_name>`. `obj` is the actual User instance currently
        # being serialized (the same one `request.user` gives the `me`
        # view in views.py).
        if obj.role == User.Role.RENTER:
            try:
                profile = RenterProfile.objects.get(user=obj)
            except RenterProfile.DoesNotExist:
                # A renter User row can technically exist without a
                # RenterProfile row yet (e.g. mid-signup, or a bug) —
                # return None instead of crashing the whole
                # /accounts/me/ request with an unhandled exception
                return None
            return RenterProfileSerializer(profile).data
        elif obj.role == User.Role.LANDLORD:
            try:
                profile = LandlordProfile.objects.get(user=obj)
            except LandlordProfile.DoesNotExist:
                return None
            return LandlordProfileSerializer(profile).data
        elif obj.role == User.Role.STAFF:
            try:
                profile = StaffProfile.objects.get(user=obj)
            except StaffProfile.DoesNotExist:
                return None
            return StaffProfileSerializer(profile).data
        # role == 'admin' (or anything else unexpected) has no profile
        # table at all — Django's own superuser account, for example.
        # Returning None here is what makes the /accounts/me/ response
        # correctly show "profile": null for those accounts.
        return None


class OnboardingSerializer(serializers.ModelSerializer):
    # Validates the name + username part of POST /accounts/onboarding/
    # (accounts/views.py onboarding). The `role` part is checked in the
    # view instead, because whether role is allowed at all depends on the
    # account's current state, not just on the value sent.
    #
    # Being a ModelSerializer means DRF copies the rules straight off the
    # User model fields: for `username` that's max_length=30, the format
    # and reserved-word validators, and a uniqueness check that uses the
    # model's own "That username is taken" message. One set of rules,
    # defined once in models.py, enforced here and in Django admin alike.

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'username']
        extra_kwargs = {
            'first_name': {'required': True, 'allow_blank': False},
            'last_name': {'required': True, 'allow_blank': False},
            'username': {'required': True, 'allow_blank': False, 'allow_null': False},
        }
        # extra_kwargs overrides what DRF would otherwise copy from the
        # model. On the model all three are optional (blank=True, and
        # username also null=True, because accounts exist before
        # onboarding fills them in). Onboarding is exactly the step that
        # fills them in, so here they're required and can't be empty.
        # DRF also trims spaces by default, so "   " counts as empty.

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None and self.instance.username is not None:
            self.fields.pop('username')
        # An account that already has a username (e.g. one a staff member
        # set in Django admin) only fills in its names and role here.
        # Removing the field means it's neither required nor writable:
        # there's no self-service rename. The view rejects a request that
        # tries to send one anyway, with a clear message.


class UserUpdateSerializer(serializers.ModelSerializer):
    # A SEPARATE serializer from UserSerializer, used only for updates —
    # deliberately exposes far FEWER fields than UserSerializer (which is
    # read-only display data). This is the actual security boundary: even
    # if someone sends {"role": "admin", "is_verified": true} in a PATCH
    # request, this serializer's `fields` list below means DRF silently
    # ignores anything not listed here — those fields can never be changed
    # through this endpoint, no matter what's in the request body

    class Meta:
        model = User
        fields = ['phone']
        # Only phone is self-service editable on the User model itself.
        # email = identity-critical (used for login/JWT), role = controls
        # permissions throughout the whole app, is_verified = staff/admin-
        # controlled — none of these are safe to let a user change on
        # themselves via a simple PATCH



class StaffLandlordSerializer(serializers.ModelSerializer):
    # Read-only card for one landlord, as staff see it while listing a home
    # for them (GET/POST /accounts/landlords/, accounts/views.py landlords).
    # Built on User, with the two LandlordProfile fields pulled through
    # `source`. Deliberately a short include-list (`fields`, not
    # `exclude`): it shows a landlord's contact details to staff, so a new
    # User column must never appear here by accident.

    landlord_profile_id = serializers.IntegerField(source='landlordprofile.id', read_only=True)
    # The id staff send as landlord_profile_id when creating a listing.
    full_name = serializers.CharField(source='landlordprofile.full_name', read_only=True)
    has_claimed = serializers.BooleanField(source='has_usable_password', read_only=True)
    # True once the landlord has set a password (from the invite link or
    # "forgot password"). Staff-created accounts start with an UNUSABLE
    # password, so False means "invite pending". `source` can name a
    # method: DRF calls has_usable_password() for us.

    class Meta:
        model = User
        fields = ['id', 'landlord_profile_id', 'full_name', 'email', 'phone', 'username', 'has_claimed']


class StaffCreateLandlordSerializer(serializers.ModelSerializer):
    # Validates POST /accounts/landlords/ (staff creating a landlord in the
    # field). Only these four fields are read; role, password, username and
    # is_verified are set by the view, never by the request.

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email', 'phone']
        extra_kwargs = {
            'first_name': {'required': True, 'allow_blank': False},
            'last_name': {'required': True, 'allow_blank': False},
            'phone': {'required': True, 'allow_blank': False},
            'email': {'validators': []},
            # validators=[] drops the uniqueness check DRF copies from the
            # model (email is unique=True). The view checks for a taken
            # email itself, case-insensitively, and answers with the
            # machine-readable `code: "email_taken"` the frontend expects.
        }
