# Event taxonomy and metric dictionary

## Current stored events

| Event | Emitter | Meaning | Source | Identity |
|---|---|---|---|---|
| `booking.reserved` (outbox) | API transaction | Price reserved in sandbox ledger | Platform observed | Organization/booking only |
| `booking.publish` (outbox) | Owner workflow | Owner submitted a proof URL; publication not independently verified | Owner reported proof | Organization/booking only |
| `click` | Redirect service | Browser-like GET requested an active opaque token | Platform observed | Anonymous; `anonymous_id` currently null |
| `conversion` | Advertiser import | Advertiser submitted a stage and unique event ID | Imported | Booking-scoped claim |
| `booking.settle` (outbox) | Operator workflow | Sandbox ledger settlement after proof | Platform observed | Organization/booking only |
| `permission.granted` / `permission.withdrawn` (audit) | Advertiser | Declared SMS permission proof or withdrawal | Advertiser reported | Tenant and keyed contact digest |
| `message.sandbox_accepted` (outbox/audit) | SMS sandbox | Adapter accepted a test message; no network send | Sandbox provider reported | Tenant and keyed contact digest |

Rows in `events` carry event ID, tenant, booking, type, provenance, occurred/received UTC timestamps, optional anonymous/subject IDs, and JSON metadata. SMS permissions/messages use their own tables plus audit/outbox rows and do not imply delivery. Outbox rows carry event ID, tenant, type, version and payload, but no consumer currently runs. Corrections, replay, clock-skew handling, inbox deduplication, schema evolution, and dead-letter handling remain open.

## Current report definitions

| Metric | Numerator | Denominator | Source and caveat |
|---|---|---|---|
| Active bookings | Bookings in reserved/accepted/published/disputed state | Not a rate | Contract state; not exposure |
| Booked spend | Sum of non-cancelled booked price minor units | Not a rate | Contract/ledger amount, not provider charge |
| Clicks | Non-prefetch GET redirect events | No implied denominator | Platform observed; not landing sessions or unique people |
| Qualified leads | Conversion events with `qualified` stage | No implied denominator | Advertiser imported; may be late, incomplete, or inaccurate |
| Owner receivable | Balanced sandbox ledger entry after settlement | Not a payout | Accounting example only |

The UI displays report freshness (`asOf`), UTC, source, and currency. No CTR, CPC, CPA, CPM, ROAS, reach, viewability, sends, accepted, delivered, reads, replies, orders, revenue, contribution margin, or reconciliation discrepancy is claimed. Those metrics need their own event contracts and valid denominators before display. A public post view cannot be used as an identified-person reach count. Provider delivery is distinct from human read. An attribution credit would need a model version and explainable evidence trail; no such model is currently implemented.

## Planned versioned event envelope

`{id, schemaVersion, tenantId, actorId, type, occurredAt, receivedAt, source, correlationId, payload}`. Retain source payload for audit subject to market-specific retention, minimize personal data, and record reversal events rather than changing historical facts.
