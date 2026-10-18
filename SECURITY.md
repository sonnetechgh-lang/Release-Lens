# Security Policy

ReleaseLens handles integration credentials and deployment metadata, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting ("Report a vulnerability" under the repository's Security tab).

Include:

- A description of the issue and its impact
- Steps to reproduce, using synthetic data only
- Affected version or commit

You can expect an acknowledgement within 7 days. Please allow time for a fix before any public disclosure.

## Supported versions

Until v1.0, only the latest release on `main` receives security fixes.

## Scope

In scope: the ReleaseLens code in this repository, including webhook handling, credential storage, redaction, authorization, and health-check request handling (SSRF).

Out of scope: vulnerabilities in third-party services (GitHub, Azure) themselves, and issues that require an already-compromised host.
