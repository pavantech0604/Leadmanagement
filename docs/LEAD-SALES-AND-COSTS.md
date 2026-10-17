# Lead purchases, internal use and external sales

All prices are INR, stored as integer paise. The purchase price is required when confirming a new upload; zero explicitly records a free file. The user chooses whether the vendor bills new accepted leads or all supplied rows. Duplicate validation and append ranges remain unchanged. Purchase total is calculated server-side and saved atomically with the import. Purchase costs are private application data, not added to the shared Google report columns.

Internal floor deliveries never create external revenue or consume the pipeline. Sales are a separate ledger: select buyer, one or more languages, a physical starting row, quantity, and price per lead. The ending row is inclusive: start + quantity - 1. The server validates every row, rejects invalid/blank ranges and repeated phones within a request, and shows earlier floor deliveries and sales. Reuse requires explicit acknowledgement. Same leads can be sold again without a waiting period; their acquisition cost is charged once when calculating aggregate sales margin.

Confirmation uses a source/history/cost fingerprint and an idempotency key. A stale preview cannot commit. The completed sale has a canonical file name and a downloadable workbook with one sheet per language and an invoice summary. Downloads require workspace access. A sale does not delete leads or change floor allocations. Cancellation is owner-only, retained in history, and removes the sale from revenue; purchase spending remains. Prices can be backfilled for existing imports; the audit preserves cost edits and financial totals recalculate.

## Dashboard measures

- Recorded vendor spend: all saved batch purchases plus opening-stock purchases, including leads used internally or unsold.
- External sales value: completed, non-cancelled sales. This is recorded revenue, not a payment collection balance.
- Net lead result: external sales value minus recorded vendor spend. It stays pending if uploaded batches or sold leads lack purchase cost. It excludes operating expenses and taxes.
- Sales margin: completed sales value minus acquisition cost of unique phone numbers sold. Repeated sales add revenue without allocating acquisition cost twice. Unknown cost stays pending. When a vendor bills all source rows, its total invoice is apportioned across accepted unique leads in whole paise, with remainder paise allocated deterministically.

Opening-stock costs cover older Google language ranges outside recorded uploads. Overlapping purchase costs and imported-phone ranges are rejected. Sales and opening stock use normalized phone identities, so previous sales do not accidentally become new inventory simply because another buyer requests them.

Unpriced historical records are never assumed free. Enter their actual costs in Sales & costs → Purchases & costs. Zero must be an explicit user decision. All metrics reflect entered records only; unrecorded historic expenses cannot be inferred.

The complete workspace backup includes finance summary, purchase costs, opening stock costs and the sales register. JSON versions retain full sale artifacts and cost provenance. No schema migration is needed: the optional ledgers are persisted in the existing private JSON workspace transaction and version history.
