# Kopi Run

One Cloudflare-hosted drinks list for your team. Open the invitation link in any
browser: no installation, individual setup, or recurring roster imports needed.

The roster, usual drinks, off-menu drinks, groups, and completed runs live in
Cloudflare D1. Current order selections and the active group stay on each device.
The page loads the cloud list before rendering, saves changes automatically, and
refreshes other colleagues' changes every 15 seconds and when the window regains focus.

Use **Setup → Your people → Edit** to rename a person. Their usual drinks, groups,
completed-run history, and current selections are retained. The **↑ / ↓** buttons
change the shared tag order on Who's in and By drink. Names must be nonempty and
unique (ignoring case). Name and ordering controls are kept in Setup.
The saved notice appears as a small line in Setup; other screens show only
saving progress or actionable connection/conflict errors.

To edit a usual, select the person on Who's in, tap the pencil, then tap their
usual drink. The editor starts with that drink's existing options; choose
**Save usual drink** to update the shared usual and today's order. Manually
edited usuals are retained when runs finish. **Build something different**
continues to change only the current order.

Anyone holding the invitation can read and edit the shared data. The random
invitation token stays in the URL fragment, is sent to the API as a bearer token,
and is stored on the server only as a SHA-256 hash. There is no public roster
endpoint. This is link-based access, not an email allowlist or individual login.
Do not post the invitation in a public issue, commit, or PR.

## First deployment

Requires Node.js, npm, and a Cloudflare account.

```sh
npm ci
npx wrangler login
npx wrangler d1 create kopi-run --location apac
```

For a new account, put the returned database UUID into `wrangler.jsonc` in place
of the existing deployment's `database_id`. Do not reuse another account's UUID.

```sh
npm run db:remote
npm test
npm run deploy
npm run team-link -- https://YOUR-WORKER.workers.dev
```

The last command configures the server secret and prints the private team link.
It also saves it in ignored `artifacts/team-link.txt`. An existing token in
`artifacts/team-token.txt` is reused so rerunning the command is safe.
Without the secret, the API rejects all access.

To revoke an old invitation and issue a new one, run the same command with
`--rotate`. This retains the team database and invalidates the old link. Reissuing
the link cannot erase copies already downloaded by people with prior access.

## Bring across your existing roster once

On the old app, open Setup and copy the roster sharing code (KR1) or the full
backup. Open the new team link, then Setup, paste it into the import box, and
choose **Add to team roster** for a KR1 code or **Restore full backup** for JSON.
Wait for **Team list saved in the cloud**. Everyone now sees the imported data.
No colleague needs to repeat this import. Restoring a full backup replaces the
shared roster/history and asks for confirmation; importing a KR1 code merges.

The old app's browser data cannot be read automatically across a different origin.
Older backups that contain only roster/history are supported; new exports also
include groups and off-menu drinks.

## Updates, offline use, and simultaneous edits

Wait for the cloud save status before closing the page. Network failures keep
unsaved edits in memory and offer Retry and Download buttons. Reopening the
cloud app requires a connection; it never presents an empty local roster as if
it had loaded the team data.

Saves use a database version condition so a stale browser cannot overwrite newer
changes. If colleagues edit at the same time, the later stale save is rejected.
The page offers **Download edits and load latest**, preserving the unsaved
snapshot as JSON before reloading. Reapply only the intended edits to the latest
list; restoring that whole snapshot would replace colleagues' changes.

The service worker caches only the app shell, never API requests or team data.
The original static/GitHub Pages app continues to operate locally when served
without the Cloudflare Worker.

## Local development and validation

Create ignored `.dev.vars` containing `TEAM_TOKEN_HASH=<SHA-256 of your token>`.
Use a random base64url token of at least 43 characters, and open the development
URL with `/#team=<token>`.

```sh
npm run db:local
npm run dev
npm test
```

Tests exercise actual local D1 storage, rejected unauthorized requests, schema
and body limits, simultaneous saves, stale writes, client conflicts, retry after
network failure, and a refresh response arriving after a newer save. `npm run
deploy` builds an explicit four-file asset folder so repository files and
secrets cannot be served accidentally.

Subsequent deployments: `npm ci`, `npm test`, `npm run deploy`. Secrets and D1
data are retained. Apply any new database migrations before deploying code that
needs them.
