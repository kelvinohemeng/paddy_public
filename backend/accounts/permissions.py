from rest_framework.exceptions import PermissionDenied


EMAIL_NOT_VERIFIED_CODE = 'email_not_verified'
# A short, stable, machine-readable label sent alongside the human
# message. The frontend checks for THIS string (never the wording of the
# message, which we may reword later) to decide to show its "verify your
# email / resend link" prompt instead of a generic error toast.


def require_verified_email(user, action_description):
    # ONE shared gate for "you must verify your email before doing this".
    # Kelvin's 2026-09 decision: paying (unlock or subscription), creating
    # a listing, and requesting a viewing all require a verified email.
    #
    # Why gate these at all? Each one either moves money, publishes
    # something the public sees, or sends an email/visit request to a
    # real person. Verifying the email first means we know the address
    # belongs to the person at the keyboard — so Paystack receipts,
    # viewing confirmations and landlord contact actually reach them, and
    # throwaway fake-address accounts can't spam landlords or staff.
    #
    # Why a plain function and not a DRF permission class? These checks
    # happen at specific moments inside views that already have other
    # rules (role checks, cap checks), and a function call reads top to
    # bottom in the view exactly where it applies — the "boring and
    # explicit" style AGENTS.md asks for in auth code.
    #
    # `action_description` (e.g. "request a viewing") only fills in the
    # message, so the person is told exactly what's blocked.
    if user.is_verified:
        return
        # Google sign-ins are marked verified at account creation (Google
        # already proved the address), and email sign-ups become verified
        # when they click the link — see accounts/views.py verify_email.

    raise PermissionDenied({
        'detail': f'Please verify your email address before you {action_description}.',
        'code': EMAIL_NOT_VERIFIED_CODE,
    })
    # PermissionDenied = DRF's built-in "403 Forbidden" exception. Raising
    # it anywhere inside a DRF view stops the view immediately and DRF
    # turns it into a 403 response for us. Passing a DICT (instead of a
    # plain string) makes the JSON body exactly
    #     {"detail": "...", "code": "email_not_verified"}
    # — "detail" is the key the frontend already reads for error
    # messages, and "code" is the machine-readable part described above.
