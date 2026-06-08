# ITHAC Angular Web

This is the Angular vertical slice for the ITHAC web portal.

The goal is not to rebuild the whole mobile app in one pass. The goal is to prove that a modern Angular architecture can support ITHAC while keeping Xavier autonomous with Codex and Claude.

## Stack

- Angular 22
- Standalone components
- Strict TypeScript
- Strict Angular templates
- Angular Router
- Angular HttpClient with functional interceptors
- SignalR isolated in `core/realtime`
- Mock auth for the first autonomy slice

## Commands

```bash
npm install
npm start
npm run build
npm test
npm run generate:api
```

`npm start` runs on port `8080` because the inspected backend dev CORS config already includes `localhost:8080`. If the backend environment changes, update CORS or the local port intentionally.

## Current architecture

```text
src/app/
  core/
    api/
    auth/
    config/
    realtime/
  data-access/
    alerts/
    influencers/
    system/
  features/
    app-shell/
    auth/
    coin-analytics/
    influencers/
    legal/
    live-alerts/
    onboarding/
    settings/
    signal-detail/
```

## Current slice

- Public onboarding
- Mock login
- Protected `/app` routes
- Auth guard
- Bearer token interceptor
- API error interceptor with 401 handling
- Public `/health` call
- Mock Live Alerts feed
- Alert detail route
- Influencer list and protected influencer profile route
- SignalR service isolated behind `SignalrService`
- API type regeneration with `npm run generate:api`
- Local DTO names aligned with `API_CONTRACT_DTO_PROPOSAL.md`

## Open prerequisites

- Confirm production OpenAPI/Swagger URL.
- Generate frontend types from the backend contract.
- Confirm API CORS for the deployed web origin.
- Confirm SignalR CORS for the deployed web origin.
- Replace mock auth with Firebase Web or confirmed backend auth strategy.
- Decide web subscription source of truth.
