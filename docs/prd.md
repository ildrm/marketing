# Product requirements and decision record

Date: 2026-09-27. Status: sandbox scope, not a production launch decision.

## Baseline and gap analysis

The supplied repository contained only `LICENSE`, a one-line README, and Git metadata. There were no features, dependencies, tests, schema, deployment, or project-local AGENTS.md. Workspace instruction `~/.codex/RTK.md` requires shell commands to be prefixed with `rtk`.

The requested product is a hybrid marketplace, messaging hub, and first-party measurement platform. The current executable slice covers a local newsletter listing, advertiser campaign approval, booking, owner proof, redirect click, imported conversion, sandbox ledger, invoice, dispute, and settlement. The other channels and production infrastructure remain gaps, enumerated in [traceability.md](traceability.md).

## Actors and permissions

| Actor | Owns | Sandbox actions | Must not see |
|---|---|---|---|
| Advertiser | Campaigns, budget, destinations, imported conversions | Create and submit campaign; book; see own report/ledger; dispute | Other advertisers' campaign, booking, report, invoice, ledger |
| Media owner | Property, inventory, publication proof | Add property/SKU; accept; publish; see own booking and receivable; dispute | Advertiser contact lists or unrelated advertiser records |
| Operator | Review and settlement decisions | Review campaigns/properties; resolve dispute; settle; inspect all demo bookings | Live provider secrets (none stored) |

Role permissions are enforced server-side. Demo identity switching is intentionally passwordless and must stay on loopback. Production registration, MFA, granular memberships, invitations, API keys, and account lifecycle are unimplemented.

## Core workflow acceptance

An advertiser can reserve a manually reviewed available SKU only after campaign approval, within campaign budget, in the same currency, and with enough sandbox funds. The owner can accept and record proof. The advertiser can view an opaque link and import a conversion. The operator can settle once a published booking has proof; settlement is balanced and cannot be repeated. A dispute blocks settlement until resolved. Tests in `tests/journey.test.mjs` cover the complete path and tenant denial checks.

## Glossary

- **Property**: media owner's channel, site, newsletter, creator presence, or physical location.
- **Inventory SKU**: purchasable contract for a specific placement. Current demo has one newsletter section.
- **Booking**: commercial reservation and fulfillment state, distinct from campaign review state.
- **Proof**: evidence a media owner supplied. Current system records a URL and labels it owner reported; it does not verify publication.
- **Click**: request to a Relay redirect token, with simple prefetch filtering. Anonymous, not a landing session.
- **Conversion**: advertiser-submitted event ID and lifecycle stage tied to a booking. Imported claim, not deterministic attribution.
- **Escrow / owner receivable**: sandbox ledger accounts. No actual custody, payment, tax invoice, or payout.
- **Settlement**: accounting transition after proof and operator action; not a real transfer of funds.

## Success hypotheses to validate in a pilot

Track fulfilled bookings, repeat advertiser spend, qualified leads, contribution margin, attribution coverage, reconciliation discrepancy, complaint/opt-out rate, and incidents. No target values are asserted because no launch market or customer cohort has been selected. A pilot should establish baselines and define thresholds before launch.

## Unresolved business facts and gates

Launch geography, currencies, payment/payout arrangement, target industries, support languages beyond English/Persian, sender-account ownership, initial media partners, tax treatment, and legal retention periods require sponsor and legal decisions. The sandbox assumes USD only for seed data, and this is not a launch-market decision. Live messaging, payments, and publication verification remain disabled until the relevant contracts, accounts, consent basis, and regional review are documented.

## Review gates and recorded decisions

| Gate | Perspectives reviewed | Decision |
|---|---|---|
| Baseline | Product, architecture, operations | Treat repository as greenfield; ship an executable sandbox slice and explicit gap matrix. |
| Marketplace | Supply, advertiser success, trust | Manual property status is displayed; proof URL is owner reported and settlement needs operator action. |
| Measurement | Tracking, analytics, privacy | Redirect events remain anonymous; imported conversions are booking-scoped claims. No cross-channel identity inference. |
| Finance | Finance, security | Integer minor units, balanced immutable entries, same-currency booking, idempotent posting references. No real money. |
| Channels | Partnerships, safety | SMS permission/preflight/acceptance works only in sandbox; other adapters have contract tests. No live transport without verified access and callbacks. |

## Research gaps

Competitive and user research, interviews with advertisers/owners/operators, pricing willingness, inventory quality sampling, and regional legal review have not occurred. Proposed interview plan: 5 novice advertisers, 5 agency buyers, 5 media owners, 3 operators, with booking and reporting tasks on this sandbox. Record comprehension of provenance, proof, disputes, and fee split before changing workflows.
