from django.urls import path
from . import views

urlpatterns = [
    path('subscribe/', views.initiate_subscription, name='initiate_subscription'),
    path('subscription/', views.my_subscription, name='my_subscription'),
    path('webhook/', views.paystack_webhook, name='paystack_webhook'),
]
