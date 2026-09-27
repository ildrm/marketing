# Local operations and activation runbook

## Start and inspect

Run `npm start` or `docker compose up --build`, open `http://127.0.0.1:4300`, and select a demo role. `GET /api/health` reports mode and time. Operator-only `GET /api/diagnostics` reports unprocessed outbox count/age, disputed bookings and any unbalanced ledger batches. Outbox consumer status is deliberately `not_configured`; these rows are not delivered to another service. Errors are written as JSON to stderr. `docs/qa/` contains concept and browser screenshots; `tests/ui_smoke.py` regenerates rendered captures with a clean temporary database.

## Backup and restore (demo only)

Stop the server before copying `data/relay.sqlite` and its WAL/SHM files. Copy all three files together, or use SQLite's backup API for an online backup. Restore into an empty `data/` directory with the server stopped, then run `npm test` and check `/api/health`. This is **not a production backup plan**: automated schedules, offsite copies, encryption, restore drills, and point-in-time recovery are absent.

## Schema and replay

`infra/migrations/001_init.sql` is idempotent and applied at start. There is no migration version table or automated rollback. Make a database backup before changing schema. The outbox is written transactionally but not consumed; do not mark its rows processed by hand to claim delivery. Production needs consumer idempotency, dead-letter storage, replay tooling, event versions, and monitoring.

## Booking exception handling

An operator can inspect the review queue, published proof URL, dispute state, invoice calculation, and ledger. The Operations view and `GET /api/reconciliation` compare each booking with internal proof and ledger postings; zero internal discrepancies does not imply a provider invoice or payout matched. A disputed booking cannot be settled. Resolve only after evaluating evidence outside the sandbox; the current UI does not collect an appeal dossier. A cancellation of a reserved/accepted/disputed booking returns sandbox escrow and releases the SKU. There is no partial refund, make-good, tax record, chargeback, or real payout.

## Activation checklist

1. Choose launch countries, currencies, entity/payment flow, sender ownership, restricted industries, and retention with legal/finance sign-off.
2. Replace demo identity with verified auth, MFA, scoped API keys, tenant memberships, and audited operator powers. Disable public demo login.
3. Move transactional data to PostgreSQL; enforce and test tenant-scoped relations, migrations, backups and recovery. Establish object storage and queue worker.
4. For each channel, record current official API version, region, approval, sender/property evidence, consent rules, webhook signatures, status mapping, rates, and credential rotation. The channel is live only after sandbox, contract, and provider reconciliation tests pass.
5. For money, contract the payment/payout provider, tax handling, FX, refunds, chargebacks, holds and ledger reconciliation. Test parallel booking and settlement under load.
6. Complete threat model controls, independent security review, accessibility testing, load benchmarks, monitoring and incident response before external users.

## SLO hypotheses, not validated targets

Propose redirect p95 <100 ms in-region and API availability 99.9% after architecture migration; propose zero unexplained ledger imbalance and daily provider reconciliation. No load benchmark or SLO validation has been performed. Do not publish these as achieved metrics.
