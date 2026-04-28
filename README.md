# stampme

B2B SaaS for KSA merchants to issue digital loyalty stamp cards (Apple Wallet + Google Wallet) via the PassKit API.

See [`docs/superpowers/specs/2026-04-28-stampme-design.md`](./docs/superpowers/specs/2026-04-28-stampme-design.md) for the full design spec.

## Quick start

```bash
bun install
cp .env.example .env.local   # fill in real values
bunx prisma migrate dev
bun dev
```

Open http://localhost:3000 — landing page redirects to `/ar`.

## Stack

Next.js 15 · TypeScript strict · Tailwind + shadcn/ui · Prisma + Neon Postgres · Clerk · next-intl · Zod · Sentry · PostHog · Resend · Cloudflare R2 · Vercel
