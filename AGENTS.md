# AGENTS

## Repository Overview

This repository is a multi-package e-commerce project with three main applications plus a product image worker:

- `backend/`: Express API, MongoDB, multi-tenant support, AI-assisted product analysis, worker jobs, and environment-driven configuration.
- `admin/`: React admin frontend built with Webpack, Babel, Ant Design / MUI, and Redux.
- `website/`: React storefront frontend built with Webpack, Babel, MUI, Redux, and client-side shopping flows.
- `agent-image-watcher/`: standalone image ingestion worker for visual product analysis, with its own env config and backend integration.

There is no root-level `package.json`; each package is managed independently.

## Key files and conventions

- `backend/package.json`: backend scripts, linting, testing, DB migration helpers, and env checks.
- `admin/package.json`: admin app development, build, lint, and format scripts.
- `website/package.json`: storefront development, build, lint, test, and format scripts.
- `backend/.env.development`: example of multi-tenant AI / Gemini configuration, CORS, cookies, security, and payment settings.
- `agent-image-watcher/README.md`: operational details for the image watcher worker.

## Important patterns for an AI coding agent

- The backend uses ES modules (`type: module`) with Babel support.
- Configuration is loaded via `dotenv` and `backend/config/env.js`.
- The backend includes worker processes and AI features; avoid changing secrets or environment values in the repo.
- Frontends use Webpack-based React apps, not CRA defaults; check `webpack.*.js` and package scripts before changing app startup.
- ESLint and Prettier are used in all packages; follow existing lint/format scripts.

## Recommended package commands

### Backend

```bash
cd backend
npm install
npm run dev
npm run lint
npm run test
```

### Admin frontend

```bash
cd admin
npm install
npm run dev
npm run lint
npm run format
```

### Website storefront

```bash
cd website
npm install
npm run dev
npm run lint
npm run test
```

### Image watcher agent

```bash
cd agent-image-watcher
npm install
# follow README instructions for .env setup and worker execution
```

## Agent behavior guidance

- Prefer editing within the package that owns the feature rather than creating cross-package changes without a clear need.
- When adding or changing shared behavior, verify if the change belongs in `backend/`, `admin/`, or `website/`.
- If a task involves environment configuration or secrets, mention that local `.env` files should not be committed.
- Use existing package scripts and README docs as authoritative sources for setup and runtime behavior.

## Useful references

- `backend/README.md`
- `backend/docs/SERVICES_AUDIT_2026-06-09.md`
- `agent-image-watcher/README.md`
