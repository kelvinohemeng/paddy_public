
import logging

import requests
from decouple import config
from django.conf import settings
from google.oauth2 import id_token
from rest_framework_simplejwt.tokens import RefreshToken
from .models import User, RenterProfile, LandlordProfile, StaffProfile
from core.models import Amenity
from django.core.exceptions import ValidationError
# Amenity — needed to resolve amenity_preferences IDs below.
# ValidationError — a malformed amenity_preferences payload (e.g.
# non-integer IDs) makes the id__in lookup itself raise instead of
# returning empty; caught and turned into a clean 400, never a 500.
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.request import Request
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import EmailMultiAlternatives
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from rest_framework.response import Response
from rest_framework import status
from django.core.files.base import ContentFile
from .serializers import RegisterSerializer, UserSerializer, UserUpdateSerializer
# UserSerializer and UserUpdateSerializer used to be defined directly in
# this file — moved into serializers.py to match Django/DRF convention
# (all serializers live together in serializers.py, all view/request
# logic lives in views.py). Imported here since the `me` view below
# still needs to call both of them.


logger = logging.getLogger(__name__)
# __name__ here is "accounts.views" — this is the standard Django/Python
# pattern for a per-module logger, so any log line printed from this file
# is automatically tagged with exactly where it came from


@api_view(['GET', 'PATCH'])
# Now accepts TWO HTTP methods on the same URL — GET behaves exactly as
# before (read your own data), PATCH is the new update behavior. This is
# standard REST convention: one URL representing "my account", different
# verbs for different actions on it

@permission_classes([IsAuthenticated])
def me(request: Request) -> Response:
    user: User = request.user

    if request.method == 'PATCH':
        # request.method — DRF/Django always tells you which HTTP verb was
        # actually used, so one function can handle multiple behaviors

        serializer = UserUpdateSerializer(user, data=request.data, partial=True)
        # Passing `user` as the FIRST argument (unlike RegisterSerializer,
        # which only got `data=`) tells DRF "update THIS existing object"
        # instead of creating a brand new one
        # partial=True = allow the request to include just SOME fields,
        # not require every field in `fields` to be present every time
        # (e.g. sending only {"phone": "..."} without needing anything else)

        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Profile inputs are validated BEFORE anything is written (user
        # row and profile rows alike) — a 400 below must leave the
        # database untouched. Writing phone first and validating
        # occupation second would produce half-writes ("phone saved but
        # occupation rejected"), the exact class of surprise this
        # codebase avoids with boring, explicit code. So this whole
        # section only READS request.data and returns early on invalid
        # input; the actual writes happen further down, after every
        # check has passed.

        renter_updates = {}
        # Renter scalar writes, collected here during validation and
        # applied in one .update() later — one query, not one per field.
        amenities_to_set = None
        # Validated Amenity list for the M2M write (None = key absent,
        # no M2M change; [] = explicitly cleared — both valid).

        if user.role == User.Role.RENTER:
            # Self-service renter CV fields — each one read with .get()
            # and collected ONLY when present, so a PATCH with just
            # {"phone": ...} changes nothing here (partial update, same
            # spirit as UserUpdateSerializer's partial=True above).
            # Unknown/disallowed keys (role, email, verification flags,
            # ...) are never read at all — this allowlist IS the
            # security boundary, same "silently ignore what isn't
            # listed" reasoning as UserUpdateSerializer's fields list
            # in serializers.py.

            preferred_area = request.data.get('preferred_area')
            if preferred_area is not None:
                renter_updates['preferred_area'] = preferred_area

            school_name = request.data.get('school_name')
            if school_name is not None:
                renter_updates['school_name'] = school_name

            occupation = request.data.get('occupation')
            if occupation is not None:
                if occupation not in RenterProfile.Occupation.values:
                    return Response(
                        {'error': 'Invalid occupation.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                    # {'error': '...'} — the shape the frontend unwraps
                    # everywhere, not serializer.errors.
                renter_updates['occupation'] = occupation

            about_me = request.data.get('about_me')
            if about_me is not None:
                renter_updates['about_me'] = about_me

            preferred_payment_method = request.data.get('preferred_payment_method')
            if preferred_payment_method is not None:
                if preferred_payment_method not in RenterProfile.PaymentMethod.values:
                    return Response(
                        {'error': 'Invalid preferred_payment_method.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                renter_updates['preferred_payment_method'] = preferred_payment_method

            if request.data.get('amenity_preferences') is not None:
                # M2M — needs the real instance + .set() at write time
                # (plain .update() only writes columns). Accepts a list
                # of Amenity PKs — the same "write shape stays simple
                # IDs" convention Listing.amenities uses (nested detail
                # lives on the read serializer instead, never on the
                # write path).
                amenity_ids = request.data.get('amenity_preferences')
                if not isinstance(amenity_ids, list):
                    return Response(
                        {'error': 'amenity_preferences must be a list of amenity IDs.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                try:
                    amenities_to_set = list(Amenity.objects.filter(id__in=amenity_ids))
                except (ValueError, TypeError, ValidationError):
                    return Response(
                        {'error': 'Invalid amenity_preferences.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                    # Non-integer IDs make the id__in lookup itself
                    # raise (rather than returning empty) — caught and
                    # turned into a clean 400, never a 500.
                if len(amenities_to_set) != len(set(amenity_ids)):
                    return Response(
                        {'error': 'One or more amenities not found.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                    # Length mismatch means at least one ID names no
                    # real Amenity — the write must never run on a
                    # partial match, or the caller's typo would silently
                    # drop preferences they thought they saved. An empty
                    # list passes (0 == 0) and clears preferences below,
                    # which is valid.

        elif user.role == User.Role.LANDLORD:
            preferred_payout_method = request.data.get('preferred_payout_method')
            if preferred_payout_method is not None:
                if preferred_payout_method not in LandlordProfile.PayoutMethod.values:
                    return Response(
                        {'error': 'Invalid preferred_payout_method.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            # national_id_number and id_verified are deliberately NEVER
            # read here — both are staff-only (the ID document
            # verification workflow). national_id_number is excluded
            # from LandlordProfileSerializer responses too, and
            # id_verified flips only via staff review. A client sending
            # either key gets it silently ignored, exactly like
            # role/email on the User side.
        # Staff gets full_name only (handled at write time below) —
        # can_approve_listings / can_host_viewings are permission flags
        # no user may grant themselves, so no branch reads them here.

        serializer.save()
        # Since we passed an existing `user` instance above, .save()
        # here UPDATES that row rather than creating a new one —
        # same method name as RegisterSerializer, different behavior,
        # because DRF checks whether an instance was provided.
        # Reached only after EVERY validation above passed, so no
        # half-write is possible from this point on.

        full_name = request.data.get('full_name')
        # full_name isn't on the User model at all — it lives on
        # RenterProfile or LandlordProfile instead, so it can't be
        # handled by UserUpdateSerializer above. We check for it
        # separately here and update the correct profile table
        # directly, depending on this user's role

        if full_name is not None:
            if user.role == User.Role.RENTER:
                RenterProfile.objects.filter(user=user).update(full_name=full_name)
            elif user.role == User.Role.LANDLORD:
                LandlordProfile.objects.filter(user=user).update(full_name=full_name)
            elif user.role == User.Role.STAFF:
                StaffProfile.objects.filter(user=user).update(full_name=full_name)
            # No ADMIN branch — there is deliberately no AdminProfile
            # model anywhere (role 'admin' is Django's own superuser
            # account, which has no profile table — UserSerializer.
            # get_profile returns None for it for the same reason).
            # The previous code referenced a bare `AdminProfile`
            # name that was never imported or defined, so ANY admin
            # PATCH containing full_name raised NameError → raw 500.
            # An admin's full_name is now simply ignored (same as
            # every other field with no table behind it), and the
            # request still returns 200 with the full user below.
            # .filter(user=user).update(...) — a direct, one-step
            # database update, different from the serializer.save()
            # pattern above but reaches the same result: no need to
            # fetch the profile object first just to change one field.
            # A no-op when no profile row exists yet (a User created
            # directly via the manager, rather than through
            # register(), has none) — that must not 500 either.
            # Deliberately no get-or-create: profile full_name columns
            # are required with no default, so inventing a row would
            # mean guessing required data. The row genuinely has to
            # exist first (register() always creates it).

        if user.role == User.Role.RENTER:
            if renter_updates:
                RenterProfile.objects.filter(user=user).update(**renter_updates)
                # Same no-op-if-missing reasoning as full_name above.

            if amenities_to_set is not None:
                profile = RenterProfile.objects.filter(user=user).first()
                # .first() (not .get()) — returns None instead of
                # raising when the row is missing, keeping the
                # missing-profile no-op behavior. .get() would 500
                # here for a profile-less user.
                if profile is not None:
                    profile.amenity_preferences.set(amenities_to_set)

        elif user.role == User.Role.LANDLORD:
            preferred_payout_method = request.data.get('preferred_payout_method')
            if preferred_payout_method is not None:
                LandlordProfile.objects.filter(user=user).update(
                    preferred_payout_method=preferred_payout_method
                )
                # Already choice-validated above; same no-op-if-missing
                # reasoning as the renter branch.

        return Response(UserSerializer(user).data)
        # Return the FULL updated user (via UserSerializer, the
        # existing read-only one) so the frontend immediately has
        # the fresh state, without needing a separate GET afterward.
        # UserSerializer.get_profile re-queries the profile tables, so
        # the .filter().update() writes above are reflected here even
        # though they bypassed the in-memory instances.

    serializer = UserSerializer(user)
    # request.user — this is new: DRF's JWTAuthentication (which we
    # configured way back in DEFAULT_AUTHENTICATION_CLASSES) already ran
    # BEFORE this function even started, decoded the token, looked up the
    # matching User row, and attached it here automatically.
    # We never manually look this up — it's just already there, ready to use

    return Response(serializer.data)
    # Return a safe subset of the logged-in user's own data —
    # never the password, even hashed


@api_view(['POST'])
# Decorator applied to the function right below it — this line configures
# the function as an API view that only accepts POST requests
# (signup is an action that CREATES something, so POST is the correct verb —
# same REST convention you'd already follow in a Next.js API route)

@throttle_classes([ScopedRateThrottle])
# Overrides the global DEFAULT_THROTTLE_CLASSES for THIS view specifically
# — register gets ONLY the scoped limit below, not the generic anon/user
# ones on top of it (which would just add redundant, looser limits)

def register(request: Request) -> Response:
    serializer = RegisterSerializer(data=request.data)
    # Hand the incoming request body to the Serializer we wrote.
    # data=... = "here's the raw data, please validate it against your rules"
    # Nothing has been validated or saved yet at this point — just handed over

    if serializer.is_valid():
        # Runs all the validation rules we defined (and DRF's built-in ones,
        # like checking email is unique and properly formatted)
        # Returns True only if everything passes

        user = serializer.save()
        # This is what actually triggers our overridden create() method —
        # this is the line that hashes the password, creates the User,
        # AND creates the matching profile row, all in one call

        try:
            send_verification_email(user)
        except Exception:
            # A failed verification email (Resend sandbox restrictions,
            # a provider outage, a malformed address) must NEVER sink
            # the whole signup — the User + profile row above are
            # already safely committed to the database at this point.
            # Without this try/except, an email-sending failure raises
            # all the way up and Django returns a raw 500 error page —
            # a real user would see "Server Error" despite their
            # account having actually been created successfully.
            logger.exception(
                "Failed to send verification email to %s (user id %s) — "
                "account was still created successfully.",
                user.email, user.id,
            )
            # logger.exception (not just logger.error) automatically
            # includes the full traceback in the log output, so this
            # is still fully debuggable later even though it no longer
            # crashes the request

        return Response(
            {'id': user.id, 'email': user.email, 'role': user.role},
            status=status.HTTP_201_CREATED
        )
        # Send back a JSON response confirming success.
        # 201 Created = the correct HTTP status for "something new was made"
        # We deliberately return only safe fields here — never the password,
        # even hashed

    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    # If validation failed, send back exactly what went wrong
    # (e.g. {"email": ["This field is required."]}) so the frontend can
    # show the right error message. 400 = the request itself was invalid.

register.throttle_scope = 'register'
# ScopedRateThrottle looks for a `throttle_scope` attribute on the view
# function to know WHICH rate from DEFAULT_THROTTLE_RATES to apply —
# matches the 'register': '5/min' entry in settings.py. Set ONCE here,
# right after the function is defined (not inside the function body,
# which would just re-set the same value on every single request —
# harmless but wasteful and not the idiomatic pattern)

@api_view(['POST'])
@throttle_classes([ScopedRateThrottle])
def google_login(request):
    # A new endpoint, same @api_view pattern as `register`
    token = request.data.get('token')
    # Pull the Google ID token out of the request body — the frontend
    # will send it as {"token": "..."} once that part exists
    if not token:
        return Response({'error': 'No token provided'}, status=status.HTTP_400_BAD_REQUEST)
        # Guard clause — reject immediately if nothing was sent at all
    try:
        idinfo = id_token.verify_oauth2_token(
            token, google_requests.Request(), config('GOOGLE_CLIENT_ID')
        )
        # This is the actual security-critical line — asks Google's library
        # to check three things at once:
        # 1. Is this token's signature genuinely valid (really came from Google)?
        # 2. Has it not expired?
        # 3. Was it issued specifically for OUR app (matches GOOGLE_CLIENT_ID)?
        # If all three pass, idinfo becomes a dict of the verified data
        # (email, name, etc.) pulled out of the token
    except ValueError:
        # If verification fails for any reason (tampered, expired, wrong
        # app, garbage input), Google's library raises ValueError
        return Response({'error': 'Invalid Google token'}, status=status.HTTP_400_BAD_REQUEST)
        # Reject the request — never trust an unverifiable token
        
    first_name = idinfo.get('given_name', '')
    last_name = idinfo.get('family_name', '')
    email = idinfo['email']
    # Now safe to trust this — it's been cryptographically verified as
    # genuinely coming from Google, for a real Google account
    role = request.data.get('role', User.Role.RENTER)
    # Google doesn't know about our renter/landlord distinction — the
    # frontend needs to tell us which one this signup is for.
    # Defaults to renter if not specified (e.g. if this account already
    # exists and role doesn't matter for a login, only a first-time signup)
    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            'role': role,
            'first_name': first_name,
            'last_name': last_name,
            }
    )
    # get_or_create = look for a User with this email; if found, return it
    # (created=False); if NOT found, create a new one using the `defaults`
    # dict and return that instead (created=True)
    # This single line handles BOTH "first time signing in with Google"
    # and "signing in again later" without us writing two separate paths
    if created:
        user.sign_in_method = User.SignInMethod.GOOGLE
        # Record how this account was created — only set once, at creation

        user.oauth_data = idinfo
        # Snapshot everything Google gave us at this exact moment —
        # written once here, never touched again on future logins

        user.is_verified = True
        # Google already proved this email is real and owned by this person —
# no need for our own email verification flow on top of that

        picture_url = idinfo.get('picture')
        if picture_url:
            response = requests.get(picture_url)
            if response.status_code == 200:
                user.profile_image.save(f"{user.id}_google.jpg", ContentFile(response.content), save=False)

        user.save()
        # sign_in_method and oauth_data were set on the Python object above,
        # but nothing is written to the database until save() is called


        if role == User.Role.RENTER:
            RenterProfile.objects.create(user=user, full_name=idinfo.get('name', ''))
        elif role == User.Role.LANDLORD:
            LandlordProfile.objects.create(user=user, full_name=idinfo.get('name', ''))

    refresh = RefreshToken.for_user(user)
    # Manually generate a token pair for this user — same underlying
    # mechanism TokenObtainPairView uses internally, just triggered
    # by us directly instead of by a password check
    return Response({
        'refresh': str(refresh),
        'access': str(refresh.access_token),
        'email': user.email,
        'role': user.role,
    })
    # Same shape of response as normal login — the frontend doesn't need
    # to treat Google login any differently once it gets this back

google_login.throttle_scope = 'login'
# Same login-attempt abuse concern as password login — 'login' scope
# (5/min) applies here too, since this is also fundamentally "someone
# trying to authenticate," just via a different mechanism

@api_view(['POST'])
def logout(request):
    # Logout is a POST because it's an action that changes server state
    # (marking a token as revoked), not just reading data — same REST
    # convention as register/login

    try:
        refresh_token = request.data.get('refresh')
        # The frontend sends back the refresh token it currently holds —
        # this is the one we're going to revoke

        token = RefreshToken(refresh_token)
        # Wrap the raw token string in SimpleJWT's RefreshToken class,
        # which knows how to validate and manipulate it

        token.blacklist()
        # This is the actual revocation — SimpleJWT writes a record into
        # the blacklist app's database table, marking this specific token
        # as no longer usable. Any future attempt to use it (e.g. to get
        # a new access token via /login/refresh/) will now be rejected

        return Response(status=status.HTTP_205_RESET_CONTENT)
        # 205 = a real HTTP status meaning "success, and the client should
        # reset whatever it was displaying" — commonly used for logout
        # specifically, since the frontend should now clear its stored
        # tokens and show a logged-out state

    except Exception:
        return Response(status=status.HTTP_400_BAD_REQUEST)
        # Covers cases like: token already blacklisted, malformed token,
        # or missing 'refresh' in the request body — all just result in
        # a generic 400, we don't need to distinguish the exact reason here

email_verification_token = PasswordResetTokenGenerator()
# One shared instance of the token generator, reused for every user —
# it doesn't store anything itself, it just knows HOW to generate/check
# tokens based on a user's current data (see below)

def send_verification_email(user):
    # A plain helper function (no @api_view — not a URL endpoint itself,
    # just a reusable piece of logic called FROM a view)
    token = email_verification_token.make_token(user)
    # Generates a token that's cryptographically tied to this specific
    # user AND their current state (e.g. their password hash) — meaning
    # if the password changes, old tokens automatically stop being valid,
    # without us needing to track expiry ourselves
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    # Encode the user's primary key (id) into a safe string we can put
    # in a URL — force_bytes converts it to bytes first, which the
    # encoder requires
    verification_link = f"http://localhost:3000/verify-email?uid={uid}&token={token}"
    # The link we're emailing — points at the FRONTEND (Next.js), which
    # will read these two values and send them on to our Django endpoint.
    # The frontend itself doesn't verify anything — it just captures the
    # values from the URL and forwards them

    plain_text_body = f"Click here to verify your account: {verification_link}"
    # Kept as a genuine fallback — some email clients still render
    # plain text only, and having ONE isn't itself a spam signal.
    # The problem we're fixing is having ONLY this and nothing else.

    html_body = f"""
    <html>
      <body style="font-family: sans-serif; color: #1a1a1a;">
        <h2>Verify your paddy account</h2>
        <p>
          Thanks for signing up. Click the button below to verify your
          email address and activate your account.
        </p>
        <p>
          <a href="{verification_link}"
             style="display: inline-block; padding: 12px 24px;
                    background-color: #16a34a; color: #ffffff;
                    text-decoration: none; border-radius: 6px;">
            Verify my account
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">
          If the button doesn't work, copy and paste this link into your
          browser: {verification_link}
        </p>
      </body>
    </html>
    """
    # A real HTML alternative alongside the plain text — legitimate
    # transactional email (password resets, order confirmations, etc.)
    # is almost always sent this way. A bare plain-text-only email with
    # just one raw link and zero formatting is a pattern spam filters
    # associate heavily with phishing/low-effort spam, REGARDLESS of
    # how clean the sending domain's SPF/DKIM/DMARC setup is.

    email = EmailMultiAlternatives(
        subject='Verify your paddy account',
        body=plain_text_body,
        # EmailMultiAlternatives still needs a plain-text `body` as the
        # base message — attach_alternative() below adds the HTML
        # version ON TOP of it, rather than replacing it
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
        headers={
            "List-Unsubscribe": f"<mailto:{settings.DEFAULT_FROM_EMAIL}>",
            # Gmail's own bulk-sender guidelines specifically look for
            # this header, even on transactional mail — its ABSENCE is
            # itself a real signal used by spam classifiers, not just
            # a courtesy for marketing email
        },
    )
    email.attach_alternative(html_body, "text/html")
    # This is what actually makes it a multipart email (plain text +
    # HTML together) instead of a single, bare plain-text message
    email.send()
    # With EMAIL_BACKEND set to console, this prints the whole email
    # (including the link) straight to your terminal — good enough to
    # manually test the flow without a real inbox


@api_view(['POST'])
@throttle_classes([ScopedRateThrottle])
def verify_email(request: Request) -> Response:
    uid = request.data.get('uid')
    token = request.data.get('token')
    # Both values the frontend read out of the URL and forwarded to us

    try:
        user_id = urlsafe_base64_decode(uid).decode()
        user = User.objects.get(pk=user_id)
        # Reverse the encoding from step 2 to find which user this is for

    except (User.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'Invalid link'}, status=status.HTTP_400_BAD_REQUEST)
        # Covers a malformed uid, or a uid pointing at a user that no
        # longer exists

    if email_verification_token.check_token(user, token):
        # Verifies the token is genuinely valid for THIS user, and
        # hasn't been invalidated (e.g. by a password change since)

        user.is_verified = True
        user.save()
        return Response({'message': 'Email verified successfully'})

    return Response({'error': 'Invalid or expired token'}, status=status.HTTP_400_BAD_REQUEST)

verify_email.throttle_scope = 'sensitive'
# A real user might legitimately click an old/already-used verification
# link a couple of times by mistake — 'sensitive' (10/min) is a looser
# limit than login/register, while still blocking automated abuse
# attempts against this endpoint (e.g. trying to guess valid uid/token
# combinations)
