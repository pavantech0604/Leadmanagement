# Google Sheets upload sync

The existing MARKETING spreadsheet (`10Cji9fGZenyi4BLnIodt98z8C1iAPTo3yWCPTaNjpoE`) is the fixed destination. An import saves with automatic synchronization and a complete restore snapshot.

## Automatic synchronization

- In Vercel, set the server-only `GOOGLE_SYNC_URL` to the authorized Apps Script deployment ending in `/exec` and `GOOGLE_SYNC_TOKEN` to the matching private token, then redeploy. Local development can also use a saved private connection file.
- An upload is saved first. Background sync writes its allocated language rows and MMS receipt. The import history marks it synced only after a verified receipt.
- Opening the workspace resumes pending uploads. Uploads are processed oldest first; an earlier failure pauses later ranges. Use **Retry sync** after fixing the error. Do not upload the same file again.
- Without a configured connection, uploads remain saved and pending. There is no direct Google write fallback.

## Behavior

- Duplicate validation uses the saved master plus every committed local upload.
- Confirmation rechecks duplicates and destination rows against the current local store. A changed preview must be validated again.
- Sync checks phones against live language sheets and refuses to overwrite occupied destination rows.
- The sync engine locks concurrent writes, checks the batch ID, and verifies the written leads and MMS receipt before marking the upload synced.
- Retries use the same batch ID and allocated rows. A crash after a partial write can resume without adding duplicate receipts.
- Automatic restore snapshots contain complete JSON data. **Export all data** generates the readable Excel workbook when requested.

Historical imports retain their original source row references. `mmsoctm06.xlsx` was directly verified against TN rows 18603–21100 and MMS LEAD REPORT row 22.

## Google Sheets to app

While the workspace is open, it checks for updates automatically. The background refresh imports new and edited Google register records, including records entered directly in MMS LEAD REPORT. Import History remains the list of files uploaded through the app; Google-only receipts appear in MMS receipts. Automatic refresh preserves missing records. Use the explicit owner reconciliation to apply deletions. Reading the source uses its existing workbook export access; writing requires the separate authenticated Apps Script connection.

## Daily retry when the workspace is closed

Set a separate random server-only `CRON_SECRET` in Vercel Production and redeploy. Vercel sends it as a bearer token to the scheduled sync route. The route rejects requests without it. The daily job is scheduled for 06:00 IST; on Hobby it can start later in that hour. Uploads still start syncing immediately when saved, and opening the workspace still resumes pending uploads.
