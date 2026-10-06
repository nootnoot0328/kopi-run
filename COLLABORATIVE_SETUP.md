# Kopi Run collaborative prototype setup

This branch keeps the existing local/offline app working while adding the first
backend boundary for shared group runs.

## 1. Create a Supabase project

Create a new project in the Supabase dashboard. Keep the database password in
your password manager; do not commit it to this repository.

## 2. Apply the database migration

Open the Supabase SQL Editor and run:

`supabase/migrations/001_collaborative_runs.sql`

The migration creates only the first vertical slice:

- `runs`
- `orders`

Both tables have Row Level Security enabled and are not granted directly to
browser roles. Collaborative browser traffic is intended to pass through the
Edge Function.

## 3. Create the Edge Function

Create an Edge Function named:

`run-api`

Use the contents of:

`supabase/functions/run-api/index.ts`

Supabase injects its server-side project secrets into deployed Edge Functions.
Never copy a service-role/secret key into `index.html`, `run-api.js`, or any
other browser-visible file.

Optional allowed-origin configuration:

`KOPI_RUN_ALLOWED_ORIGINS=https://nootnoot0328.github.io`

For local browser testing, the function currently also allows:

- http://localhost:8000
- http://127.0.0.1:8000

## 4. Point the web app at the function

Before `run-api.js` is loaded, set:

```html
<script>
window.KOPI_RUN_API_BASE =
  "https://YOUR_PROJECT_REF.supabase.co/functions/v1/run-api";
</script>
```

Do not add this until the function has been deployed.

The URL is not a secret. Server/admin keys are.

## 5. First acceptance test

Before building groups, stats, payments, speech, or iOS:

1. Runner creates a run.
2. Kopi Run receives a public share token plus a separate runner key.
3. A second browser opens the shared run.
4. Participant submits a name and drink.
5. Runner retrieves the order.
6. Participant can edit only their own order using their edit token.
7. Runner closes the run.
8. Further submissions are rejected.

## Security model

- Share token: public; safe to send to a group chat.
- Runner key: private to the runner; required for runner-only operations.
- Edit token: private to the participant/browser; permits editing only that
  participant submission.
- Runner/edit credentials are stored in Postgres only as SHA-256 hashes.
- Database tables are not directly writable by `anon` or `authenticated`
  browser roles.

## Current branch files

- `index.html` — existing Kopi Run UI, preserved.
- `motion.css` — subtle interaction/entrance motion with Reduced Motion support.
- `run-api.js` — small browser API boundary.
- `sw.js` — offline shell cache updated for the new static files.
- `supabase/migrations/001_collaborative_runs.sql` — prototype schema.
- `supabase/functions/run-api/index.ts` — controlled collaborative endpoint.

The next code milestone is wiring **Start Run** and the participant URL UI to
this API after the Supabase project exists.
