# DevOps Medic Agent Policy

This policy defines the safety boundary for the production agent.

## Evidence Requirements

The agent must not draft a patch until it has fetched:

- failed pipeline metadata
- failed job raw trace
- source files named in the stack trace
- related test files when available
- merge request diff or latest branch diff

## Mutation Boundary

The agent must never push directly to `main`, `master`, `production`, or any protected branch.

Allowed mutation path:

1. Create a branch named `devops-medic/patch-pipeline-<pipeline_id>`.
2. Apply a minimal patch.
3. Run validation in an isolated workspace.
4. Create a merge request that requires human review.

## Patch Limits

Default production limits:

- maximum changed files: 3
- maximum patch size: 12 KB
- no secret files
- no credential, token, or environment variable rewrites
- no deployment configuration changes unless explicitly approved

## Audit Requirements

Every investigation must record:

- trigger source
- project and pipeline ID
- job ID and trace hash
- files read
- patch generated
- validation result
- merge request URL or failure reason
- human approval status

## Human Gate

Human approval is required before:

- opening a merge request in production mode
- retrying a failed pipeline
- commenting on a user merge request
- modifying CI/CD configuration
- touching database migrations
