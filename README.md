# jgs-be

API for **Jayanagiri EV Rental** (<https://jgs-ev.com>). Serves the public
rental-application form at `/formulir` and the admin console at `/admin`, both
of which live in the static frontend repo `chaedirdwiantara/jgs`.

- **Runtime:** Node 22 on AWS Lambda (arm64), behind an API Gateway HTTP API
- **Data:** DynamoDB (on-demand), S3 for identity documents
- **Region:** `ap-southeast-1`, account `121205961560` — the same account as
  `fleet-taxi-be`, but sharing no infrastructure with it

## Why serverless

The workload is a handful of form submissions a day plus a couple of operators
working an inbox. A container that is idle 99% of the time, or a database
instance that must stay awake to answer four queries an hour, would cost more
than the business it supports. Nothing here needs a long-lived process: there
are no queues, no websockets, no background workers.

## Architecture

Ports and adapters. The dependency arrow only ever points inwards.

```
src/
  domain/          entities + the interfaces (ports) they need. No I/O, no AWS.
  usecases/        one behaviour each, wired from ports. No HTTP, no framework.
  infrastructure/  the adapters: DynamoDB, S3, SSM, Telegram, scrypt, JWT.
    container.ts   the composition root — the only file that knows both sides.
  http/            Hono routes, validation, auth middleware, error mapping.
  config/env.ts    validated at boot; a bad deploy fails loudly, not quietly.
```

Practical consequence: `usecases/` is testable without AWS — see `test/`, where
the repositories are plain objects.

## Endpoints

Public (no auth):

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/vehicles` | Fleet catalogue |
| `POST` | `/uploads` | One presigned upload ticket per document |
| `POST` | `/applications` | Submit a rental application |

Console (bearer token from `POST /auth/login`):

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | → `{ token, expiresAt, user }` |
| `GET` | `/auth/me` | Current operator |
| `POST` | `/auth/password` | Change own password |
| `GET` | `/applications` | `?status=&limit=&cursor=` |
| `GET` | `/applications/summary` | Counts per status |
| `GET` | `/applications/:id` | Full record + signed document URLs |
| `PATCH` | `/applications/:id` | Status and internal note |
| `DELETE` | `/applications/:id` | Owner only; deletes the documents too |
| `POST`/`PUT`/`DELETE` | `/vehicles…` | Fleet CRUD |
| `GET`/`POST`/`PATCH`/`DELETE` | `/users…` | Owner only |
| `GET` | `/notifications`, `/notifications/unread-count` | Console bell |
| `POST` | `/notifications/:id/read`, `/notifications/read-all` | |

Errors are always `{ message, errors? }`, where `errors` maps a form field name
to a message. The frontend's `lib/api-client.ts` renders `errors` straight onto
the matching inputs.

## How documents are handled

The form collects KTP, a selfie with KTP, SIM, Kartu Keluarga and social-media
screenshots. These never pass through the API:

1. The browser asks for a ticket (`POST /uploads`). The server picks the object
   key — the client cannot choose it, so nobody can overwrite anyone else's.
2. The browser POSTs the file straight to S3. The presigned **POST** policy
   pins the content type and caps the size at 12 MB; S3 enforces both.
3. On submit, the API copies each referenced object out of the staging prefix
   into `applications/<id>/`. Abandoned uploads expire from `uploads/` after
   two days via a lifecycle rule.
4. The console reads documents through 15-minute signed URLs. The bucket blocks
   all public access and refuses non-TLS requests.

Deleting an application deletes its documents.

## Local development

```bash
npm install
cp .env.example .env     # then point it at the tables you may write to
npm run dev              # http://localhost:3001
```

There is no DynamoDB emulator in this setup: the local server talks to real AWS
resources using your own credentials.

```bash
npm run typecheck
npm test
```

## Deploying

See [docs/RUNBOOK.md](docs/RUNBOOK.md). Short version, from a clean checkout:

```bash
./scripts/bootstrap.sh                       # once per account
./scripts/deploy.sh                          # build + CloudFormation
npm run bootstrap:owner admin@jgs-ev.com "Nama Pemilik"
npm run seed:vehicles
```

Then set `NEXT_PUBLIC_API_BASE_URL` in the frontend to the stack's `ApiBaseUrl`
output, add that origin to `connect-src` in the frontend's `public/_headers`,
and rebuild the site.

Telegram alerts are configured separately and need no redeploy —
see [docs/TELEGRAM.md](docs/TELEGRAM.md).
