# Airtable Integration Backend

Node.js 22 + Express + TypeScript REST API.

## Setup

```bash
cp ../.env.example .env
# Fill in your values in .env
npm install
npm run dev
```

## Development

```bash
npm run dev    # ts-node-dev with hot reload (port 3000)
npm run build  # Compile TypeScript to dist/
npm run start  # Run compiled dist/app.js
```

## Configuration

All configuration is loaded from `.env`. Required variables:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | 64+ char secret for JWT signing |
| `AIRTABLE_CLIENT_ID` | OAuth app client ID from Airtable |
| `AIRTABLE_CLIENT_SECRET` | OAuth app client secret |
| `AIRTABLE_REDIRECT_URI` | Must match registered OAuth redirect URI |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256 encryption |

## API Routes

### Auth
- `GET /api/auth/airtable` — Start OAuth flow (or returns JSON with URL if `Accept: application/json`)
- `GET /api/auth/callback` — OAuth callback
- `GET /api/auth/status` — Token validity status
- `POST /api/auth/refresh` — Refresh access token *(requires JWT)*
- `DELETE /api/auth/logout` — Clear tokens *(requires JWT)*

### Airtable Sync
- `POST /api/airtable/sync` — Start full sync (async) *(requires JWT)*
- `GET /api/airtable/sync/status` — Poll sync status *(requires JWT)*
- `GET /api/airtable/bases` — Get synced bases *(requires JWT)*
- `GET /api/airtable/bases/:baseId/tables` — Get tables for a base *(requires JWT)*

### Scraping (Part B)
- `POST /api/scraping/session/init` — Launch Puppeteer, login to Airtable *(requires JWT)*
- `POST /api/scraping/session/mfa` — Submit MFA code *(requires JWT)*
- `GET /api/scraping/session/status` — Cookie validity *(requires JWT)*
- `DELETE /api/scraping/session` — Invalidate session *(requires JWT)*
- `POST /api/scraping/revisions/sync` — Start revision history sync *(requires JWT)*
- `GET /api/scraping/revisions/status` — Poll revision sync status *(requires JWT)*

### Data
- `GET /api/data/collections` — List available MongoDB collections *(requires JWT)*
- `GET /api/data/:collection/schema` — Inferred field schema for AG Grid columns *(requires JWT)*
- `GET /api/data/:collection` — Paginated, filtered, sorted data *(requires JWT)*

## Architecture

```
src/
├── config/         — DB, environment validation, Airtable config
├── controllers/    — Request handlers (thin, delegate to services)
├── services/       — Business logic
├── models/         — Mongoose schemas
├── routes/         — Express route definitions
├── middleware/     — Auth (JWT), error handler, rate limiter
└── utils/          — Logger, encryption, HTML parser, pagination
```
