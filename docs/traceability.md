# Requirement traceability and actual verification

Legend: **Implemented and verified** = exercised by automated tests or rendered UI; **Sandbox partial** = runnable local behavior with stated gaps; **Contract only** = tested library primitive, not wired into product; **Blocked/unimplemented** = absent, with reason. No line below claims a live provider integration.

| Requirement area | Status | Evidence and remaining work |
|---|---|---|
| Repository baseline, gap analysis, decisions | Implemented and verified | `docs/prd.md`, `docs/architecture.md`; greenfield inventory recorded. |
| Local Compose, migration, seed | Sandbox partial | `compose.yaml`, SQLite migration/seed. Compose build/start and health endpoint verified; no PostgreSQL/Redis/S3. |
| Registration, MFA, SSO, multi-org RBAC, API keys, deletion/export | Sandbox partial | Loopback demo sessions, 3 fixed roles, and one-time sandbox conversion API keys. Production identity design and market rules required. |
| Tenant isolation | Sandbox partial | Scoped API/report/invoice/ledger and second-advertiser tests in `tests/journey.test.mjs`; no assets/search/webhook surfaces. |
| Property/SKU listing and manual review | Sandbox partial | Owner creates property/SKU; operator review; seeded newsletter. No ownership verification or media kits/calendar/negotiation. |
| Campaign builder, creative review and policy | Sandbox partial | Create, submit, approve, budget and destination allowlist; no creative upload/scanning/variants/agency chain. |
| Booking, acceptance, proof, dispute, settlement | Implemented and verified for simple sandbox path | `tests/journey.test.mjs`, `tests/ui_smoke.py`; no SLA, reschedule, make-good, partial refund or independent proof verification. |
| Tracked link and click | Sandbox partial | Opaque token, expiry, safe HTTPS destination, HEAD/bot filter, 302, tested. No branded domain, QR generator, SDK, durable retry or advanced fraud detection. |
| Conversion import and lifecycle | Sandbox partial | Session or scoped sandbox key, booking-scoped stage import, event time, consent claim, event-ID deduplication, test. No CRM/commerce connector or correction/reversal chain. |
| Identity evidence and attribution | Blocked/unimplemented | No deterministic identity links or attribution model; report states limitations. Requires consent and evidence model. |
| Reporting and provenance | Sandbox partial | Scoped clicks, qualified leads, booked amount with source/freshness and UI. No exports, cohorts, denominator-based rates or data warehouse. |
| Finance ledger, invoice, refund, payout | Sandbox partial | Balanced integer postings, simple computed invoice, cancellation refund, owner receivable, internal booking/ledger reconciliation, tests. No payment provider, real payout, taxes, FX, chargeback, partial refund or external reconciliation. |
| SMS, WhatsApp, email, RCS, push | Sandbox partial for SMS; contract only for others | SMS permission evidence, withdrawal, preflight and sandbox acceptance wired to UI/API and tests. Other adapters remain in-memory contracts. No live provider, global suppression, queue or webhooks. |
| Telegram, website ad tag, WordPress, creator/app/offline inventory | Blocked/unimplemented | Access, delivery surface, proof contracts, policy and fraud work remain. |
| Trust, privacy, fraud, support | Sandbox partial | Audit rows, no audience export, source labels; no operational case system, suppression ledger, DSR, deletion, fraud model or legal review. |
| English/Persian RTL responsive UI | Sandbox partial | Code-native UI, mobile/RTL browser smoke and screenshots. Partial translations; no screen-reader study or accessibility audit. |
| Security, reliability, performance | Sandbox partial | Prepared SQL, allowlist, CSP, cookie, state/tenant tests. No MFA, signed webhooks, rate limits, TLS termination, backup automation, observability stack, load tests or SLO validation. |

## Verification record — 2026-09-27

- `npm run check`: passed JavaScript syntax checks.
- `npm test`: 9 tests passed, 0 failed; domain, ledger, tenant isolation, key-scoped conversion import, messaging permission/opt-out, internal reconciliation, and journey behavior.
- Browser/IAB and Chrome connector were unavailable. Installed Chrome with Python Playwright was used as fallback; `python3 tests/ui_smoke.py` passed SMS permission/preflight/acceptance, advertiser → operator → media owner → advertiser → operator booking/settlement, internal reconciliation, mobile overflow, and RTL checks. Desktop/mobile/RTL, messaging, and operations screenshots are in `docs/qa/`.
- `docker compose config --quiet` and `docker compose up --build -d` passed; `/api/health` returned `ok` from the container. The container was left running on loopback for review.
- Load, accessibility automation, security scan, and backup/restore drill were not run; do not mark them passed.

## External prerequisites

Launch market and legal basis; verified provider/partner accounts; sender IDs and business verification; publisher agreements and ownership evidence; payment and payout contracts; real tax/FX requirements; secure infrastructure/credential vault; production auth; provider callback contracts; user research and accessibility validation.
