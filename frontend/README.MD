# paddy-dashboard

paddy — a curated, staff-verified long-term rental marketplace for Ghana.
Next.js frontend (server-rendered public discovery pages for SEO, client
dashboard) on a Django + PostGIS backend, Paystack payments, Cloudflare R2
storage.

## Getting Started

```bash
    npm install
    npm run dev
```

Requires `NEXT_PUBLIC_API_URL` (and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` for
maps) — see `.env`.

## Available Scripts

### Running the development server.

```bash
    npm run dev
```

### Building for production.

```bash
    npm run build
```

### Running the production server.

```bash
    npm run start
```

## Tech notes

- Server state via TanStack Query (`src/hooks/use-api.ts`, `src/hooks/use-auth.ts`)
  over a thin JSON client (`src/lib/api-client.ts`) with Bearer auth +
  silent refresh (`src/lib/api.ts`, `src/lib/auth-refresh.ts`).
- Auth is Django-owned (SimpleJWT); tokens live in cookies (server reads)
  and localStorage (client reads).
- Light theme only — no dark mode anywhere.

## License

MIT
