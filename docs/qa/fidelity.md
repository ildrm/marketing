# Visual comparison ledger

Reference: `dashboard-concept.png` generated with the built-in Image Gen tool for a complete advertiser workspace. Implementation: `dashboard-render.png`, `mobile-render.png`, `rtl-render.png` captured from installed Chrome through Python Playwright because Browser/IAB and its Chrome connector were unavailable. Concept and final screenshots were viewed with `view_image` on 2026-09-27.
The additional `messaging-render.png` captures the permission, preflight, and accepted sandbox SMS screen. `operations-render.png` shows the internal reconciliation result, proof link, and settled booking.

| Comparison point | Result and decision |
|---|---|
| Main shell | White canvas, narrow left navigation, top rail, content grid and right activity rail carry through. Implementation sidebar is slightly wider. |
| Heading and action | Serif headline, one primary blue campaign action, restrained subcopy and spacing carry through. Copy was tightened to distinguish observed from reported outcomes. |
| Metrics | Three inline metrics and subtle separators match the layout. Concept's fictional large spend/reach figures were replaced by actual sandbox values and explicit provenance. |
| Campaigns and channel table | Table anatomy, thin borders, blue links and green states carry through. Fewer rows reflect the one campaign created by the smoke journey. The top search filters campaign and inventory lists; the concept's status tabs are absent. |
| Activity rail | Right-side timeline and event dots carry through. Events show actual sandbox actions and IDs. |
| Palette/type | White background, charcoal/indigo type, deep blue controls and mint statuses are close. Custom serif and system sans are code-native. |
| Responsive/RTL | Mobile stacks metrics and activity below tables without page overflow. Persian switches document direction and primary headings; several operational strings remain English. |

Above-the-fold copy differs intentionally from the concept: the user name, demo data, and subcopy represent the running sandbox. The concept's fabricated channel/campaign claims, decorative controls, and multi-campaign metrics were not carried into the functional UI. There are no clipped primary controls or page overflow in the mobile smoke check. This is **not** a 10/10 faithful implementation of every detail in the concept; status tabs, complete Persian translation, icon fidelity, and denser table states need further work. The screenshot is an implementation reference, not evidence of production readiness.
