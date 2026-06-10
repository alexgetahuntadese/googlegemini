# Auto CI/CD DevOps Medic

A production-shaped prototype for the Google Cloud Rapid Agent Hackathon. DevOps Medic is a Gemini-powered GitLab partner-track agent that diagnoses failed pipelines, gathers evidence, drafts minimal patches, and prepares human-reviewable merge requests.

The app can run as a deterministic mock demo with no credentials. When GitLab and Gemini credentials are configured, it collects real GitLab CI evidence and asks Gemini to draft a recovery proposal while keeping repository mutation behind a human gate.

## Run Locally

For mock mode:

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

Run the production checks:

```powershell
npm run verify
```

`verify` runs syntax checks and a smoke test that starts the server, reads the health/setup/pipeline APIs, renders the app shell, and confirms private backend files are not exposed as static assets.

## Devpost Demo Script

1. Start the app with `npm start`.
2. Open `http://localhost:4173`.
3. Leave mock mode on for a deterministic demo, or connect a read-only GitLab token.
4. Select a failed pipeline and click **Run medic**.
5. Walk through the evidence trail: failed trace, mapped files, minimal patch, and human-gated MR summary.

The pitch: DevOps Medic shortens the "red CI to reviewed fix" loop without bypassing engineering control. The app collects evidence and drafts a repair path, but production mutation remains gated by policy, patch limits, and human approval.

## Build A 32-bit Windows Package

The app is JavaScript, so the package itself is architecture-neutral. For 32-bit Windows, run it with 32-bit Node.js.

```powershell
npm run build:win32
```

Output:

```text
dist/devops-medic-win32
dist/devops-medic-win32.zip
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

## Enable Gemini Patch Drafting

Add a Gemini API key to `.env`:

```text
GEMINI_MODEL=gemini-3-pro
GEMINI_API_KEY=your-key
```

With GitLab and Gemini configured, `/api/health` reports `gitlab-mcp-gemini`. Live investigations collect GitLab trace and file context, send that evidence to Gemini, and render the returned diagnosis, patch draft, validation plan, and merge request summary.

## Production Runbook

Set `NODE_ENV=production` and provide secrets through your platform's secret manager, not committed files. In production, the server adds security headers, rejects unverified GitLab webhooks when `GITLAB_WEBHOOK_TOKEN` is absent, limits API traffic per client, applies request/body timeouts, and shuts down gracefully on `SIGTERM`/`SIGINT`.

Runtime repository setup is disabled by default in production. Set `ALLOW_RUNTIME_SETUP=true` only when the deployment is protected behind authentication and you intentionally want browser-entered GitLab credentials for the demo.

Recommended deployment checks:

```powershell
npm run verify
```

Useful runtime settings:

```text
PORT=4173
API_RATE_LIMIT_PER_MINUTE=120
BODY_LIMIT_BYTES=1000000
REQUEST_TIMEOUT_MS=30000
SHUTDOWN_GRACE_MS=10000
ALLOW_RUNTIME_SETUP=false
```

Static hosting is intentionally whitelisted to `index.html`, `styles.css`, and `app.js`; backend files such as `server.js`, `package.json`, and scripts are not served.

## What Is Implemented

- Backend API boundary for pipeline data and investigations
- Static dashboard served by Node
- Mock mode when GitLab credentials are absent
- Live GitLab read-only mode when `GITLAB_TOKEN` and `GITLAB_PROJECT_ID` are set
- Optional Gemini patch drafting when `GEMINI_API_KEY` is set
- Failed pipeline discovery from GitLab
- Failed job trace retrieval from GitLab
- Merge request lookup by source branch
- Repository file reads for files detected in traces or MR changes
- Webhook endpoint with optional GitLab token verification
- Audit event capture in memory
- Human approval state in the MR panel
- Agent safety policy in `AGENT_POLICY.md`
- MIT license for public Devpost judging

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

The current live integration is intentionally human-gated. Next production steps:

1. Adapt the GitLab API boundary to the official GitLab MCP server transport used in the final Google Cloud Agent Builder deployment.
2. Apply Gemini's patch in an isolated workspace.
3. Run validation.
4. Create a hotfix branch and merge request after human approval.
5. Store investigations and audit events in PostgreSQL.

Use a secret manager for `GITLAB_WEBHOOK_TOKEN`, GitLab access tokens, and Gemini credentials.
