# Relay advertising network sandbox

Relay is a runnable **local sandbox** for a cross-channel advertising marketplace. It demonstrates a complete, auditable booking journey without sending messages, charging money, or making payouts. It is **not production ready**. The full specification and honest coverage are in [docs/traceability.md](docs/traceability.md).

## Run

Requires Node.js 26 or Docker. No npm installation or external account is required.

```bash
npm start
# open http://127.0.0.1:4300
```

Or:

```bash
docker compose up --build
```

The local database is `data/relay.sqlite` (ignored by Git). Docker stores it in the `relay_demo_data` volume. Set `DB_PATH`, `PORT`, `HOST`, `PUBLIC_BASE_URL`, and `ALLOWED_DESTINATION_HOSTS` from [.env.example](.env.example) if needed. The app does not automatically load `.env` files; export variables in the shell or Compose configuration. Bind only to loopback for demo use. `DEMO_MODE=false` disables demo login and therefore intentionally leaves the service unusable until production auth is implemented.

## Demo roles and path

The sign-in screen offers three disposable demo identities: **Ava Chen** (advertiser), **Mina Darvish** (media owner), and **Sam Reed** (operator). Demo sign-in has no password and is suitable only for loopback use. The seed includes one manually reviewed newsletter placement at USD 120.00 and USD 1,000.00 of **sandbox funding** for the advertiser. No real person, publisher, balance, or credential is represented.

1. Advertiser creates a campaign with an approved HTTPS destination such as `https://example.com/book`, then submits it.
2. Operator reviews and approves the campaign.
3. Advertiser books the newsletter placement; a balanced ledger entry moves sandbox funds into escrow.
4. Media owner accepts and records an HTTPS proof URL. The system labels this evidence **owner reported** and issues an opaque tracked link.
5. A browser request to that link records a **platform observed redirect click**. The advertiser imports a conversion with a unique event ID; the system labels it **imported**.
6. Either party can dispute a published booking. Operator resolves it and settles once proof exists. The sandbox invoice, owner receivable, and internal booking/ledger reconciliation are then visible.

A redirect click is not a landing session or a known person. An imported conversion linked to a booking is not proof that the placement caused it.

## Commands

```bash
npm run check       # syntax checks
npm test            # domain, ledger, tenant, workflow, messaging contract tests
python3 tests/ui_smoke.py  # optional: installed Chrome + Python Playwright
```

The UI smoke test uses an isolated temporary database and writes rendered screenshots under `docs/qa/`. It needs Chrome at the path in the script. The API also responds under `/api/v1/`; the browser currently uses `/api/`. See [docs/api.md](docs/api.md) for the contract.

## What is here

- `apps/api`: versioned HTTP surface, loopback demo sessions and scoped sandbox conversion keys, marketplace workflow, redirect collection, reports, invoice calculation, and settlement.
- `apps/web`: responsive English/Persian foundations, role workspaces, accessible forms, status and metric source labels.
- `packages/domain`: transition, money, and URL policies.
- `packages/integrations`: contract-tested **sandbox-only** SMS, WhatsApp, email, RCS, and push adapter primitives. SMS is wired to permission, preflight, and simulated acceptance in the UI/API. No channel has live provider credentials.
- `infra/migrations`: SQLite schema for the local demo.
- `docs`: requirements, capability matrix, event dictionary, architecture decisions, threat model, operations, and traceability.

## Key boundaries

This build uses Node's built-in SQLite, a modular monolith, and code-native web UI so it runs without dependency downloads. It does **not** implement the requested Next.js/NestJS/PostgreSQL/Redis/S3 production stack. Node 26 and `node:sqlite` are also not the chosen production baseline; the production migration, authentication, queues, provider integrations, security controls, and load tests remain open. The source and tests are an executable product foundation and acceptance harness, not a claim that the full brief is complete.

Source research was checked on **2026-09-27**; see [docs/capabilities.md](docs/capabilities.md). Keep provider policies and pricing under review before any activation.
