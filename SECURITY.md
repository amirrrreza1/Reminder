# Security policy

Reminder stores personal schedules and can send external messages using privileged provider credentials. Security reports are welcome and should be handled privately.

## Supported versions

Before the first release, only the current default branch receives fixes. After releases begin:

| Version                        | Supported                                 |
| ------------------------------ | ----------------------------------------- |
| Latest minor release           | Yes                                       |
| Previous minor release         | Critical fixes for 90 days when practical |
| Older releases                 | No                                        |
| Unreleased forks/custom images | No project guarantee                      |

Release notes may extend support for a specific version. Self-hosters should subscribe to releases and keep container/base images current.

## Report a vulnerability

Use the repository’s **Security → Report a vulnerability** action, which opens a private GitHub vulnerability report. Maintainers must enable GitHub private vulnerability reporting before publishing `0.1.0`.

If that action is unexpectedly unavailable, open a public issue titled `Private security contact requested` with no vulnerability details, logs, URLs, credentials, or reproduction. A maintainer will establish a private channel. Do not demonstrate a vulnerability against an instance you do not own or have explicit permission to test.

Include privately:

- affected release/commit and deployment shape;
- vulnerability class and impact;
- minimal reproduction using synthetic data;
- required privileges/network position;
- whether secrets or personal content may be exposed;
- suggested mitigation if known;
- safe contact details and disclosure constraints.

Never include live bot tokens, SMTP/database credentials, destination identifiers, real reminders, or unredacted dumps. If a secret may have been exposed, rotate it first.

## Response targets

These are best-effort goals for a volunteer project:

- acknowledgement within 3 business days;
- initial triage/severity within 7 business days;
- status update at least every 14 days while active;
- coordinated disclosure after a fix/release is available, normally within 90 days;
- faster handling for actively exploited or critical issues.

The report may be declined when it is out of scope, not reproducible, or only restates a documented limitation. Reporters receive a concise explanation.

## Severity considerations

High-impact examples:

- remote unauthenticated mutation despite the documented trusted-network/proxy boundary;
- secret disclosure through client bundles, logs, health/API responses, images, or build layers;
- stored content injection in dashboard, email, or Telegram output;
- cross-origin request forgery causing reminder/provider-test mutations;
- SQL injection or broken record boundaries after future multi-user support;
- malicious migration/update path causing unexpected data loss;
- provider-test abuse that can message arbitrary recipients;
- backup/restore path traversal or command injection.

## Documented limitations that are not vulnerabilities by themselves

- The MVP has no built-in application authentication. Publishing it directly to the public internet contrary to deployment guidance is unsupported. A bypass of a supported proxy/auth configuration may still be a vulnerability in that integration.
- Delivery uses at-least-once attempts. A rare duplicate external message can occur if a provider accepts a send immediately before the worker loses the chance to persist the receipt.
- A Docker administrator or host root user can read container environment and database data.
- Reminder titles/descriptions and delivery metadata are not application-level encrypted at rest; deployment storage/database encryption is an operator concern in MVP.
- Denial of service requiring administrative access to the host/database is normally out of scope.

## Safe research rules

- Test only your own isolated instance with synthetic data and fake providers.
- Stop after demonstrating impact; do not access more data than needed.
- Do not degrade public/shared services, send unsolicited messages, phish, or use social engineering.
- Do not publish details before maintainers have had a reasonable opportunity to fix and coordinate.
- Delete securely any accidental personal data obtained during authorized testing.

The project will not pursue action against good-faith research that follows these rules and applicable law.

## Maintainer handling

Maintainers should:

1. move discussion into a private advisory;
2. preserve evidence without copying secrets into ordinary issues/chat;
3. assess affected versions and deployment preconditions;
4. create a private fix branch and regression tests;
5. review for variants across web, worker, provider, migration, image, and docs paths;
6. prepare patched releases, checksums/provenance, changelog, upgrade/rotation instructions, and advisory;
7. credit the reporter unless anonymity is requested;
8. request CVE assignment when appropriate.

## Secret incident response

If a token/password may be committed or logged:

1. rotate/revoke the credential immediately; deleting Git history alone is insufficient;
2. stop exposed services if abuse is ongoing;
3. identify image tags, logs, CI artifacts, caches, forks, and backups containing it;
4. replace/redact the source and purge artifacts where feasible;
5. review provider/database audit data for misuse;
6. notify affected operators with concrete rotation/upgrade steps;
7. add automated detection/regression coverage.

## Security release checklist

- [ ] Private vulnerability reporting is enabled.
- [ ] Dependency, secret, license, and image scans pass.
- [ ] Runtime image is non-root and contains only production artifacts.
- [ ] Client bundle/image history contain no environment secrets.
- [ ] CSP, security headers, origin/CSRF, body limits, and proxy guidance are verified.
- [ ] Provider failures and logs are redaction-tested.
- [ ] Backup/restore and upgrade/rollback instructions are tested.
- [ ] Release notes identify security-impacting changes and necessary credential rotation.
