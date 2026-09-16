# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting instead: go to the **Security** tab of this
repository and click **Report a vulnerability**. You will get a response within 7 days, and a
fix or a documented decision within 30 days for confirmed issues.

If private reporting is unavailable, open an issue titled "Security contact request" without any
details and a private channel will be arranged.

## Supported versions

Only the latest published release receives security fixes.

## Supply-chain notes

- Releases are built and published by GitHub Actions from a `v*` tag; the tag can only be created by
  the repository admin. No maintainer publishes from a local machine.
- Every published package carries npm provenance linking it to the exact commit and workflow run.
- GitHub Actions used by this repository are pinned to commit SHAs, and Dependabot proposes updates
  after a 7-day cooldown.
