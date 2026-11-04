# AYJ Chess ratings mirror

This bound Apps Script mirrors the website's **current** player ratings into a dedicated **Ratings** tab in your Google spreadsheet. Other tabs remain untouched. The website remains the source of truth; edits to the sheet do not update the website.

## Installation

1. In that spreadsheet, open Extensions → Apps Script and add `Code.gs` from this folder. Keep the `@OnlyCurrentDoc` annotation.
2. Generate a cryptographically random 32-byte lowercase hexadecimal token. Store its SHA-256 hash as the Sites secret `SHEETS_SYNC_KEY_HASH`. Deploy the backend and Vercel proxy with the ratings-sync route.
3. In the bound project's Settings → Script properties, save the original token as `AYJ_RATINGS_TOKEN`. Never put it in script source, a sheet cell, URL, log, or Git. All script editors can access Script Properties; only trusted managers should edit this bound project.
4. Run `setupAyjRatingsSync`, review Google's permissions for this spreadsheet, external requests, and the script's time trigger. The initial pull must succeed before the trigger is created.
5. Verify the Ratings tab and the single `syncAyjRatings` time trigger. Reload the spreadsheet to show the AYJ Chess menu.

Google runs the trigger under the account that installs it, about once per minute, including while the browser is closed. Timing is approximate. Each poll acknowledges health; unchanged website versions skip spreadsheet writes. Sync now forces a refresh. Deletions, rating corrections and renames are reflected in the next snapshot without rewriting historical games. The sheet displays only Name and Rating; the website's owner-only sync status reports successful synchronization separately.

The Ratings tab is managed in columns A:B; keep other notes in another tab. The first run of this layout removes the previous integration's Games, Wins, Draws, Losses, Updated and Player ID columns in C:H. Later runs touch only A:B. Formula-like player names are written as literal text. Existing non-empty Ratings tabs without the ownership marker are not overwritten. Script locks serialize overlapping runs.

## Access and troubleshooting

The random token allows only the private ratings snapshot (player ID, name, rating, played games and W/D/L), and a strictly validated sync receipt. It cannot sign in, alter club data, manage accounts or read audit logs. It is not a public feed. The backend stores a hash, and the Vercel proxy keeps its existing backend credentials server-side. Sync receipts use a separate database row and never increment the chess document's version.

The admin can see a sheet link, last successful update and health status in Ratings. Google failures cannot roll back or block chess changes. Check Apps Script → Executions for failures. A school-managed account may block Apps Script or external requests; that must be enabled by its school administrator. The script's installing account must retain edit access.

To stop polling, choose AYJ Chess → Disable automatic sync. To revoke the feed, remove `SHEETS_SYNC_KEY_HASH` and redeploy. For rotation, replace the hash and Script Property together. No token is committed in this repository.
