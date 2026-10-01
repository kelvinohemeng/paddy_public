# paddy

A curated, staff-verified long-term rental marketplace for Ghana's urban market (Accra and Kumasi).
Every listing is visited and verified by the paddy team before it goes live.

> **Proprietary software.** This repository is public for reference only. All rights reserved;
> see [LICENSE](LICENSE). To report a security issue, see [SECURITY.md](SECURITY.md).

## Tech stack

| Part | Stack |
|---|---|
| Frontend | Next.js 16 (App Router, TypeScript), Tailwind CSS v4, shadcn/ui, TanStack Query, Storybook |
| Backend | Django 5 + Django REST Framework, GeoDjango, SimpleJWT auth |
| Database | PostgreSQL with the PostGIS extension |
| Services | Paystack (payments), Google Maps & Places, Google sign-in, Cloudflare R2 (media), Resend (email) |

## Repository layout

```
paddy/
├── backend/        # Django API, auth, payments, and the Django admin (staff tools)
│   ├── accounts/   #   users, roles, profiles, sign-up / sign-in / verification
│   ├── listings/   #   listings, photos, saved homes, staff review
│   ├── leases/     #   leases and lease records
│   ├── viewings/   #   in-person viewing requests
│   ├── payments/   #   Paystack subscriptions, pay-to-unlock, listing limits
│   └── core/       #   amenities, dev seed data
├── frontend/       # Next.js app: public Discovery Hub + role-based dashboards
└── figma-plugin/   # design-handoff Figma plugin
```

## Getting started (local development)

### Prerequisites

- **Python 3.11** and [pipenv](https://pipenv.pypa.io/)
- **PostgreSQL 16 with PostGIS**, plus GDAL (`gdal-bin` on Linux, OSGeo4W on Windows)
- **Node.js 20+**

### Backend

```bash
cd backend
pipenv install --dev
cp .env.example .env          # then fill in your own values
pipenv run python manage.py migrate
pipenv run python manage.py seed_dev_data   # optional demo data
pipenv run python manage.py createsuperuser
pipenv run python manage.py runserver
```

The API runs at `http://localhost:8000` and the Django admin at `http://localhost:8000/admin/`.
Every setting comes from `backend/.env`; see `backend/.env.example` for the full list.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local    # then fill in your own values
npm run dev
```

The app runs at `http://localhost:3000`. Storybook: `npm run storybook`.

## Tests

```bash
cd backend
pipenv run python manage.py check
pipenv run python manage.py test     # needs PostgreSQL + PostGIS
```

The `Backend CI` GitHub Actions workflow runs the same checks and tests against a PostGIS
database on every pull request.

## License

Copyright (c) 2026 Kelvin Ohemeng. All rights reserved. See [LICENSE](LICENSE).
