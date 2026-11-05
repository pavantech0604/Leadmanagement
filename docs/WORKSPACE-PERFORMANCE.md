# Lead workspace performance verification

The workspace uses Next.js 16.4.5 App Router, React 19, component state and a client-side page selector, with Lucide icons and CSS. File parsing already runs in a Web Worker. Charts and specialist sections load on demand. Duplicate preview renders at most 50 rows, and the main contact list is paginated.

- `app/page.tsx`: duplicate preview owns its spinner and AbortController. The UI gets a paint opportunity before the request is encoded. Rapid clicks share a single in-flight guard; changing input or navigating cancels the old response. Import confirmation cannot run while the preview is changing.
- `app/api/workspace/route.ts`: preview does a read-only request with the same authentication, duplicate, allocation and naming checks as confirmation. Confirmation still recomputes the token in the write transaction. The JSON response is unchanged. The `Server-Timing` response header separates workspace/auth loading from duplicate and series preparation.
- `lib/cloud-database.ts`: preview reads only the workspace fields needed for validation, omitting raw import rows, lead history and saved artifacts.
- `lib/transfers.ts`: a warm workbook cache verifies the database source hash without downloading the same workbook again.

Local fixture measurements (HTTP round trip; 50 rows included the first workbook parse): 50 rows 201 ms, 1,000 rows 111 ms, 10,000 rows 363 ms. The fixture workspace was byte-for-byte unchanged after preview. Live Supabase preview metadata measured 1.94 MB versus 21.76 MB for the full workspace; the projected read took 5.86 s. Local production landing returned HTTP 200 in 118 ms, and the signed-out workspace bootstrap returned HTTP 200 in 132 ms. These measurements do not establish a 200 ms live interaction or request guarantee.

Browser follow-up: with DevTools Network throttled, submit a 10,000-row file, confirm that the button shows feedback immediately and only one preview request starts, change a mapping or click Cancel, then confirm the old results never appear. Navigate to MMS receipts during a check, return, and validate again. Compare the `Server-Timing` values and record click-to-paint in the Performance panel. Confirm an import from a current preview and verify an outdated token is rejected. The HTTP fixture and production smoke checks do not replace these browser checks.

If live preview latency remains high, profile the pool workbook download and Supabase region/network separately. A normalized phone/email index in Supabase could further reduce the 1.94 MB read; preserve matching precedence and transaction-time confirmation before migrating.

## Separate import storage

New imports are saved in `capital_grow.pipeline_imports` as independent batches, lead arrays, receipts, and audit records. They no longer rewrite the large legacy workspace or create a full workspace snapshot on each import. The import row itself is the durable recovery record; its confirmation token is unique. Existing data remains in `workspace`.

`workspace_read` combines legacy data and unabsorbed imports for reads. General workspace mutations lock the legacy row, read the combined view, and mark folded imports absorbed in the same transaction. Google sync updates a new batch's ledger metadata directly. Export and duplicate checks read the combined data, and purchase costs remain attached to the original batch.

Apply `20261105090000_pipeline_import_ledger.sql` before deploying this version. The table has RLS enabled, no anon/authenticated access, and explicit access for the restricted server database role. The read view uses security-invoker permissions. A live 1,999-lead synthetic append/readback test completed in 32 seconds; its transaction was rolled back and checked for removal. This does not establish a production latency guarantee.
