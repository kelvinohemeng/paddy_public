from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from . import views

urlpatterns = [
    path('register/', views.register),
    path('login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('login/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('login/google/', views.google_login, name='google_login'),
    path('logout/', views.logout, name='logout'),
    path('me/', views.me, name='me'),
    path('verify-email/', views.verify_email, name='verify_email'),
]

