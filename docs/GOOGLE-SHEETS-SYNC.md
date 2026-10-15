# Google Sheets upload sync

The existing MARKETING spreadsheet is the fixed destination. An import saves locally first, with a complete JSON restore snapshot. Google writes run after the response, so a slow Google request does not delay saving the upload.

## One-time owner setup

1. Open **Settings → Google Sheets → Connect Google Sheets**.
2. Click **Copy connection script**.
3. Open Google Apps Script in the spreadsheet owner's account, create a new project and paste the script.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me**, **Who has access: Anyone**, then complete Google's authorization.
5. Paste the deployment URL ending in `/exec` into Settings and choose **Verify & connect**.

The endpoint requires a private key on every request and is restricted to the configured spreadsheet. The key stays in `data/private/google-connection.json`; workbook exports do not include it. The endpoint does not expose a lead-reading or export action. Google deployment instructions: https://developers.google.com/apps-script/guides/web

## Behavior

- Duplicate validation uses the saved master plus every committed local upload. Google refreshes in the background at most once every five minutes.
- Confirmation rechecks duplicates and destination rows against the current local store. A changed preview must be validated again.
- Google sync rechecks phones against all five live language sheets and refuses to overwrite occupied destination rows.
- The script locks concurrent writes, checks the batch ID, and verifies the written leads and MMS receipt before the app marks the upload synced.
- Retries use the same batch ID and allocated rows. A crash after a partial write can resume without adding a second receipt.
- Pending jobs stay in `workspace.json`. They resume when the app is running and the connection is available. A closed local app does not run background work.
- Automatic restore snapshots contain the complete JSON data. **Export all data** generates the readable Excel workbook when requested.

Historical imports retain their original source row references. `mmsoctm06.xlsx` was directly verified against TN rows 18603–21100 and MMS LEAD REPORT row 22 on 15 October 2026.
