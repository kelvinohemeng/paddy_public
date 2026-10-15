"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    # From the ADMIN_URL env var, default 'admin/' (see settings.py).
    path('accounts/', include('accounts.urls')),
    path('listings/', include('listings.urls')),
    path('viewings/', include('viewings.urls')),
    path('payments/', include('payments.urls')),
    path('leases/', include('leases.urls')),
    path('core/', include('core.urls'))
]

# No local media route. There used to be one for DEBUG
# (`static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)`), but
# uploads go to R2 in every environment, so it served nothing useful, and
# with MEDIA_URL/MEDIA_ROOT unset it became "serve any file from the
# backend folder": /.env included, with every secret in it.