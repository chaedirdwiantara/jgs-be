# Runbook — `jgs-be`

Operational how-to for the JGS rental API. Architecture rationale is in the
[README](../README.md).

- **Account:** `121205961560` · **Region:** `ap-southeast-1`
- **Stack:** `jgs-be` (CloudFormation, SAM transform)
- **Frontend:** `chaedirdwiantara/jgs` → Cloudflare Pages → <https://jgs-ev.com>

---

## 1. What the stack contains

| Resource | Name | Deletion policy |
|---|---|---|
| DynamoDB | `jgs-users`, `jgs-applications`, `jgs-vehicles`, `jgs-notifications` | **Retain** |
| DynamoDB | `jgs-rate-limits` | Delete (disposable counters) |
| S3 | `jgs-documents-121205961560` | **Retain** |
| Lambda | `jgs-api` (Node 22, arm64, 512 MB) | Delete |
| API Gateway | HTTP API, `$default` stage | Delete |
| Logs | `/aws/lambda/jgs-api`, `/aws/apigateway/jgs-api`, 30-day retention | Delete |

The four tables holding real data and the document bucket are `Retain`: deleting
the stack must never take a renter's identity documents with it.

Point-in-time recovery is on for `jgs-users`, `jgs-applications` and
`jgs-vehicles`.

---

## 2. First-time setup

```bash
./scripts/bootstrap.sh
```

Creates the artifact bucket and three SSM parameters — `/jgs/prod/jwt-secret`
(random, SecureString), `/jgs/prod/telegram-bot-token` and
`/jgs/prod/telegram-chat-id` (both placeholders). Re-running never overwrites an
existing secret.

CloudFormation cannot create SecureString parameters, which is why these live
outside the template.

```bash
./scripts/deploy.sh
```

Builds the bundle, uploads it, and creates or updates the stack. Prints the
outputs, including `ApiBaseUrl`.

```bash
npm run bootstrap:owner admin@jgs-ev.com "Nama Pemilik"
npm run seed:vehicles
```

The first command prints a generated password **once** — sign in and change it
immediately (avatar menu → *Ubah kata sandi*). There is no sign-up endpoint; the
only ways to create an account are this script and an existing owner using the
console.

---

## 3. Connecting the frontend

1. Copy `ApiBaseUrl` from the stack outputs.
2. In `chaedirdwiantara/jgs`, set `NEXT_PUBLIC_API_BASE_URL` to it — as a
   Cloudflare Pages environment variable, and locally when building by hand.
3. Add the same origin to `connect-src` in `public/_headers`. **Without this
   the browser blocks every API call in production, and nothing in the build
   warns you.**
4. Rebuild and redeploy the site. `NEXT_PUBLIC_*` is inlined at build time.

Until step 2 happens the console runs in local (browser-storage) mode and the
form tells visitors to use WhatsApp instead — it never silently discards a
submission.

---

## 4. Routine deploys

```bash
./scripts/deploy.sh
```

Infrastructure and code go out together on purpose: the function's environment
variables are produced by the same template that creates the tables they name.

CI (`.github/workflows/`) runs typecheck + tests on every push and PR, and
deploys on a push to `main` — once `AWS_ROLE_ARN` is set as a repository secret
(see §7).

---

## 5. Everyday operations

**Read the logs.**

```bash
aws logs tail /aws/lambda/jgs-api --since 1h --follow --region ap-southeast-1
```

Logs are structured JSON. Useful events: `application_submitted`,
`application_honeypot_tripped`, `request_rejected` (every 4xx the API returned,
with the error code and the *names* of the offending fields), `telegram_send_failed`,
`unhandled_error`, `rate_limiter_unavailable`. Applicant field values are never
logged — only ids.

**"The form keeps failing."** Filter for `request_rejected` on `POST /applications`.
A `validation` code naming a field the form no longer has means the site and the
API are on different versions — check the Lambda's `LastModified` against the
latest merge, and remember that the Deploy workflow **skips** (with a warning)
while `AWS_ROLE_ARN` is unset.

**Trace one 500.** The response carries a request id; that id is on the
`unhandled_error` line.

```bash
aws logs filter-log-events --log-group-name /aws/lambda/jgs-api \
  --filter-pattern '"<request-id>"' --region ap-southeast-1
```

**Reset a locked-out owner's password.**

```bash
npm run bootstrap:owner <their-email> "<Nama>"
```

Run against an existing email, this resets the password rather than creating a
second account.

**Rotate the JWT signing key.** Invalidates every signed-in session immediately.

```bash
aws ssm put-parameter --name /jgs/prod/jwt-secret \
  --value "$(openssl rand -base64 48 | tr -d '\n')" \
  --type SecureString --overwrite --region ap-southeast-1
```

**Telegram.** See [TELEGRAM.md](TELEGRAM.md). Changing the bot or the group
needs no redeploy.

---

## 6. Limits currently enforced

| Where | Limit | Set in |
|---|---|---|
| Login | 5 attempts / email / 15 min; 20 / IP | `usecases/auth/login.ts` |
| Form submission | 5 / IP / hour | `usecases/applications/submit-application.ts` |
| Upload tickets | 60 / IP / hour | `usecases/applications/create-upload-ticket.ts` |
| Upload size | 12 MB, enforced by S3 | `create-upload-ticket.ts` |
| API Gateway | 25 req/s, burst 50 | `infra/template.yaml` |
| Access token | 8 hours | `ACCESS_TOKEN_TTL_HOURS` |

The rate limiter **fails open**: if its table is unavailable a genuine renter
can still submit. API Gateway throttling is the backstop.

---

## 7. GitHub Actions deploy role

CI authenticates with OIDC — no long-lived AWS keys.

1. Check whether the account already trusts GitHub (it does if `fleet-taxi-be`
   deploys this way):

   ```bash
   aws iam list-open-id-connect-providers
   ```

   If `token.actions.githubusercontent.com` is missing, create it once.

2. Create a role trusted by `repo:chaedirdwiantara/jgs-be:*` with permission to
   run `cloudformation deploy`, write to the artifact bucket, and pass the
   Lambda execution role.

3. Add its ARN as the repository secret `AWS_ROLE_ARN`.

Until then, deploy from a workstation with `./scripts/deploy.sh`.

---

## 8. Data retention

The system stores scans of national identity documents. Two things follow:

- **Delete rejected applications** once they are settled. Owner → *Pengajuan* →
  open → *Hapus*. This deletes the S3 objects as well.
- `uploads/` (abandoned half-finished forms) self-expires after two days.

There is no automatic expiry of *completed* applications, because how long a
rental business must keep its records is a decision for the business, not a
default worth guessing. When that policy exists, add an S3 lifecycle rule on
`applications/` and a TTL attribute on `jgs-applications`.

---

## 9. Rolling back

```bash
aws cloudformation describe-stack-events --stack-name jgs-be \
  --region ap-southeast-1 --max-items 20
```

A failed update rolls back on its own. To go back to a known-good commit, check
it out and run `./scripts/deploy.sh` again — the stack converges on whatever the
template says.

Data-losing changes are *not* covered by this: `Retain` protects the tables from
stack deletion, not from a migration you wrote. There are no migrations in this
system today — DynamoDB items are schemaless and every read tolerates a missing
attribute.
