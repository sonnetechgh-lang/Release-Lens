# 0003. GitHub OAuth for sign-in, GitHub App for repository data

- Status: Accepted
- Date: 2026-10-18

## Context

Users need to sign in, and ReleaseLens needs read access to repositories, workflow runs, and webhooks. Options considered: local passwords, Microsoft Entra ID, GitHub OAuth; personal access tokens or a GitHub App for repository data.

## Decision

- **Sign-in:** GitHub OAuth, handled by the API. The browser holds only an httpOnly session cookie; GitHub tokens never reach the frontend.
- **Repository data:** a GitHub App with read-only permissions (Actions, Contents, Deployments, Metadata). It provides signed webhooks and short-lived installation tokens.
- Self-hosters create their own GitHub App from a manifest shipped in the repository.

## Consequences

- No password storage, reset flows, or MFA to build.
- Users must have a GitHub account. Acceptable, because the tool is built around GitHub.
- Permissions are per-installation and revocable from GitHub, which supports least privilege.
- Entra ID sign-in can be added later without changing the repository integration.
