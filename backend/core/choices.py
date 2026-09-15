from django.db import models

class Amenity(models.TextChoices):
        WATER_STORAGE = 'water_storage', 'Water Storage'
        BACKUP_POWER = 'backup_power', 'Backup Power'
        WALLED_GATED = 'walled_gated', 'Walled Gated'
        WIFI = 'wifi', 'Wifi'
        PARKING = 'parking', 'Parking'
        GYM = 'gym', 'Gym'
        SWIMMING_POOL = 'swimming_pool', 'Swimming Pool'
        FURNISHED = 'furnished', 'Furnished'
        AIR_CONDITIONING = 'air_conditioning', 'Air Conditioning'
        SECURITY = 'security', 'Security'
        MAINTENANCE = 'maintenance', 'Maintenance'