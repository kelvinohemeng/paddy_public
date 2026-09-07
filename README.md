# paddy

A curated, staff-verified long-term rental marketplace for Ghana's urban market (Accra/Kumasi).

See `AGENTS.md` for full architecture, business model, and conventions (canonical spec for
anyone — human or AI — working on this codebase).

## Structure

```
paddy/
├── AGENTS.md          # canonical project spec: business model, stack, conventions
├── frontend/          # Next.js (TypeScript, Tailwind, App Router) — public site + dashboards
├── backend/           # Django + DRF + GeoDjango — API, auth, admin (staff listing tool)
├── archive/           # superseded planning docs from an earlier iteration of this idea
├── *.dc.html          # UI concept references (still active visual direction)
└── ghana-rental-ui-concepts.html
```

## Getting started

### Backend (Django)

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows git-bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env            # then fill in real secrets
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Defaults to SQLite for zero-setup local dev. Set `DATABASE_ENGINE=postgis` in `.env` once
Postgres + PostGIS is available (see AGENTS.md for the Railway/self-host deploy plan) — that
also requires uncommenting `django.contrib.gis` in `config/settings.py`.

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

## Build priority

1. Discovery Hub (map + listing grid)
2. Property Detail page (photosphere tour, verification badges)
3. On-Site Pre-Checkout Review (staff-facing, Paystack Inline)
4. Renter Active Leases Dashboard
5. Auth Gateway, Renter CV form, Saved Homes
6. Landlord-facing dashboard — post-MVP (Django admin covers this for now)

Full detail in `AGENTS.md`.
