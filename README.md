# Auto CI/CD DevOps Medic

A production-shaped prototype for an agent that diagnoses failed GitLab pipelines, gathers evidence, drafts minimal patches, and prepares human-reviewable merge requests.

## Run Locally

For mock mode:

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

## Connect To GitLab

Create a `.env` file from `.env.example` and set:

```text
GITLAB_BASE_URL=https://gitlab.com
GITLAB_PROJECT_ID=12345678
GITLAB_TOKEN=glpat-your-token
GITLAB_WEBHOOK_TOKEN=optional-shared-webhook-secret
```

Token scope for the current app can be read-only:

```text
read_api
read_repository
```

Restart the server:

```powershell
node server.js
```

When configured, the app switches from mock mode to `gitlab-live-readonly`.

## Production Runbook

Set `NODE_ENV=production` and provide secrets through your platform's secret manager, not committed files. In production, the server adds security headers, rejects unverified GitLab webhooks when `GITLAB_WEBHOOK_TOKEN` is absent, limits API traffic per client, applies request/body timeouts, and shuts down gracefully on `SIGTERM`/`SIGINT`.

Recommended deployment checks:

```powershell
npm run check
npm run smoke
```

Useful runtime settings:

```text
PORT=4173
API_RATE_LIMIT_PER_MINUTE=120
BODY_LIMIT_BYTES=1000000
REQUEST_TIMEOUT_MS=30000
SHUTDOWN_GRACE_MS=10000
```

## What Is Implemented

- Backend API boundary for pipeline data and investigations
- Static dashboard served by Node
- Mock mode when GitLab credentials are absent
- Live GitLab read-only mode when `GITLAB_TOKEN` and `GITLAB_PROJECT_ID` are set
- Failed pipeline discovery from GitLab
- Failed job trace retrieval from GitLab
- Merge request lookup by source branch
- Repository file reads for files detected in traces or MR changes
- Webhook endpoint with optional GitLab token verification
- Audit event capture in memory
- Human approval state in the MR panel
- Agent safety policy in `AGENT_POLICY.md`

## API

```text
GET  /api/health
GET  /api/pipelines
POST /api/investigations/:pipelineId/run
GET  /api/investigations
GET  /api/audit
POST /webhooks/gitlab
```

## Production Next Steps

The current live integration is intentionally read-only. Next production steps:

1. Send trace, MR diff, and fetched file context to Gemini.
2. Generate a minimal patch proposal.
3. Apply the patch in an isolated workspace.
4. Run validation.
5. Create a hotfix branch and merge request after human approval.
6. Store investigations and audit events in PostgreSQL.

Use a secret manager for `GITLAB_WEBHOOK_TOKEN`, GitLab access tokens, and Gemini credentials.
