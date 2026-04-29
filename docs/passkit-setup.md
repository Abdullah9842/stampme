# PassKit Integration — Setup Runbook

> **Current state:** `.env.local` contains stub values. Replace all `stub_replace_before_deploy`
> placeholders with real credentials before deploying to production (Task 12).

## 1. Create a PassKit account

1. Sign up at <https://passkit.com> (account already exists per project memory).
2. Navigate to **API Keys** → create a new key pair. You'll receive:
   - `PASSKIT_API_KEY` — the API key string (starts with `pk_live_`).
   - `PASSKIT_PUBLIC_KEY` / `PASSKIT_PRIVATE_KEY` — an EC P-256 keypair in PEM format.
     Download both; the private key is shown once.

## 2. Environment variables

| Variable | Where to get it | Required |
|---|---|---|
| `PASSKIT_API_URL` | Region-specific (Europe → `https://api.pub1.passkit.io`, others vary). Check **PassKit dashboard → API Region** | yes |
| `PASSKIT_API_KEY` | PassKit dashboard → API Keys | yes |
| `PASSKIT_PUBLIC_KEY` | Keypair download (PEM) | yes |
| `PASSKIT_PRIVATE_KEY` | Keypair download (PEM) | yes |
| `PASSKIT_WEBHOOK_SECRET` | PassKit dashboard → Webhooks (see §4) | yes |
| `PASSKIT_DEFAULT_TEMPLATE_ID` | PassKit dashboard → Templates | optional |
| `MARGIN_ALERT_EMAIL` | Operator email for cost-margin alerts | yes |
| `MARGIN_PASS_COST_USD` | Per-pass cost charged by PassKit (currently `0.10`) | yes |
| `CRON_SECRET` | Generate: `openssl rand -base64 48` — min 32 chars | yes |

Set all of these in `.env.local` (local dev) and in the Vercel project environment (production).

## 3. Pricing model

PassKit charges **per-pass issuance**. Current agreed rate: **$0.10 USD per pass**.

- `MARGIN_PASS_COST_USD` feeds into the margin-alert cron job (Plan 7).
- The cron job emails `MARGIN_ALERT_EMAIL` when effective per-pass revenue minus
  `MARGIN_PASS_COST_USD` drops below the configured threshold.
- Review PassKit's billing page monthly; update `MARGIN_PASS_COST_USD` if the rate changes.

## 4. Webhook registration

1. In the PassKit dashboard → **Webhooks** → add endpoint:
   ```
   https://stampme.com/api/webhooks/passkit
   ```
2. Select events: `pass.issued`, `pass.redeemed`, `pass.voided` (at minimum).
3. Copy the signing secret → set as `PASSKIT_WEBHOOK_SECRET`.
4. For local dev, use a tunnel (e.g. `ngrok http 3000`) and register the tunnel URL temporarily.

## 5. Template setup

1. In the PassKit dashboard → **Templates** → create a loyalty card template matching
   the stampme brand (logo, colors, field layout).
2. Copy the template ID → set as `PASSKIT_DEFAULT_TEMPLATE_ID`.
3. Each merchant can override this per-program; the default is the fallback.

## 6. Key format in env files

PassKit PEM keys must be single-line in `.env.local` with literal `\n` escapes:

```
PASSKIT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGHAgEA...\n-----END PRIVATE KEY-----"
```

The PassKit client in `src/lib/passkit/client.ts` calls `.replace(/\\n/g, '\n')` before
passing the key to `jose`.

## 7. Vercel deployment

In the Vercel dashboard → **Settings** → **Environment Variables**, add each variable.
For multiline PEM values, paste the raw PEM (Vercel handles newlines natively — no `\n` escaping needed in the Vercel UI).

## 8. Smoke test

After setting real credentials:

```bash
bun run dev
# Then hit the internal endpoint (add a test route or use curl):
curl -X POST http://localhost:3000/api/internal/passkit/ping
```

Expect a 200 with PassKit API reachable. Full integration tests run via `bun run test`.
