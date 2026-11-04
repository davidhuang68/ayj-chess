# Chess manager

## Use
- The Vercel home page is the read-only public view. Use TM Login (or `/manage`) for the existing manager workspace.
- Only the admin can enable Show publicly beside a selected session. Sessions are private by default. The public home page lists only enabled sessions and shows their published pairings, results and standings, refreshing every 10 seconds. Disabling the checkbox removes the event from public access. Drafts, unpublished rosters, the full player database, private rating history, accounts, logs and backups are never included in the public response. There are no public result-entry controls.
- Create a session and use the Weekly / Tournament switch. Weekly retains the existing two-round, 10-minute presets and close-rating pairings. Tournament defaults to five rounds at 25 + 5; choose any whole number from 1 to 15 rounds.
- Tournament mode is one standalone competition: keep using the same selected tournament as its rounds progress, even across different days. Reusing its name in a new session creates a new event. Weekly sessions still form their existing same-name series.
- Tournament pairings use Dutch-style Swiss: top half against bottom half within score groups, no repeated opponents unless explicitly overridden, score-group floats where needed, and balanced colour preferences. Pairing numbers and seed ratings freeze at first publication; late entrants append without reseeding. Club Elo can still change without changing seed order. Pairings can be reviewed and edited with the existing controls.
- Tournament rankings use points, direct encounter, Buchholz Cut 1 (BH-C1), Buchholz (BH), Sonneborn-Berger (SB), then games won over the board. Elo is not a ranking tie-break. Any remaining tie shares the same rank (1=, 1=, 3). Standings and their CSV export are available throughout; finished events show Final rankings. Values are provisional while results are outstanding.
- Tie-breaks follow FIDE's 2026 unplayed-round provisions: terminal zero-point absences count as draws for opponents' adjusted scores; a player's unplayed rounds use dummy scores capped at their own score and either the opponent's adjusted score (forfeits) or half the scheduled rounds (byes/absences). Finishing early uses the actual number of rounds. BH-C1 cuts a voluntary missed-round contribution first when applicable. Byes and forfeits do not count as games won over the board. See the expandable Tie-break rules beside the standings.
- Use the same Tournament name for each week in a series. Case and spacing differences are ignored. Session selection groups matching names; in New session, open the arrow beside Tournament to choose an existing name, or type a new one.
- Each session starts with zero points. Ratings carry over across all sessions. First-round pairings favour similar ratings; later rounds use this week's points, then rating.
- Cancel session is available until the first round is published. Cancellation removes the session while retaining all players and ratings.
- Add late arrivals with New players or Existing players at any time before finishing the session, including after the final round is published. They enter the latest round's waiting list with no automatic points or bye. Use Pair waiting players or Edit pairings to seat them; existing boards and results stay unchanged. Existing byes stay assigned until explicitly edited.
- Paste first-time names into New players and returning names into Existing players, one per line. Existing players retain their IDs and ratings. Google Forms CSV names are split into both boxes automatically.
- After pasting new names, optionally enter a Starting rating beside each name (100–3500, whole numbers). Blank fields use the club's starting Elo. Starting ratings apply only when creating a player; importing existing players never replaces their ratings.
- Check attendance; preview and publish pairings.
- After publication, uncheck no-shows, then use Pair waiting players. It pairs as many waiting players as possible without adding byes; any unmatched player keeps waiting. Select a waiting player and press Assign bye to save a bye immediately.
- Edit pairings changes unplayed boards in the latest round. Recorded games remain locked; clear an incorrect result explicitly before editing that game.
- Waiting players must be paired or withdrawn before the next round or session completion.
- Display pairings hides the manager panels and shows the boards with result buttons. Back returns to the normal view. The same account permissions and round locks apply.
- Record results. Complete every result before the next round.
- Finish the session. Ratings carry over to the next week.
- Accounts: admin can create, reset, disable, or enable manager logins.
- Logs: only the admin can view activity (Toronto time, manager, action, details). Player deletions include the deleted name. Logs are excluded from manager API responses and backups. Data resets retain earlier logs.
- Ratings → Edit rating: admins and tournament managers can set a player's current Elo (100–3500, whole numbers). Past results, game rating changes, and rating history stay unchanged. Future games and pairings use the corrected rating. Each edit is logged with the player name and old/new ratings.
- Ratings → Edit name: only the admin can rename a player. Names must be unique (ignoring case and spacing) and no longer than 100 characters. The same player ID, ratings, games, pairings and tournament seeds are retained. The corrected name appears throughout the app, and the admin log records the old and new names.
- Ratings → Delete: admins and tournament managers can permanently delete a player profile after confirmation. Unplayed pairings are removed and opponents return to waiting. Recorded games retain an anonymous participant so other players' ratings stay unchanged; those games are locked.
- New session: admin can choose K (8–64) before pressing Create. The ? explains K and its default of 32. Tournament managers use the current K. Existing results and corrections retain the K originally used.

Club Elo starts at 1000 with K=32. Draws count as half a point. Byes and forfeits change tournament points, not Elo. Pairings prefer avoiding opponents from earlier sessions in the same series. Older rematches are allowed with a preview warning when needed for full pairings or a better fit in weekly points and ratings. Each prior meeting adds a 200-point penalty to rating distance when comparing older-rematch choices; weekly point differences take priority. Same-week rematches require Allow rematches. Manual edits to introduce a past opponent also require Allow rematches; keeping an existing board is allowed. This is club pairing, not an official FIDE Swiss implementation.

## Hosting

Tournament mode uses club Dutch-style Swiss pairing, not a FIDE-certified pairing engine or an exact reproduction of OCC's grade sections and medal playoffs. Its automatic tie-break rules are based on the [FIDE tie-break regulations effective March 2026](https://handbook.fide.com/chapter/TieBreakRegulations032026). Ranking order is points, direct encounter, Buchholz Cut 1, Buchholz, Sonneborn-Berger, then played wins. Direct encounter compares results within each group tied on points and reapplies to smaller tied groups; incomplete groups only resolve a guaranteed leader before falling back. Byes, forfeits and pending games are excluded; repeated encounters use the average score. DE shows the first applicable mini-league score, or a dash when unavailable. Weekly standings are unchanged. Review pairing warnings before publication; the manual editor remains available.
Vercel serves the minimal React interface and its API bridge. The existing private Sites D1 backend keeps shared data and password accounts. The browser never receives the backend service token. Every club read and write requires an active app account. Optimistic version checks prevent two managers overwriting each other.

Frontend build: `npm run build:vercel` (output `vercel-dist`).
Backend build: `npm run build` (Sites Worker).

Vercel server environment keys:
- `CLUB_BACKEND_URL`
- `CLUB_BACKEND_TOKEN` (secret, intended for the selected Site only)
- `CLUB_PROXY_KEY` (secret)

Private backend environment keys:
- `OWNER_SETUP_KEY_HASH` (secret)
- `OWNER_SETUP_KEY_EXPIRES_AT`
- `PROXY_KEY_HASH` (secret)

First-admin setup uses an expiring random link fragment. The browser removes the fragment from history and submits it only to the auth endpoint. Once an account exists the setup link cannot create another admin. The admin chooses the password in the form, then creates manager logins. New tournament managers are added by the admin.

The Sites audience stays private; Vercel's login page is public. Backend service credentials must stay server-side. If Sites rotates its service token, update the corresponding Vercel secret and redeploy. Never store secrets in Git, command arguments, or a client variable beginning with `VITE_`.

Ratings/results exports and club JSON backup are available in the app. Backups contain club records and membership identifiers, never password hashes or session tokens.
