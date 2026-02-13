# Local Development

## Prerequisites

- Node.js installed (use the version already used by this monorepo)
- npm available

## Install and Run

From repository root:

```bash
npm install
npm run dev
```

## Environment Files

Frontend env selection depends on runtime mode:

- non-Docker dev (CRA): `apps/web/.env.development`
- Docker dev compose:
  - API: `.env.docker.api.dev`
  - Web: `.env.docker.web.dev`

If frontend still calls `localhost` unexpectedly, update the correct env file and restart.

## Frontend and API URLs

- frontend: `http://localhost:3000`
- API: `http://localhost:8080`

## Run Apps in Isolation

Frontend only:

```bash
cd apps/web
npm install
npm run dev
```

Backend only:

```bash
cd apps/api
npm install
npm test
npm run dev
```
