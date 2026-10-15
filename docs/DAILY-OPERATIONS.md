# Capital Grow daily operations

Source inspected: the user's Google Sheet, downloaded on 12 October 2026. Imported 19 nonempty rows from `MMS LEAD REPORT` and 36 rows from `UPDATE` into a separate operations register. Existing sample CRM leads are retained separately and do not contribute to the daily desk.

## Source mapping

- UPDATE: DATE → date, NAME → destination floor, LANG + RANGE → ordered language/range pairs, FILE NAME → dispatch reference.
- MMS LEAD REPORT: DATE, CLIENT NAME, CLIENT ID, SERIES NO, FILE NAME plus each populated language range column. MALYALAM is normalized to Malayalam.
- Floors are normalized for whitespace/case and the source spelling `Fin Flooor` → `Fin Floor`.
- Date and raw source fields are preserved. A later source row that has an earlier date is not silently moved to a different month.

## Counting rule

The user clarified that ranges reference physical sheet row numbers, including multi-language requests. For each range, look up occupied rows in Telugu/AP, Tamil/TN, Kannada/KA, Hindi/HI and Malayalam/KL. Both range endpoints are inspected. A record with a nonempty name and phone is counted. Header rows and blank/missing rows are excluded. Hindi has no header in the supplied snapshot, so its first row remains data. This counts delivered records, not validated unique phone numbers or conversions. Duplicate-phone cleaning remains a separate CRM import workflow.

`actualCount` is the matched row total; the structural numeric span is retained separately as `count` and is not displayed as a business lead total. Unparseable or mismatched ranges remain uncounted. Partially matched ranges display the matched count and missing-row review flag. Repeated ranges can count again in separate deliveries. Overlaps flag shared language rows for review, without claiming definite customer duplicates or subtracting them automatically. Therefore receipt-minus-dispatch is not represented as available stock.

One source UPDATE value is numeric -27202 and cannot identify a start row; it remains unresolved. No start number is guessed. Corrections can be made in the app with remarks; the original raw source row stays preserved. The source workbook is stored privately under ignored `data/source/`, never in public assets. Customer pools, PAN fields and unrelated tabs are not returned by the operations API.

## Daily use

Open the owner desk or the optional second-operator desk. Record MMS receipts, then record deliveries to CG Floor, MMS Floor or Fin Floor; custom destination names are also accepted. Add each requested language as a separate range line within one delivery. Filter by date, floor, language, reference or review state. Expand rows for matched/missing/header details and potential shared ranges. Export the filtered register as CSV.

The owner can click Refresh sheet to read the fixed Google Sheet URL. This is an explicit one-way read, not a continuous sync or Google Sheet write-back. Source rows are matched by sheet and row number; reordering/deleting rows in Sheets requires manual reconciliation. Source-linked corrections may be replaced by the original source during refresh. Manual app entries remain local. The downloaded source data must be refreshed when the language pools grow.

## Access and API

Operations access is limited to the Admin or designated local operator IDs u0/u1. The entry screen exposes only those two profiles; legacy CRM permissions remain intact. POST /api/workspace actions: operations-sync (Admin only), operations-save with kind, raw fields, optional existing id, and notes. All writes are serialized and audited. This remains a local demo with profile entry, not production authentication.

Files: components/workspace-entry.tsx, components/operations-desk.tsx, app/operations.css, lib/operations.ts, lib/sheet-source.ts, app/api/workspace/route.ts, lib/types.ts. Source registers are persisted in data/workspace.json. PostgreSQL schema is not connected; the operations models will require relational migration when the production adapter is implemented.
