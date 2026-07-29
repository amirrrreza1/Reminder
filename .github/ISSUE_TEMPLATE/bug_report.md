---
name: Bug report
about: Report reproducible behavior that differs from the specification
title: "bug: "
---

<!--
Do not include credentials, provider payloads, personal reminder content,
database dumps, or unredacted logs. Security vulnerabilities belong in the
private process described by SECURITY.md, not a public issue.
-->

## Summary

Describe the problem in one or two sentences.

## Specification reference

Requirement ID or documentation link, if known:

## Reproduction

Use synthetic data and provide the smallest reliable sequence:

1.
2.
3.

## Expected behavior

What should happen?

## Actual behavior

What happens instead?

## Environment

- Reminder release/commit:
- Deployment: Docker Compose / development
- Browser and version:
- Docker/Compose version:
- PostgreSQL major version:
- `APP_TIMEZONE` (not the whole environment):

## Safe evidence

Include only redacted screenshots/log events. Internal request, reminder, and delivery UUIDs are acceptable; recipient details, message bodies, URLs containing tokens, and secrets are not.

## Additional context

Anything else needed to reproduce or assess impact.
