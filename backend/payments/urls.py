from django.urls import path
from . import views

urlpatterns = [
    path('subscribe/', views.initiate_subscription, name='initiate_subscription'),
    path('subscription/', views.my_subscription, name='my_subscription'),
    path('unlock-listing/', views.initiate_listing_unlock, name='initiate_listing_unlock'),
    path('verify/', views.verify_payment, name='verify_payment'),
    path('webhook/', views.paystack_webhook, name='paystack_webhook'),
]
