# AGENTS

## Repository Overview

This repository is a multi-package e-commerce project with three applications:

- `backend/`: Express API, MongoDB, multi-tenant support, AI-assisted product analysis, worker jobs, and environment-driven configuration.
- `admin/`: React admin frontend built with Webpack, Babel, Ant Design / MUI, and Redux.
- `website/`: React storefront frontend built with Webpack, Babel, MUI, Redux, and client-side shopping flows.

There is no root-level `package.json`; each package is managed independently.

## Key files and conventions

- `backend/package.json`: backend scripts, linting, testing, DB migration helpers, and env checks.
- `admin/package.json`: admin app development, build, lint, and format scripts.
- `website/package.json`: storefront development, build, lint, test, and format scripts.
- `backend/jest.env.js` and `website/jest.env.js`: the minimum environment the test suites need, so they run on a clean checkout. `backend/.env.development` is gitignored and is NOT required to run the tests.

## Important patterns for an AI coding agent

- The backend uses ES modules (`type: module`) with Babel support.
- Configuration is loaded via `dotenv` and `backend/config/env.js`.
- The backend includes worker processes and AI features; avoid changing secrets or environment values in the repo.
- Frontends use Webpack-based React apps, not CRA defaults; check `webpack.*.js` and package scripts before changing app startup.
- ESLint and Prettier are used in all packages; follow existing lint/format scripts.
- `.github/workflows/ci.yml` runs `npm ci`, lint, a build and the tests for each package on every PR. Run those same commands locally before pushing.
- `npm run lint` reports without changing files in all three packages; `npm run lint:fix` is the one that rewrites (frontends only).
- `prettier.config.cjs` is the single source of truth for formatting. Do NOT duplicate its options into the `prettier/prettier` rule in `eslint.config.js`: when those two disagree, `npm run format` and `npm run lint` undo each other's work.
- `.gitattributes` keeps every text file at LF in the repository. Do not commit CRLF.

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

## Agent behavior guidance

- Prefer editing within the package that owns the feature rather than creating cross-package changes without a clear need.
- When adding or changing shared behavior, verify if the change belongs in `backend/`, `admin/`, or `website/`.
- If a task involves environment configuration or secrets, mention that local `.env` files should not be committed.
- Use existing package scripts and README docs as authoritative sources for setup and runtime behavior.

## Useful references

- `backend/README.md`
- `backend/docs/SERVICES_AUDIT_2026-06-09.md`
