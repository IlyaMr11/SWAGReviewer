# Backend

Backend MVP for AI code review plugin.

## What is implemented now
- Frozen API contract for UI and RAG teams (`docs/openapi.v1.yaml`)
- GitHub token session contract for UI (`docs/openapi.github-session.v1.yaml`)
- Postgres schema v1 (`db/migrations/0001_init.sql`)
- ERD (`docs/erd.mmd`)
- Handoff docs and payload examples (`docs/handoff.md`, `docs/examples/*`)
- Runtime API skeleton for all public endpoints (in-memory adapter)
- Runtime GitHub session endpoints for PAT-based demo flow

## Runtime notes
- Current runtime uses in-memory store to unblock integration work.
- SQL schema is the source for production Postgres implementation.
- API shape and enums are aligned with OpenAPI contract.

## Scripts
```bash
cd backend
npm install
npm run dev
npm run typecheck
```

Single-host mode (backend + frontend on one host):
```bash
cd backend
npm run single:run
```
Then open `http://localhost:4000`.

## Auth
- If `API_SERVICE_TOKEN` is set, all endpoints except `/healthz`, `/readyz`, `/webhooks/github` require:
  - `Authorization: Bearer <token>`

## Contract files
- OpenAPI: `docs/openapi.v1.yaml`
- GitHub session OpenAPI: `docs/openapi.github-session.v1.yaml`
- SQL: `db/migrations/0001_init.sql`
- Handoff: `docs/handoff.md`
- Examples: `docs/examples/*.json`
- GitHub smoke test: `docs/github-smoke-test.md`
