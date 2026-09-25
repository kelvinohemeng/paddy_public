from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework.throttling import ScopedRateThrottle
from . import views


class ThrottledTokenObtainPairView(TokenObtainPairView):
    # SimpleJWT's TokenObtainPairView is a class-based view we didn't
    # write ourselves, so we can't add a `throttle_scope` line inside its
    # body the way we did for our own function-based views above.
    # Subclassing it lets us add JUST the throttle config on top,
    # without needing to reimplement any of SimpleJWT's actual login
    # logic (password checking, token generation, etc.) — we're not
    # overriding any behavior, only attaching throttle settings

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'
    # This is the actual password-login endpoint — the single most
    # attractive target for a brute-force/credential-stuffing attack
    # against real user accounts, so it gets the strict 'login' scope
    # (5/min per IP) just like register does


urlpatterns = [
    path('register/', views.register),
    path('login/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('login/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('login/google/', views.google_login, name='google_login'),
    path('logout/', views.logout, name='logout'),
    path('me/', views.me, name='me'),
    path('onboarding/', views.onboarding, name='onboarding'),
    path('verify-email/', views.verify_email, name='verify_email'),
    path('verify-email/resend/', views.resend_verification_email, name='resend_verification_email'),
    path('password-reset/', views.request_password_reset, name='password_reset_request'),
    path('password-reset/confirm/', views.confirm_password_reset, name='password_reset_confirm'),
]

