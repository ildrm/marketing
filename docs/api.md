# Local API contract (sandbox v1)

All JSON endpoints below can be called under `/api/v1/` or the browser's `/api/` alias. Errors return `{ "error": "..." }`. The API uses an HttpOnly SameSite=Strict cookie after demo sign-in. Mutations check `Origin` when present. This is not production authentication. Requests and responses are JSON except tracked redirects.

| Method/path | Role | Purpose |
|---|---|---|
| `GET /api/v1/health` | Public | Health, mode, UTC time |
| `GET /api/v1/demo-users`; `POST /api/v1/login`; `POST /api/v1/logout`; `GET /api/v1/me` | Demo | Disposable local role sessions |
| `POST /api/v1/keys` | Advertiser | Issue one-time-displayed 30-day sandbox key scoped to `conversion:write` |
| `GET /api/v1/catalog` | Signed in | Available SKU list and verification label |
| `GET/POST /api/v1/permissions`; `POST /api/v1/permissions/withdraw` | Advertiser | Purpose/channel-specific sandbox SMS permission evidence and withdrawal; raw number is not stored |
| `GET/POST /api/v1/messages`; `POST /api/v1/messages/preflight` | Advertiser | Sandbox SMS acceptance, E.164/segments, permission and quiet-hour preflight |
| `POST /api/v1/messages/:id/status` | Operator | Simulate accepted → delivered/failed; no real callback |
| `GET/POST /api/v1/properties`; `POST /api/v1/inventory` | Owner | Property and SKU management |
| `GET/POST /api/v1/campaigns`; `POST /api/v1/campaigns/:id/status` | Advertiser | Draft, submit, cancel (valid state transitions only) |
| `GET/POST /api/v1/review` | Operator | Approve/reject submitted campaign or pending property |
| `GET /api/v1/diagnostics` | Operator | Unprocessed outbox count/oldest event, unbalanced ledger batches, dispute count |
| `GET /api/v1/reconciliation` | Operator | Compare booking proof and balanced reservation/settlement/refund postings; internal sandbox only |
| `GET/POST /api/v1/bookings` | Advertiser/owner/operator for GET; advertiser for POST | Scoped booking list/reservation |
| `POST /api/v1/bookings/:id/accept` | Owner | Accept reserved booking |
| `POST /api/v1/bookings/:id/publish` | Owner | Submit `{ "proofUrl": "https://..." }`; returns tracked link |
| `POST /api/v1/bookings/:id/dispute` | Advertiser/owner | Block settlement pending operator resolution |
| `POST /api/v1/bookings/:id/resolve` | Operator | Return disputed booking to published |
| `POST /api/v1/bookings/:id/settle` | Operator | Balanced sandbox ledger settlement |
| `POST /api/v1/bookings/:id/cancel` | Operator | Refund escrow for cancellable booking |
| `GET /api/v1/bookings/:id/invoice` | Booking party/operator | Computed sandbox invoice |
| `POST /api/v1/conversions` | Advertiser session or sandbox API key | `{bookingId,eventId,stage,valueMinor,occurredAt,consentSignal}`; unique event ID deduplication. API key calls require event time within 90 days and `granted`/`not_required` consent claim. |
| `GET /api/v1/report`; `GET /api/v1/finance`; `GET /api/v1/activity` | Scoped signed in | Metrics, ledger, audit history |
| `GET /r/:token` | Public | 302 to allowlisted destination; platform observed click when eligible |

Booking creation requires `{campaignId, inventoryId}`. Campaign creation requires `{name, objective, budgetMinor, currency, destination}`. Amounts are integer currency minor units. Data is limited to the sandbox and tenant scope. Sandbox API keys are supplied as `Authorization: Bearer rly_demo_...`; only the conversion endpoint accepts them. A claimed consent signal is not independently verified. SMS permission calls use `{to,channel:"sms",purpose,proofSource,proofText}`; sandbox send uses `{to,purpose,body,timeZone,idempotencyKey}`. There are no live provider webhooks, web SDK, CRM connector, payout API, or OpenAPI generation yet.
