# Threat model, privacy, and release gates

Date: 2026-09-27. Scope: local sandbox; this document does not assert legal compliance.

| Threat | Present mitigation | Production gap |
|---|---|---|
| Cross-tenant read/write | Server-side org scope, role checks; separate advertiser test for report, finance, invoice, conversion | Multi-org memberships, RLS, asset/download/search/webhook tests |
| Account takeover | 32-byte random session token, SHA-256 token hash at rest, HttpOnly SameSite cookie, 8-hour expiry; sandbox conversion keys are hash-stored, scoped and expire after 30 days | Demo login is passwordless; production auth, MFA, key rotation/revocation UI, abuse controls |
| CSRF | SameSite=Strict and Origin comparison when present | Strict CSRF token and trusted proxy/host configuration |
| Open redirect | Opaque token, HTTPS destination, exact hostname allowlist, no URL credentials | Branded-domain governance, destination changes with audit, malware scanning |
| SQL injection | Prepared statements for values; fixed server-selected query fragments | External review and fuzzing |
| Stored XSS | UI escapes interpolated data; restrictive CSP | Creative isolation, HTML sanitization, CSP review, upload scanning |
| SSRF | API does not fetch supplied URLs | Safe scanning service required before landing checks |
| Click fraud/prefetch | HEAD excluded and common bot hints filtered | Robust invalid traffic classification, appeal, rate limits, anomaly detection |
| Forged provider callback | No live callbacks | Signature, timestamp, replay, event ordering, idempotency per provider |
| Duplicate settlement/overspend | Transactional booking, state transitions, unique ledger reference/account, balanced postings | PostgreSQL concurrency/load validation, payment reconciliation, payout controls |
| Credential leak | No live provider credentials in app | Secret manager, rotation, least privilege, audit and redaction |
| Data exfiltration | No publisher audience export; SMS sandbox stores a keyed contact digest and content hash, not raw destination/body | Demo default digest key must be replaced; data rights, retention enforcement, encryption, export controls |

## Privacy and retention policy proposal

Publisher-owned audiences are separate from advertiser-owned permitted contacts. No publisher subscriber list is transferred through this sandbox. Tracking clicks have no raw phone/email/subject ID, and IP is not written to the event table. The SMS sandbox stores a keyed digest of an advertiser-entered destination, permission proof text/source, and a message content hash; the default digest key is for local tests only. Demo SQLite also contains organization names, user emails, bookings, proof URLs, and event metadata; the seed identities are fictional. Delete the demo database/volume when done. Production retention periods, lawful bases, deletion exceptions for financial records, suppression retention, data subject export/delete flows, and regional rules require market-specific legal review. Do not infer a person from a click, view, IP, or forwarded link.

## Release gates not yet met

Production identity and MFA; PostgreSQL migration with tenant keys/RLS tests; persistent consent and suppression ledger; official provider access, callbacks and reconciliation; payment ledger/provider reconciliation; queue worker and recovery; rate limits; audit immutability/backup restore; vulnerability scan; accessibility audit; load/latency benchmark; incident response and on-call readiness. Keep `DEMO_MODE=true` bound to loopback only.
