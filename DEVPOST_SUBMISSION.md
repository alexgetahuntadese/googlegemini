# Devpost Submission Notes

## Project

DevOps Medic is a Gemini-powered GitLab agent that shortens the path from red CI to a reviewed fix. It watches failed pipelines, gathers GitLab evidence, asks Gemini to draft the smallest safe recovery patch, and prepares a human-gated merge request summary.

## Track

GitLab partner track.

## Real-World Problem

Engineering teams lose time when failed CI jobs require manual log reading, source lookup, and merge request context switching. DevOps Medic turns that workflow into a supervised agent loop while preserving the engineer's final approval.

## Agent Workflow

1. Fetch recent failed GitLab pipelines.
2. Pull the failed job trace.
3. Map stack-trace paths and merge request changes to repository files.
4. Send the evidence bundle to Gemini for diagnosis and patch drafting when `GEMINI_API_KEY` is configured.
5. Prepare a merge request summary with failure, root cause, fix, validation, and safety controls.

## Partner Integration

The project uses GitLab as the partner system for pipeline, job trace, repository file, merge request, and webhook tools. The server exposes a guarded backend boundary so those tools can be run in live read-only mode or deterministic mock mode for judging.

## Safety Boundary

- No direct pushes to protected branches.
- Human approval required before production mutations.
- Patch limited to 3 files and 12 KB by default.
- Secret, credential, and deployment edits are disallowed by policy.
- Audit events record setup, webhook, and investigation actions.

## Demo Checklist

- Hosted project URL: add after deployment.
- Public repository URL: add after pushing the repo.
- Demo video URL: add after recording the 3 minute walkthrough.
- License: MIT, included in `LICENSE`.

## Three Minute Video Script

1. Open the app and show the GitLab partner track stack in the sidebar.
2. Show mock mode for a deterministic run, or connect a GitLab project with a read-only token.
3. Select a failed pipeline and run the medic.
4. Walk through trace collection, file mapping, Gemini patch drafting, and the human-gated merge request panel.
5. Close with the impact: faster CI recovery without bypassing engineering review.
