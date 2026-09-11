from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
# BaseUserManager = Django's base class for building a custom manager
# (a "manager" is the object behind User.objects — it handles creating new rows)


class UserManager(BaseUserManager):
    # Our own manager, replacing the default one that expects `username`

    def create_user(self, email, password=None, **extra_fields):
        # Called for every normal user creation (signup, admin-created accounts, etc.)
        # email, password = the two things we always require
        # **extra_fields = catches any other fields passed in (role, phone, etc.) as a dict

        if not email:
            raise ValueError('Users must have an email address')
            # Guard clause — refuse to create a user with no email,
            # since email is our login identifier (USERNAME_FIELD)

        email = self.normalize_email(email)
        # Built-in helper from BaseUserManager — lowercases the domain part of the
        # email (e.g. Example@GMAIL.com -> Example@gmail.com) to avoid duplicate
        # accounts that only differ by domain casing

        user = self.model(email=email, **extra_fields)
        # self.model = refers to whatever model this manager is attached to (our User)
        # Creates an in-memory User instance — NOT saved to the database yet
        # **extra_fields unpacks any extra passed-in fields (e.g. role='landlord') onto it

        user.set_password(password)
        # Hashes the raw password before storing it — NEVER save a plain text password.
        # This is what AbstractUser's built-in password field expects internally.

        user.save(using=self._db)
        # Actually writes the user to the database now.
        # using=self._db supports multi-database setups (not needed by us yet,
        # but it's the standard/safe way to write this method)

        return user
        # Hand back the created user object to whatever called this method

    def create_superuser(self, email, password=None, **extra_fields):
        # Called specifically by the `createsuperuser` CLI command

        extra_fields.setdefault('is_staff', True)
        # is_staff = Django's built-in flag controlling access to the admin panel.
        # setdefault = only sets it if not already provided — won't override an explicit value

        extra_fields.setdefault('is_superuser', True)
        # is_superuser = Django's built-in flag granting ALL permissions automatically

        extra_fields.setdefault('role', 'admin')
        # Our own custom field — ensures anyone created via createsuperuser
        # automatically gets role='admin' instead of silently defaulting to 'renter'

        return self.create_user(email, password, **extra_fields)
        # Reuses create_user above to avoid duplicating the email/password/save logic


class User(AbstractUser):
    username = None
    # Removes the inherited username field — we don't use it

    email = models.EmailField(unique=True)
    # Overrides AbstractUser's default email field to make it required + unique

    phone = models.CharField(max_length=20, blank=True)
    # New field, not in AbstractUser — optional (blank=True) short text

    class Role(models.TextChoices):
        # A namespaced set of valid role values (our version of a TypeScript union type)
        RENTER = 'renter', 'Renter'
        LANDLORD = 'landlord', 'Landlord'
        STAFF = 'staff', 'Staff'
        ADMIN = 'admin', 'Admin'

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.RENTER)
    # The actual role column, restricted to the 4 values above, defaults to 'renter'
    # for normal signups (our custom manager overrides this default for superusers)

    created_at = models.DateTimeField(auto_now_add=True)
    # Automatically set once, at creation time — never changes after that

    updated_at = models.DateTimeField(auto_now=True)
    # Automatically updated to "now" every time this row is saved

    is_verified = models.BooleanField(default=False)
    # Our custom verification flag — meaning depends on role (staff auto-true,
    # landlord verified by staff review, renter via KYC or unverified)

    class SignInMethod(models.TextChoices):
        # Same pattern as Role — a namespaced set of valid values
        EMAIL = 'email', 'Email'
        GOOGLE = 'google', 'Google'
        LINKEDIN = 'linkedin', 'LinkedIn'
        # Room to add more providers later without changing the field itself

    sign_in_method = models.CharField(
        max_length=20, choices=SignInMethod.choices, default=SignInMethod.EMAIL
    )
    # Tracks how this account was ORIGINALLY created — set once at signup,
    # not something that changes if they later also use another method

    oauth_data = models.JSONField(blank=True, null=True)
    # Stores a one-time snapshot of whatever the OAuth provider sent us at
    # first sign-in (name, picture, locale, etc.) — written once, never
    # overwritten afterward. Mainly useful as a debugging/audit trail,
    # not a live source of truth (full_name on the profile tables is that)
    #
    # blank=True + null=True together = genuinely optional at both the
    # form-validation level (blank) and the database level (null) — needed
    # together here since, unlike text fields, JSON has no natural "empty"
    # value the database can fall back to on its own


    USERNAME_FIELD = "email"
    # Tells Django's whole auth system: use `email` as the login identifier

    REQUIRED_FIELDS = []
    # Extra fields the `createsuperuser` CLI prompts for, beyond email + password
    # (empty here since role/phone aren't required at that step)

    objects = UserManager()
    # Tells Django to use OUR custom manager instead of the default one —
    # this is what actually fixes the createsuperuser error

class RenterProfile(models.Model):
    # Inherits from plain models.Model, NOT AbstractUser or User —
    # this is a separate table that references a User, not a kind of User

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    # OneToOneField = each row here pairs with exactly one row in User, and vice versa
    # (one renter has exactly one RenterProfile)
    # User = which table this links back to
    # on_delete=models.CASCADE = if the linked User is deleted, delete this
    # profile too automatically (an orphaned profile with no user is meaningless)

    full_name = models.CharField(max_length=150)
    # Plain short text field, required (no blank=True) — matches the ERD

    preferred_area = models.CharField(max_length=150, blank=True)
    # Plain short text field, optional — a renter may not have set this yet

    class Occupation(models.TextChoices):
        # A namespaced set of valid role values (our version of a TypeScript union type)
        STUDENT = 'student', 'Student'
        PROFESSIONAL = 'professional', 'Professional'
        UNEMPLOYED = 'unemployed', 'Unemployed'
        OTHER = 'other', 'Other'

    occupation = models.CharField(max_length=20, choices=Occupation.choices, default=Occupation.STUDENT)
    about_me = models.TextField(blank=True)

    def __str__(self):
        # __str__ = a special Python method every class can define, called
        # whenever something needs to display this object as text (Django
        # admin, print(), etc.) — without it, Python falls back to a generic
        # "object (id)" label, which is what you're seeing right now

        return self.full_name or self.user.email
        # Show the renter's name if they have one set, otherwise fall back
        # to their email — `or` here means "use the left side unless it's
        # empty/falsy, then use the right side instead"

class LandlordProfile(models.Model):
    # Same pattern as RenterProfile — a plain model that references User,
    # not a kind of User itself

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    # One landlord has exactly one LandlordProfile
    # CASCADE = delete this profile automatically if the linked User is deleted

    full_name = models.CharField(max_length=150)
    # Plain short text field, required — matches the ERD

    national_id_number = models.CharField(max_length=50)
    # Plain short text field — Ghana Card / national ID number, used for identity
    # verification. Required, since verification depends on having this on file.
    # Note: stored as CharField, not IntegerField — ID numbers often contain
    # letters/dashes and are never used in math, so text is the correct type
    # even though it looks like a "number"

    id_verified = models.BooleanField(default=False)
    # True/False flag — starts False, staff flips it to True after manually
    # checking the landlord's national ID during the verification process
    # (this is the field is_verified on User does NOT replace — this one is
    # specifically about ID document verification, a staff-driven workflow)

    momo_or_bank_details = models.CharField(max_length=255)
    # Plain text field — MoMo number or bank account details on file for
    # this landlord. NOTE: under the current pricing model (landlord
    # subscription fee, not commission), paddy no longer processes the
    # lease deposit at all, so this field is no longer used for Paystack
    # payout splitting — kept as general landlord contact/verification
    # info for now; revisit whether it's still needed once the
    # subscription-only payment model is fully built out

    def __str__(self):
        return self.full_name or self.user.email

class StaffProfile(models.Model):
    # Same pattern again — a plain model referencing User,
    # not a kind of User itself

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    # One staff member has exactly one StaffProfile
    # CASCADE = delete this profile automatically if the linked User is deleted

    full_name = models.CharField(max_length=150)
    # Plain short text field, required — matches the ERD

    can_approve_listings = models.BooleanField(default=False)
    # True/False permission flag — controls whether this staff member is
    # allowed to approve/reject landlord listings after an in-person visit.
    # Defaults to False — a new staff account starts with no special
    # permissions until explicitly granted by an admin

    can_host_viewings = models.BooleanField(default=False)
    # True/False permission flag — controls whether this staff member can be
    # assigned to host in-person property viewings for renters.
    # Also defaults to False for the same reason as above

    def __str__(self):
        return self.full_name or self.user.email


