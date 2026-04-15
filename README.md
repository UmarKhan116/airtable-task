# Airtable Integration Platform

A full-stack monorepo application for syncing Airtable data, scraping revision history, and visualizing it through an AG Grid-powered dashboard.

## Architecture

```
air-table/
├── backend/          # Node.js 22 + Express + TypeScript API
├── frontend/         # Angular 19 standalone app
├── package.json      # Root workspace
└── .env.example      # Environment variable template
```

## Prerequisites

- Node.js v22+
- MongoDB 7+
- npm v10+

## Quick Start

### 1. Clone and install dependencies

```bash
cd air-table
npm install
```

### 2. Configure environment variables

```bash
cp .env.example backend/.env
# Edit backend/.env with your values
```

### 3. Start development servers

```bash
# Start both frontend and backend
npm run dev

# Or individually
npm run start:backend
npm run start:frontend
```

## Backend (Port 3000)

REST API built with Express + TypeScript. See `backend/README.md` for details.

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/airtable` | Initiate Airtable OAuth |
| GET | `/api/auth/callback` | OAuth callback |
| POST | `/api/airtable/sync` | Sync all Airtable data |
| POST | `/api/scraping/session/init` | Start Puppeteer login |
| POST | `/api/scraping/session/mfa` | Submit MFA code |
| POST | `/api/scraping/revisions/sync` | Sync revision history |
| GET | `/api/data/collections` | List MongoDB collections |
| GET | `/api/data/:collection` | Fetch collection data |

## Frontend (Port 4200)

Angular 19 with AG Grid v33 and Angular Material.

## Security

- All secrets stored in `.env` (never committed)
- AES-256 encryption for stored Airtable credentials
- Helmet + CORS + rate limiting on all routes
- OAuth 2.0 PKCE-like state parameter (CSRF protection)
- JWT-based session management

## MongoDB Collections

| Collection | Description |
|------------|-------------|
| `oauth_tokens` | Airtable OAuth access/refresh tokens |
| `airtable_sessions` | Puppeteer-extracted session cookies |
| `bases` | Airtable base metadata |
| `tables` | Airtable table metadata |
| `tickets` | All synced Airtable records |
| `revision_history` | Parsed assignee/status change history |
