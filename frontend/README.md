# Frontend

UI control center for SWAGReviewer backend.

## Features in this MVP UI
- GitHub PAT connection via backend session
- Repository and PR selection from real GitHub API
- PR sync into backend snapshot
- Analysis job launch and status tracking
- Suggestions table with citations
- Publish (dry-run / real mode)
- Feedback voting (useful / not useful)
- Feedback analytics summary

## Run
```bash
cd frontend
npm install
npm run dev
```

Single-host launch (recommended for demo/testing):
```bash
cd backend
npm run single:run
```

## Env (optional)
Create `.env`:
```bash
VITE_BACKEND_BASE_URL=http://localhost:4000
VITE_API_SERVICE_TOKEN=
```

## Notes
- Keep GitHub token only in runtime memory; do not commit it.
- For production replace PAT flow with GitHub App/OAuth.
- If `VITE_BACKEND_BASE_URL` is not set, UI uses same-origin by default.
