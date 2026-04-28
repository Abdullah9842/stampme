# stampme — Plan 3: PassKit Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire PassKit Members API as the wallet issuance backend. Service layer for programs/passes/stamps, webhook for install/remove events, idempotent retries, Sentry tagging, daily margin alert cron.

**Architecture:** PassKit SDK on server only. All wallet writes go through `src/lib/passkit/*` service layer. Webhooks verified via signature. Failures tagged in Sentry + Pass.status. Margin alert runs daily via Vercel cron.

**Tech Stack:** PassKit Members API, p-retry, Zod, Sentry, msw (tests)

**Depends on:** Plan 1 (project + DB), Plan 2 (Merchant + LoyaltyProgram rows exist with `passKitProgramId = null`)

**Spec reference:** `docs/superpowers/specs/2026-04-28-stampme-design.md` §6, §7, §8

---

## Pre-flight: API Surface Verification

PassKit's published Node SDK (`@passkit/passkit-node`) was last meaningfully updated for the gRPC `members` API. Their REST surface (`api.pub2.passkit.io`) is the supported path for new builds (lower coupling, easier mocking). This plan goes **REST-first via `undici`** with a thin typed client; the SDK is acceptable as a fallback if REST endpoints drift.

Reference URLs (verify in Task 1 before coding):
- Docs hub: https://docs.passkit.com/
- Members API: https://docs.passkit.com/members/
- REST reference: https://splend1dchan.github.io/passkit-rest-api-doc/ (community mirror) — cross-check against official portal
- Webhook signing: https://docs.passkit.com/webhooks/
- Auth: JWT signed with `EdDSA` over the public/private key pair PassKit issues per project. The JWT goes in `Authorization: PKAuth <token>` for REST.

---

## Task 1 — PassKit Account, Credentials, Env Wiring

**Files:**
- Create: `.env.example` (append)
- Create: `.env.local` (append; gitignored)
- Create: `docs/passkit-setup.md`
- Modify: `src/env.ts` (Plan 1 file — extend Zod schema)

**Steps:**

- [ ] Sign up at https://passkit.com/ (Members tier — required for stamp programs). Confirm pricing tier with sales **before** moving to Task 2 (spec §12 risk #1). Document tier and per-pass price in `docs/passkit-setup.md`.
- [ ] In PassKit Portal → Developer Tools → Generate **Project Member API Key**. Download the public/private Ed25519 key pair (`.pem` files). Store both `.pem` files outside the repo (e.g. `~/.config/stampme/passkit/`).
- [ ] In PassKit Portal → Webhooks → Create webhook for `https://stampme.com/api/webhooks/passkit` with events `pass.installed`, `pass.removed`, `pass.viewed`. Copy the webhook signing secret.
- [ ] Cross-check REST endpoints against https://docs.passkit.com/members/ (read auth + program create + pass create + pass update sections). Record any drift in `docs/passkit-setup.md`.
- [ ] Append to `.env.example`:

```bash
# ── PassKit ────────────────────────────────────────────────
PASSKIT_API_URL="https://api.pub2.passkit.io"
PASSKIT_API_KEY="pk_live_xxx"            # Project Member API key id
PASSKIT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
PASSKIT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
PASSKIT_WEBHOOK_SECRET="whsec_xxx"
PASSKIT_DEFAULT_TEMPLATE_ID="tpl_xxx"     # set after Task 3 first run; can stay empty initially
# Margin alert
MARGIN_ALERT_EMAIL="abdullah@stampme.com"
MARGIN_PASS_COST_USD="0.10"               # PassKit per-pass cost (confirm with sales)
CRON_SECRET="generate-with-openssl-rand"
```

- [ ] Mirror in `.env.local` with real values (multi-line keys: replace literal newlines with `\n` so `process.env` parses correctly; the client decodes them).
- [ ] Extend `src/env.ts` (created in Plan 1) Zod schema:

```ts
// inside the existing serverSchema z.object({...})
PASSKIT_API_URL: z.string().url(),
PASSKIT_API_KEY: z.string().min(1),
PASSKIT_PUBLIC_KEY: z.string().min(1),
PASSKIT_PRIVATE_KEY: z.string().min(1),
PASSKIT_WEBHOOK_SECRET: z.string().min(1),
PASSKIT_DEFAULT_TEMPLATE_ID: z.string().optional(),
MARGIN_ALERT_EMAIL: z.string().email(),
MARGIN_PASS_COST_USD: z.coerce.number().positive(),
CRON_SECRET: z.string().min(32),
```

- [ ] Install dependencies:

```bash
bun add undici p-retry jose
bun add -d msw @types/node
```

(`jose` signs the EdDSA JWTs PassKit expects. `svix` is reused from Plan 1's Clerk webhook setup — DO NOT reinstall.)

- [ ] Run `bun run typecheck` — must pass before commit.
- [ ] **Commit:** `chore(passkit): add env vars, deps, setup docs for PassKit Members API`

---

## Task 2 — Schema Migration: `ISSUE_FAILED` enum value

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_pass_status_issue_failed/migration.sql`
- Create: `src/lib/passkit/__tests__/schema.test.ts`

**Steps:**

- [ ] Edit `prisma/schema.prisma`:

```prisma
enum PassStatus {
  ACTIVE
  REDEEMED
  EXPIRED
  DELETED
  ISSUE_FAILED
}
```

- [ ] Generate migration:

```bash
bunx prisma migrate dev --name pass_status_issue_failed
```

- [ ] Verify generated SQL contains:

```sql
ALTER TYPE "PassStatus" ADD VALUE 'ISSUE_FAILED';
```

- [ ] Write a tiny Prisma-level smoke test in `src/lib/passkit/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PassStatus } from "@prisma/client";

describe("PassStatus enum", () => {
  it("includes ISSUE_FAILED", () => {
    expect(PassStatus.ISSUE_FAILED).toBe("ISSUE_FAILED");
  });
});
```

- [ ] Run `bun run test src/lib/passkit/__tests__/schema.test.ts` — must pass.
- [ ] **Commit:** `feat(db): add ISSUE_FAILED to PassStatus enum`

---

## Task 3 — Typed Errors + Shared Types

**Files:**
- Create: `src/lib/passkit/types.ts`
- Create: `src/lib/passkit/__tests__/types.test.ts`

**Steps:**

- [ ] Write failing test first at `src/lib/passkit/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PassKitError, PassKitErrorCode } from "../types";

describe("PassKitError", () => {
  it("preserves code, status, and cause", () => {
    const cause = new Error("network down");
    const err = new PassKitError({
      code: PassKitErrorCode.NETWORK,
      message: "boom",
      status: 503,
      cause,
    });
    expect(err.code).toBe("NETWORK");
    expect(err.status).toBe(503);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("PassKitError");
  });

  it("is JSON-serialisable without leaking the cause stack", () => {
    const err = new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "upstream 500",
      status: 500,
    });
    const json = err.toJSON();
    expect(json).toMatchObject({ name: "PassKitError", code: "UPSTREAM", status: 500 });
    expect(JSON.stringify(json)).not.toContain("cause");
  });
});
```

- [ ] Run test — must FAIL (red).
- [ ] Implement `src/lib/passkit/types.ts`:

```ts
import { z } from "zod";

export const PassKitErrorCode = {
  NETWORK: "NETWORK",
  AUTH: "AUTH",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM: "UPSTREAM",
  WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  UNKNOWN: "UNKNOWN",
} as const;
export type PassKitErrorCode = (typeof PassKitErrorCode)[keyof typeof PassKitErrorCode];

export class PassKitError extends Error {
  readonly code: PassKitErrorCode;
  readonly status?: number;
  readonly upstream?: unknown;

  constructor(opts: {
    code: PassKitErrorCode;
    message: string;
    status?: number;
    cause?: unknown;
    upstream?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "PassKitError";
    this.code = opts.code;
    this.status = opts.status;
    this.upstream = opts.upstream;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
    };
  }
}

// Inputs
export const CreateProgramInput = z.object({
  merchantId: z.string().min(1),
  name: z.string().min(1).max(60),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  logoUrl: z.string().url(),
  rewardLabel: z.string().min(1).max(60),
  stampsRequired: z.number().int().min(1).max(20),
});
export type CreateProgramInput = z.infer<typeof CreateProgramInput>;

export const UpdateProgramTemplateInput = CreateProgramInput.omit({ merchantId: true })
  .extend({ programId: z.string().min(1) });
export type UpdateProgramTemplateInput = z.infer<typeof UpdateProgramTemplateInput>;

export const IssuePassInput = z.object({
  programId: z.string().min(1),
  customerPhone: z.string().regex(/^\+?[1-9]\d{6,14}$/), // E.164
  idempotencyKey: z.string().min(8),
});
export type IssuePassInput = z.infer<typeof IssuePassInput>;

export const UpdatePassStampsInput = z.object({
  passKitPassId: z.string().min(1),
  stampsCount: z.number().int().min(0).max(50),
  idempotencyKey: z.string().min(8),
});
export type UpdatePassStampsInput = z.infer<typeof UpdatePassStampsInput>;

export const MarkRedeemedInput = z.object({
  passKitPassId: z.string().min(1),
  idempotencyKey: z.string().min(8),
});
export type MarkRedeemedInput = z.infer<typeof MarkRedeemedInput>;

// Outputs
export interface CreateProgramOutput {
  passKitProgramId: string;
  passKitTemplateId: string;
}
export interface IssuePassOutput {
  passKitPassId: string;
  applePassUrl: string;
  googleWalletUrl: string;
}

// Webhook events
export const PassKitWebhookEvent = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("pass.installed"),
    passId: z.string(),
    programId: z.string(),
    platform: z.enum(["apple", "google"]),
    timestamp: z.string().datetime(),
  }),
  z.object({
    event: z.literal("pass.removed"),
    passId: z.string(),
    programId: z.string(),
    platform: z.enum(["apple", "google"]),
    timestamp: z.string().datetime(),
  }),
  z.object({
    event: z.literal("pass.viewed"),
    passId: z.string(),
    programId: z.string(),
    timestamp: z.string().datetime(),
  }),
]);
export type PassKitWebhookEvent = z.infer<typeof PassKitWebhookEvent>;
```

- [ ] Re-run test — green.
- [ ] **Commit:** `feat(passkit): typed errors, Zod input schemas, webhook event union`

---

## Task 4 — REST Client Singleton with EdDSA JWT Auth + Retry

**Files:**
- Create: `src/lib/passkit/client.ts`
- Create: `src/lib/passkit/__tests__/client.test.ts`
- Create: `src/lib/passkit/__tests__/msw-server.ts`

**Steps:**

- [ ] Set up MSW server in `src/lib/passkit/__tests__/msw-server.ts`:

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const handlers = {
  authOk: http.post("https://api.pub2.passkit.io/auth/refresh", () =>
    HttpResponse.json({ token: "test-jwt", expiresIn: 3600 }),
  ),
};

export const server = setupServer(handlers.authOk);
```

- [ ] Write failing test `src/lib/passkit/__tests__/client.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { passkitClient } from "../client";
import { PassKitError } from "../types";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("passkitClient.request", () => {
  it("attaches PKAuth bearer header", async () => {
    let received: string | null = null;
    server.use(
      http.get("https://api.pub2.passkit.io/programs/p1", ({ request }) => {
        received = request.headers.get("authorization");
        return HttpResponse.json({ id: "p1" });
      }),
    );
    const res = await passkitClient.request<{ id: string }>("GET", "/programs/p1");
    expect(received).toMatch(/^PKAuth /);
    expect(res.id).toBe("p1");
  });

  it("retries 3 times on 503 then throws PassKitError UPSTREAM", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.pub2.passkit.io/programs/p2", () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    await expect(passkitClient.request("GET", "/programs/p2")).rejects.toBeInstanceOf(PassKitError);
    expect(calls).toBe(3);
  });

  it("does NOT retry on 422 validation", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.pub2.passkit.io/programs", () => {
        calls += 1;
        return HttpResponse.json({ message: "bad shape" }, { status: 422 });
      }),
    );
    await expect(passkitClient.request("POST", "/programs", { body: {} }))
      .rejects.toMatchObject({ code: "VALIDATION", status: 422 });
    expect(calls).toBe(1);
  });

  it("propagates Idempotency-Key header", async () => {
    let received: string | null = null;
    server.use(
      http.post("https://api.pub2.passkit.io/passes", ({ request }) => {
        received = request.headers.get("idempotency-key");
        return HttpResponse.json({ id: "px" });
      }),
    );
    await passkitClient.request("POST", "/passes", { body: {}, idempotencyKey: "abc12345" });
    expect(received).toBe("abc12345");
  });
});
```

- [ ] Run — fails because `client.ts` doesn't exist yet.
- [ ] Implement `src/lib/passkit/client.ts`:

```ts
import { request as undiciRequest } from "undici";
import pRetry, { AbortError } from "p-retry";
import { SignJWT, importPKCS8 } from "jose";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env";
import { PassKitError, PassKitErrorCode } from "./types";

interface RequestOpts {
  body?: unknown;
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

class PassKitClient {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  private async signJwt(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const pkcs8 = env.PASSKIT_PRIVATE_KEY.replace(/\\n/g, "\n");
    const key = await importPKCS8(pkcs8, "EdDSA");
    return new SignJWT({ key: env.PASSKIT_API_KEY })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 50)
      .setIssuer(env.PASSKIT_API_KEY)
      .sign(key);
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token;
    }
    const token = await this.signJwt();
    this.cachedToken = { token, expiresAt: now + 50 * 60 * 1000 };
    return token;
  }

  async request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: RequestOpts = {}): Promise<T> {
    const url = new URL(path, env.PASSKIT_API_URL);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const run = async () => {
      const token = await this.getToken();
      const headers: Record<string, string> = {
        authorization: `PKAuth ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      };
      if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

      const res = await undiciRequest(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });

      const text = await res.body.text();
      const json = text ? safeJson(text) : null;

      if (res.statusCode >= 200 && res.statusCode < 300) return json as T;

      const code = mapStatus(res.statusCode);
      const err = new PassKitError({
        code,
        message: extractMessage(json) ?? `PassKit ${method} ${path} → ${res.statusCode}`,
        status: res.statusCode,
        upstream: json ?? text,
      });

      // 4xx (except 408/429) are non-retryable
      if (res.statusCode < 500 && res.statusCode !== 408 && res.statusCode !== 429) {
        throw new AbortError(err);
      }
      throw err;
    };

    try {
      return await pRetry(run, {
        retries: 2, // total 3 attempts
        minTimeout: 250,
        factor: 2,
        randomize: true,
      });
    } catch (e) {
      const err = e instanceof AbortError ? (e as AbortError & { originalError?: PassKitError }).originalError ?? e : e;
      const final = err instanceof PassKitError
        ? err
        : new PassKitError({
            code: PassKitErrorCode.NETWORK,
            message: (err as Error).message ?? "passkit request failed",
            cause: err,
          });
      Sentry.captureException(final, {
        tags: { vendor: "passkit", endpoint: `${method} ${path}`, code: final.code },
        extra: { status: final.status, upstream: final.upstream },
      });
      throw final;
    }
  }
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

function extractMessage(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const j = json as Record<string, unknown>;
  return (j.message as string) ?? (j.error as string) ?? undefined;
}

function mapStatus(status: number): PassKitErrorCode {
  if (status === 401 || status === 403) return PassKitErrorCode.AUTH;
  if (status === 404) return PassKitErrorCode.NOT_FOUND;
  if (status === 409) return PassKitErrorCode.CONFLICT;
  if (status === 422) return PassKitErrorCode.VALIDATION;
  if (status === 429) return PassKitErrorCode.RATE_LIMITED;
  if (status >= 500) return PassKitErrorCode.UPSTREAM;
  return PassKitErrorCode.UNKNOWN;
}

// Note: AbortError + originalError pattern — p-retry treats AbortError as fatal.
// We stash the real error onto `originalError` so the catch block can rethrow it.
class _Abort extends AbortError {
  originalError: PassKitError;
  constructor(err: PassKitError) {
    super(err.message);
    this.originalError = err;
  }
}
// Replace AbortError import sentinel above:
// (Tests assert PassKitError surfaces, not AbortError.)

export const passkitClient = new PassKitClient();
```

> Note for implementer: the `AbortError` wrapping pattern is intentional — we throw `new AbortError(err)` so `p-retry` does not retry, then unwrap in the catch. If you prefer the new `pRetry` shouldRetry option (v6+), simplify with:
> ```ts
> shouldRetry: (e) => e instanceof PassKitError && (e.status ?? 500) >= 500
> ```
> Use whichever matches the installed `p-retry` major. Tests above remain valid.

- [ ] Re-run tests — green.
- [ ] Add Vitest setup wiring in `vitest.config.ts` (Plan 1 file) so `msw` works in node env. Confirm `setupFiles` includes msw bootstrap or each test file calls `server.listen()`.
- [ ] **Commit:** `feat(passkit): REST client with EdDSA JWT auth, p-retry, Sentry tagging`

---

## Task 5 — `programs.ts`: createProgram + updateProgramTemplate

**Files:**
- Create: `src/lib/passkit/programs.ts`
- Create: `src/lib/passkit/__tests__/programs.test.ts`

**Steps:**

- [ ] Write failing tests `src/lib/passkit/__tests__/programs.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { createProgram, updateProgramTemplate } from "../programs";
import { PassKitError } from "../types";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const validProgram = {
  merchantId: "m_1",
  name: "Brew Bros Loyalty",
  brandColor: "#0F4C3A",
  logoUrl: "https://r2.stampme.com/m_1/logo.png",
  rewardLabel: "Free coffee",
  stampsRequired: 10,
};

describe("createProgram", () => {
  it("POSTs /members/program and returns ids", async () => {
    server.use(
      http.post("https://api.pub2.passkit.io/members/program", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.name).toBe("Brew Bros Loyalty");
        expect(request.headers.get("idempotency-key")).toBe("m_1");
        return HttpResponse.json({ id: "prg_abc", templateId: "tpl_abc" });
      }),
    );
    const out = await createProgram(validProgram);
    expect(out).toEqual({ passKitProgramId: "prg_abc", passKitTemplateId: "tpl_abc" });
  });

  it("rejects invalid input via Zod", async () => {
    await expect(createProgram({ ...validProgram, brandColor: "red" } as never))
      .rejects.toBeInstanceOf(PassKitError);
  });

  it("is idempotent — same merchantId re-uses key", async () => {
    let count = 0;
    server.use(
      http.post("https://api.pub2.passkit.io/members/program", () => {
        count += 1;
        return HttpResponse.json({ id: "prg_abc", templateId: "tpl_abc" });
      }),
    );
    await createProgram(validProgram);
    await createProgram(validProgram);
    expect(count).toBe(2); // PassKit dedupes server-side via Idempotency-Key
  });
});

describe("updateProgramTemplate", () => {
  it("PUTs /members/program/template/{programId}", async () => {
    server.use(
      http.put("https://api.pub2.passkit.io/members/program/template/prg_abc", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.backgroundColor).toBe("#0F4C3A");
        expect(body.images).toMatchObject({ logo: "https://r2.stampme.com/m_1/logo.png" });
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(
      updateProgramTemplate({ programId: "prg_abc", ...validProgram }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] Run — fails (file missing).
- [ ] Implement `src/lib/passkit/programs.ts`:

```ts
import { passkitClient } from "./client";
import {
  CreateProgramInput,
  CreateProgramOutput,
  PassKitError,
  PassKitErrorCode,
  UpdateProgramTemplateInput,
} from "./types";

export async function createProgram(input: CreateProgramInput): Promise<CreateProgramOutput> {
  const parsed = CreateProgramInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { merchantId, name, brandColor, logoUrl, rewardLabel, stampsRequired } = parsed.data;

  const body = {
    name,
    description: rewardLabel,
    backgroundColor: brandColor,
    foregroundColor: "#FFFFFF",
    labelColor: "#FFFFFF",
    images: { logo: logoUrl, icon: logoUrl },
    fields: {
      header: [{ key: "stamps", label: "Stamps", value: `0/${stampsRequired}` }],
      secondary: [{ key: "reward", label: "Reward", value: rewardLabel }],
    },
    metadata: {
      stampsRequired,
      merchantId,
      app: "stampme",
    },
  };

  const res = await passkitClient.request<{ id: string; templateId: string }>(
    "POST",
    "/members/program",
    { body, idempotencyKey: merchantId },
  );

  if (!res?.id || !res?.templateId) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "PassKit createProgram returned no id",
      upstream: res,
    });
  }

  return { passKitProgramId: res.id, passKitTemplateId: res.templateId };
}

export async function updateProgramTemplate(input: UpdateProgramTemplateInput): Promise<void> {
  const parsed = UpdateProgramTemplateInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { programId, brandColor, logoUrl, rewardLabel, stampsRequired, name } = parsed.data;

  await passkitClient.request<unknown>(
    "PUT",
    `/members/program/template/${encodeURIComponent(programId)}`,
    {
      body: {
        name,
        backgroundColor: brandColor,
        foregroundColor: "#FFFFFF",
        labelColor: "#FFFFFF",
        images: { logo: logoUrl, icon: logoUrl },
        fields: {
          header: [{ key: "stamps", label: "Stamps", value: `0/${stampsRequired}` }],
          secondary: [{ key: "reward", label: "Reward", value: rewardLabel }],
        },
      },
      idempotencyKey: `tpl:${programId}`,
    },
  );
}
```

- [ ] Run tests — green.
- [ ] **Commit:** `feat(passkit): createProgram + updateProgramTemplate service`

---

## Task 6 — `passes.ts`: issuePass + updatePassStamps + markRedeemed

**Files:**
- Create: `src/lib/passkit/passes.ts`
- Create: `src/lib/passkit/__tests__/passes.test.ts`

**Steps:**

- [ ] Write failing test `src/lib/passkit/__tests__/passes.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { issuePass, markRedeemed, updatePassStamps } from "../passes";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("issuePass", () => {
  it("creates a member with phone identifier and returns wallet URLs", async () => {
    server.use(
      http.post("https://api.pub2.passkit.io/members/member", async ({ request }) => {
        expect(request.headers.get("idempotency-key")).toBe("idem-12345");
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.programId).toBe("prg_1");
        expect((body.person as Record<string, unknown>).phone).toBe("+966501234567");
        return HttpResponse.json({
          id: "psk_x",
          links: {
            apple: "https://pub2.pskt.io/psk_x?type=apple",
            google: "https://pub2.pskt.io/psk_x?type=google",
          },
        });
      }),
    );
    const res = await issuePass({
      programId: "prg_1",
      customerPhone: "+966501234567",
      idempotencyKey: "idem-12345",
    });
    expect(res.passKitPassId).toBe("psk_x");
    expect(res.applePassUrl).toContain("apple");
    expect(res.googleWalletUrl).toContain("google");
  });
});

describe("updatePassStamps", () => {
  it("PATCHes member with stamps field", async () => {
    server.use(
      http.put("https://api.pub2.passkit.io/members/member/psk_x", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect((body.fields as Record<string, unknown>).stamps).toBe("3/10");
        return HttpResponse.json({ ok: true });
      }),
    );
    await updatePassStamps({ passKitPassId: "psk_x", stampsCount: 3, idempotencyKey: "stamp-3-psk_x" });
  });
});

describe("markRedeemed", () => {
  it("resets stamps to 0 + tags redemption", async () => {
    server.use(
      http.put("https://api.pub2.passkit.io/members/member/psk_x", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect((body.fields as Record<string, unknown>).stamps).toBe("0/10");
        expect((body.metadata as Record<string, unknown>).lastRedemptionAt).toBeTruthy();
        return HttpResponse.json({ ok: true });
      }),
    );
    await markRedeemed({ passKitPassId: "psk_x", idempotencyKey: "redeem-psk_x-1" });
  });
});
```

- [ ] Run — fails.
- [ ] Implement `src/lib/passkit/passes.ts`:

```ts
import { passkitClient } from "./client";
import { prisma } from "@/lib/prisma";
import {
  IssuePassInput,
  IssuePassOutput,
  MarkRedeemedInput,
  PassKitError,
  PassKitErrorCode,
  UpdatePassStampsInput,
} from "./types";

export async function issuePass(input: IssuePassInput): Promise<IssuePassOutput> {
  const parsed = IssuePassInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({ code: PassKitErrorCode.VALIDATION, message: parsed.error.message });
  }
  const { programId, customerPhone, idempotencyKey } = parsed.data;

  const program = await prisma.loyaltyProgram.findUnique({
    where: { passKitProgramId: programId },
  });
  if (!program) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `LoyaltyProgram with passKitProgramId=${programId} not found`,
    });
  }

  const body = {
    programId,
    person: { phone: customerPhone },
    fields: { stamps: `0/${program.stampsRequired}` },
    metadata: { phone: customerPhone, app: "stampme" },
  };

  const res = await passkitClient.request<{
    id: string;
    links: { apple: string; google: string };
  }>("POST", "/members/member", { body, idempotencyKey });

  if (!res?.id || !res.links?.apple || !res.links?.google) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "issuePass: missing id or wallet links",
      upstream: res,
    });
  }

  return {
    passKitPassId: res.id,
    applePassUrl: res.links.apple,
    googleWalletUrl: res.links.google,
  };
}

export async function updatePassStamps(input: UpdatePassStampsInput): Promise<void> {
  const parsed = UpdatePassStampsInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({ code: PassKitErrorCode.VALIDATION, message: parsed.error.message });
  }
  const { passKitPassId, stampsCount, idempotencyKey } = parsed.data;

  const pass = await prisma.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `Pass passKitPassId=${passKitPassId} not in DB`,
    });
  }

  await passkitClient.request<unknown>(
    "PUT",
    `/members/member/${encodeURIComponent(passKitPassId)}`,
    {
      body: {
        fields: { stamps: `${stampsCount}/${pass.program.stampsRequired}` },
        metadata: { stampsCount },
      },
      idempotencyKey,
    },
  );
}

export async function markRedeemed(input: MarkRedeemedInput): Promise<void> {
  const parsed = MarkRedeemedInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({ code: PassKitErrorCode.VALIDATION, message: parsed.error.message });
  }
  const { passKitPassId, idempotencyKey } = parsed.data;

  const pass = await prisma.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `Pass ${passKitPassId} not found`,
    });
  }

  await passkitClient.request<unknown>(
    "PUT",
    `/members/member/${encodeURIComponent(passKitPassId)}`,
    {
      body: {
        fields: { stamps: `0/${pass.program.stampsRequired}` },
        metadata: {
          stampsCount: 0,
          lastRedemptionAt: new Date().toISOString(),
        },
      },
      idempotencyKey,
    },
  );
}
```

- [ ] Tests must mock `prisma.loyaltyProgram.findUnique` / `prisma.pass.findUnique`. Add `vi.mock("@/lib/prisma", ...)` at the top of `passes.test.ts`:

```ts
vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyProgram: {
      findUnique: vi.fn().mockResolvedValue({
        id: "lp_1",
        passKitProgramId: "prg_1",
        stampsRequired: 10,
      }),
    },
    pass: {
      findUnique: vi.fn().mockResolvedValue({
        id: "p_1",
        passKitPassId: "psk_x",
        program: { stampsRequired: 10 },
      }),
    },
  },
}));
```

- [ ] Run — green.
- [ ] **Commit:** `feat(passkit): issuePass, updatePassStamps, markRedeemed services`

---

## Task 7 — Webhook Signature Verification

**Files:**
- Create: `src/lib/passkit/webhooks.ts`
- Create: `src/lib/passkit/__tests__/webhooks.test.ts`

**Steps:**

PassKit signs webhook bodies as `sha256=<hex(hmac_sha256(secret, raw_body))>` in the `X-PassKit-Signature` header (verify exact header name in PassKit dashboard at Task 1; spec defaults to that). Plus a `X-PassKit-Timestamp` to prevent replay.

- [ ] Write failing test `src/lib/passkit/__tests__/webhooks.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/env", () => ({
  env: { PASSKIT_WEBHOOK_SECRET: "whsec_test" },
}));

import { verifyPassKitSignature } from "../webhooks";
import { PassKitError } from "../types";

const sign = (body: string, ts: string) =>
  "sha256=" + createHmac("sha256", "whsec_test").update(`${ts}.${body}`).digest("hex");

describe("verifyPassKitSignature", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-04-28T10:00:00Z")));

  it("accepts a valid signature within tolerance", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"event":"pass.installed"}';
    expect(() =>
      verifyPassKitSignature({ rawBody: body, signature: sign(body, ts), timestamp: ts }),
    ).not.toThrow();
  });

  it("rejects tampered body", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign('{"event":"pass.installed"}', ts);
    expect(() =>
      verifyPassKitSignature({ rawBody: '{"event":"pass.removed"}', signature: sig, timestamp: ts }),
    ).toThrow(PassKitError);
  });

  it("rejects wrong secret signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const bad = "sha256=" + createHmac("sha256", "wrong").update(`${ts}.{}`).digest("hex");
    expect(() => verifyPassKitSignature({ rawBody: "{}", signature: bad, timestamp: ts }))
      .toThrow(PassKitError);
  });

  it("rejects timestamp older than 5 minutes", () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const body = "{}";
    expect(() => verifyPassKitSignature({ rawBody: body, signature: sign(body, oldTs), timestamp: oldTs }))
      .toThrow(/timestamp/i);
  });

  it("rejects malformed signature header", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() => verifyPassKitSignature({ rawBody: "{}", signature: "garbage", timestamp: ts }))
      .toThrow(PassKitError);
  });
});
```

- [ ] Run — fails.
- [ ] Implement `src/lib/passkit/webhooks.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { PassKitError, PassKitErrorCode } from "./types";

const TOLERANCE_SECONDS = 5 * 60;

export interface VerifyArgs {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}

export function verifyPassKitSignature({ rawBody, signature, timestamp }: VerifyArgs): void {
  if (!signature || !timestamp) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "missing signature or timestamp",
    });
  }
  if (!signature.startsWith("sha256=")) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "malformed signature header",
    });
  }
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "invalid timestamp",
    });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TOLERANCE_SECONDS) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: `timestamp outside tolerance (${nowSec - ts}s)`,
    });
  }
  const expected = createHmac("sha256", env.PASSKIT_WEBHOOK_SECRET)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  const provided = signature.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "signature mismatch",
    });
  }
}
```

- [ ] Run — green.
- [ ] **Commit:** `feat(passkit): HMAC webhook signature verification with replay protection`

---

## Task 8 — Webhook Route Handler

**Files:**
- Create: `src/app/api/webhooks/passkit/route.ts`
- Create: `src/app/api/webhooks/passkit/__tests__/route.test.ts`

**Steps:**

- [ ] Write failing route test `src/app/api/webhooks/passkit/__tests__/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/env", () => ({ env: { PASSKIT_WEBHOOK_SECRET: "whsec_test" } }));
const updatePass = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { pass: { update: updatePass, findUnique: vi.fn() } },
}));
const captureEvent = vi.fn();
vi.mock("posthog-node", () => ({
  PostHog: class { capture = captureEvent; shutdown = vi.fn(); },
}));

import { POST } from "../route";

const buildReq = (body: object) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", "whsec_test").update(`${ts}.${raw}`).digest("hex");
  return new Request("http://test/api/webhooks/passkit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-passkit-signature": sig,
      "x-passkit-timestamp": ts,
    },
    body: raw,
  });
};

describe("POST /api/webhooks/passkit", () => {
  beforeEach(() => {
    updatePass.mockReset();
    captureEvent.mockReset();
  });

  it("400 on bad signature", async () => {
    const req = new Request("http://test/api/webhooks/passkit", {
      method: "POST",
      headers: { "x-passkit-signature": "sha256=00", "x-passkit-timestamp": String(Math.floor(Date.now()/1000)) },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("marks pass DELETED on pass.removed", async () => {
    const req = buildReq({
      event: "pass.removed",
      passId: "psk_1",
      programId: "prg_1",
      platform: "apple",
      timestamp: new Date().toISOString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(updatePass).toHaveBeenCalledWith({
      where: { passKitPassId: "psk_1" },
      data: { status: "DELETED" },
    });
  });

  it("captures PostHog event on pass.viewed", async () => {
    const req = buildReq({
      event: "pass.viewed",
      passId: "psk_1",
      programId: "prg_1",
      timestamp: new Date().toISOString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(captureEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "pass_viewed" }));
  });
});
```

- [ ] Run — fails (route missing).
- [ ] Implement `src/app/api/webhooks/passkit/route.ts`:

```ts
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { PostHog } from "posthog-node";
import { prisma } from "@/lib/prisma";
import { verifyPassKitSignature } from "@/lib/passkit/webhooks";
import { PassKitError, PassKitWebhookEvent } from "@/lib/passkit/types";
import { env } from "@/env";

export const runtime = "nodejs"; // need crypto + prisma
export const dynamic = "force-dynamic";

const posthog = new PostHog(env.POSTHOG_KEY ?? "", { host: env.POSTHOG_HOST ?? "https://eu.i.posthog.com" });

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-passkit-signature");
  const timestamp = req.headers.get("x-passkit-timestamp");

  try {
    verifyPassKitSignature({ rawBody, signature, timestamp });
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "passkit", stage: "webhook-verify" } });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = PassKitWebhookEvent.parse(JSON.parse(rawBody));
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "passkit", stage: "webhook-parse" } });
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    switch (parsed.event) {
      case "pass.installed":
        Sentry.addBreadcrumb({ category: "passkit", message: `pass.installed ${parsed.passId}` });
        break;

      case "pass.removed":
        await prisma.pass.update({
          where: { passKitPassId: parsed.passId },
          data: { status: "DELETED" },
        });
        break;

      case "pass.viewed":
        posthog.capture({
          distinctId: parsed.passId,
          event: "pass_viewed",
          properties: { programId: parsed.programId },
        });
        break;
    }
  } catch (e) {
    // Don't fail PassKit's webhook delivery — log + 200
    Sentry.captureException(e, { tags: { vendor: "passkit", event: parsed.event, passId: parsed.passId } });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] Run — green.
- [ ] Smoke-test locally with `curl` + a hand-signed body before deploying.
- [ ] **Commit:** `feat(passkit): webhook handler with signature verify + event routing`

---

## Task 9 — `syncProgram` Server Action (Backfill + Idempotent Sync Button)

**Files:**
- Create: `src/lib/actions/syncProgram.ts`
- Create: `src/lib/actions/__tests__/syncProgram.test.ts`
- Modify: `src/lib/actions/onboarding.ts` (Plan 2 file — **single line addition**)
- Modify: `src/app/(dashboard)/cards/page.tsx` (Plan 2 file — add "Sync to wallet" button calling this action)

**Steps:**

- [ ] Write failing test `src/lib/actions/__tests__/syncProgram.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyProgram: { findUnique, update },
    merchant: { findUnique: vi.fn() },
  },
}));
const createProgram = vi.fn();
const updateProgramTemplate = vi.fn();
vi.mock("@/lib/passkit/programs", () => ({ createProgram, updateProgramTemplate }));

import { syncProgram } from "../syncProgram";

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  createProgram.mockReset();
  updateProgramTemplate.mockReset();
});

describe("syncProgram", () => {
  it("creates program when passKitProgramId is null", async () => {
    findUnique.mockResolvedValue({
      id: "lp_1",
      merchantId: "m_1",
      passKitProgramId: null,
      name: "Loyalty",
      stampsRequired: 10,
      rewardLabel: "Free coffee",
      merchant: { id: "m_1", name: "Brew Bros", brandColor: "#0F4C3A", logoUrl: "https://r2/x.png" },
    });
    createProgram.mockResolvedValue({ passKitProgramId: "prg_x", passKitTemplateId: "tpl_x" });
    update.mockResolvedValue({});

    const out = await syncProgram({ loyaltyProgramId: "lp_1" });
    expect(out.passKitProgramId).toBe("prg_x");
    expect(createProgram).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: "lp_1" },
      data: { passKitProgramId: "prg_x" },
    });
  });

  it("idempotent: when programId exists, only updates template", async () => {
    findUnique.mockResolvedValue({
      id: "lp_1",
      merchantId: "m_1",
      passKitProgramId: "prg_x",
      name: "Loyalty",
      stampsRequired: 10,
      rewardLabel: "Free coffee",
      merchant: { id: "m_1", name: "Brew Bros", brandColor: "#0F4C3A", logoUrl: "https://r2/x.png" },
    });
    await syncProgram({ loyaltyProgramId: "lp_1" });
    expect(createProgram).not.toHaveBeenCalled();
    expect(updateProgramTemplate).toHaveBeenCalledOnce();
  });

  it("missing logo throws — wallet pass requires it", async () => {
    findUnique.mockResolvedValue({
      id: "lp_1",
      merchantId: "m_1",
      passKitProgramId: null,
      name: "x",
      stampsRequired: 10,
      rewardLabel: "x",
      merchant: { id: "m_1", name: "Brew Bros", brandColor: "#0F4C3A", logoUrl: null },
    });
    await expect(syncProgram({ loyaltyProgramId: "lp_1" })).rejects.toThrow(/logo/i);
  });
});
```

- [ ] Run — fails.
- [ ] Implement `src/lib/actions/syncProgram.ts`:

```ts
"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { createProgram, updateProgramTemplate } from "@/lib/passkit/programs";
import { auth } from "@clerk/nextjs/server"; // Plan 1 auth
import { PassKitError, PassKitErrorCode } from "@/lib/passkit/types";

const Input = z.object({ loyaltyProgramId: z.string().min(1) });
type Input = z.infer<typeof Input>;

export interface SyncProgramResult {
  passKitProgramId: string;
  created: boolean;
}

export async function syncProgram(input: Input): Promise<SyncProgramResult> {
  const { loyaltyProgramId } = Input.parse(input);

  const program = await prisma.loyaltyProgram.findUnique({
    where: { id: loyaltyProgramId },
    include: { merchant: true },
  });
  if (!program) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `LoyaltyProgram ${loyaltyProgramId} not found`,
    });
  }

  // AuthZ: only the owning merchant can sync (skip in cron — see Task 11)
  const session = await auth();
  if (session?.userId && session.userId !== program.merchant.clerkUserId) {
    throw new PassKitError({
      code: PassKitErrorCode.AUTH,
      message: "not authorised to sync this program",
    });
  }

  if (!program.merchant.logoUrl) {
    throw new Error("merchant logo is required before syncing to wallet");
  }

  const designPayload = {
    name: program.name,
    brandColor: program.merchant.brandColor,
    logoUrl: program.merchant.logoUrl,
    rewardLabel: program.rewardLabel,
    stampsRequired: program.stampsRequired,
  };

  let created = false;
  let passKitProgramId = program.passKitProgramId;

  try {
    if (!passKitProgramId) {
      const out = await createProgram({
        merchantId: program.merchantId,
        ...designPayload,
      });
      passKitProgramId = out.passKitProgramId;
      await prisma.loyaltyProgram.update({
        where: { id: loyaltyProgramId },
        data: { passKitProgramId },
      });
      created = true;
    }

    await updateProgramTemplate({
      programId: passKitProgramId,
      ...designPayload,
    });

    return { passKitProgramId, created };
  } catch (e) {
    Sentry.captureException(e, {
      tags: { stage: "syncProgram", merchantId: program.merchantId, loyaltyProgramId },
    });
    throw e;
  }
}
```

- [ ] Run tests — green.
- [ ] **Modify Plan 2's `src/lib/actions/onboarding.ts`** — locate `// onboarding complete` block at the end and add ONE line:

```ts
// existing Plan 2 code creates Merchant + LoyaltyProgram (passKitProgramId=null)
// ↓ ADD THIS ONE LINE before the redirect:
await syncProgram({ loyaltyProgramId: program.id }).catch((e) => {
  // non-blocking: merchant can still see "Sync to wallet" button to retry
  Sentry.captureException(e, { tags: { stage: "onboarding-sync" } });
});
```

Add `import { syncProgram } from "./syncProgram";` at top.

- [ ] **Modify Plan 2's `src/app/(dashboard)/cards/page.tsx`** — add a "Sync to Wallet" button next to the program card that calls `syncProgram` via a form action. Show success/error toast.

```tsx
import { syncProgram } from "@/lib/actions/syncProgram";

<form
  action={async () => {
    "use server";
    await syncProgram({ loyaltyProgramId: program.id });
  }}
>
  <button type="submit" className="btn-secondary">
    {program.passKitProgramId ? "Re-sync template" : "Sync to wallet"}
  </button>
</form>
```

- [ ] **Commit:** `feat(passkit): syncProgram server action + onboarding backfill + manual sync button`

---

## Task 10 — `Pass.status = ISSUE_FAILED` flagging on issuePass failure

**Files:**
- Modify: `src/lib/passkit/passes.ts`
- Modify: `src/lib/passkit/__tests__/passes.test.ts`

**Steps:**

This is the contract Plan 4 (enrollment) relies on: when `issuePass` is called from enrollment, if the underlying PassKit call fails after retries, the caller (Plan 4) writes a Pass row with `status=ISSUE_FAILED`. Our service layer **does not** create the Pass row (Plan 4 owns that), but exposes a helper Plan 4 can call.

- [ ] Add a helper `flagPassIssueFailure` to `passes.ts`:

```ts
export async function flagPassIssueFailure(opts: {
  programId: string;     // LoyaltyProgram.id (DB), not passKitProgramId
  customerPhone: string;
  reason: string;
}): Promise<void> {
  await prisma.pass.create({
    data: {
      programId: opts.programId,
      customerPhone: opts.customerPhone,
      passKitPassId: `failed_${crypto.randomUUID()}`,
      status: "ISSUE_FAILED",
      stampsCount: 0,
    },
  });
}
```

(Import `crypto` at top: `import { randomUUID } from "node:crypto";` then use `randomUUID()`.)

- [ ] Add test:

```ts
import { flagPassIssueFailure } from "../passes";
// mocked prisma.pass.create added to mock above
it("flagPassIssueFailure writes ISSUE_FAILED row", async () => {
  const create = vi.fn().mockResolvedValue({});
  // patch mock: prisma.pass.create
  // ...
  await flagPassIssueFailure({ programId: "lp_1", customerPhone: "+966500000000", reason: "upstream 500" });
  expect(create).toHaveBeenCalled();
});
```

- [ ] Run — green.
- [ ] **Commit:** `feat(passkit): flagPassIssueFailure for downstream enrollment failures`

---

## Task 11 — Margin Alert Daily Cron

**Files:**
- Create: `src/app/api/cron/margin-alert/route.ts`
- Create: `src/app/api/cron/margin-alert/__tests__/route.test.ts`
- Create: `vercel.json`

**Steps:**

Spec §12 risk #1: PassKit pricing is unconfirmed. Daily cron computes per-merchant `passes_issued_this_month * MARGIN_PASS_COST_USD` vs revenue (subscription plan amount). If cost > 60% of revenue, email owner.

- [ ] Create `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/margin-alert", "schedule": "0 8 * * *" }
  ]
}
```

(8 AM UTC = 11 AM Riyadh.)

- [ ] Write failing route test:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMerchants = vi.fn();
const countPasses = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    merchant: { findMany: findManyMerchants },
    pass: { count: countPasses },
  },
}));
const sendEmail = vi.fn();
vi.mock("@/lib/email", () => ({ sendMarginAlert: sendEmail }));
vi.mock("@/env", () => ({
  env: { CRON_SECRET: "secret123secret123secret123secret", MARGIN_PASS_COST_USD: 0.10, MARGIN_ALERT_EMAIL: "abdullah@stampme.com" },
}));

import { GET } from "../route";

beforeEach(() => {
  findManyMerchants.mockReset();
  countPasses.mockReset();
  sendEmail.mockReset();
});

describe("GET /api/cron/margin-alert", () => {
  it("401 without bearer", async () => {
    const res = await GET(new Request("http://test/api/cron/margin-alert"));
    expect(res.status).toBe(401);
  });

  it("alerts when cost > 60% of revenue", async () => {
    // STARTER plan = 99 SAR ≈ $26.4. 200 passes * $0.10 = $20 → 75.7% ratio → alert
    findManyMerchants.mockResolvedValue([
      { id: "m_1", name: "Brew Bros", subscription: { plan: "STARTER" }, programs: [{ id: "lp_1" }] },
    ]);
    countPasses.mockResolvedValue(200);
    const req = new Request("http://test/api/cron/margin-alert", {
      headers: { authorization: "Bearer secret123secret123secret123secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("does not alert when below threshold", async () => {
    findManyMerchants.mockResolvedValue([
      { id: "m_1", name: "Brew Bros", subscription: { plan: "STARTER" }, programs: [{ id: "lp_1" }] },
    ]);
    countPasses.mockResolvedValue(20); // $2 vs $26 → 7.6%
    const req = new Request("http://test/api/cron/margin-alert", {
      headers: { authorization: "Bearer secret123secret123secret123secret" },
    });
    await GET(req);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] Implement `src/app/api/cron/margin-alert/route.ts`:

```ts
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";
import { sendMarginAlert } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SAR → USD (approx, MVP). Phase 2: pull live rate.
const SAR_TO_USD = 0.2667;
const PLAN_REVENUE_SAR: Record<string, number> = {
  STARTER: 99,
  GROWTH: 249,
  PRO: 499,
};
const ALERT_THRESHOLD = 0.60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const merchants = await prisma.merchant.findMany({
    where: { subscription: { status: { in: ["ACTIVE", "TRIALING"] } } },
    include: { subscription: true, programs: { select: { id: true } } },
  });

  let alerted = 0;
  for (const m of merchants) {
    if (!m.subscription) continue;
    const programIds = m.programs.map((p) => p.id);
    if (programIds.length === 0) continue;

    const passCount = await prisma.pass.count({
      where: {
        programId: { in: programIds },
        status: { not: "ISSUE_FAILED" },
        createdAt: { gte: startOfMonth },
      },
    });

    const costUsd = passCount * env.MARGIN_PASS_COST_USD;
    const revenueSar = PLAN_REVENUE_SAR[m.subscription.plan] ?? 0;
    const revenueUsd = revenueSar * SAR_TO_USD;
    if (revenueUsd === 0) continue;

    const ratio = costUsd / revenueUsd;
    if (ratio > ALERT_THRESHOLD) {
      try {
        await sendMarginAlert({
          to: env.MARGIN_ALERT_EMAIL,
          merchantName: m.name,
          merchantId: m.id,
          passesIssued: passCount,
          costUsd,
          revenueUsd,
          ratio,
        });
        alerted++;
      } catch (e) {
        Sentry.captureException(e, { tags: { stage: "margin-alert", merchantId: m.id } });
      }
    }
  }

  return NextResponse.json({ ok: true, merchantsScanned: merchants.length, alerted });
}
```

- [ ] Add `sendMarginAlert` stub to `src/lib/email.ts` (Plan 1 file). It uses Resend:

```ts
export async function sendMarginAlert(args: {
  to: string;
  merchantName: string;
  merchantId: string;
  passesIssued: number;
  costUsd: number;
  revenueUsd: number;
  ratio: number;
}) {
  await resend.emails.send({
    from: "alerts@stampme.com",
    to: args.to,
    subject: `[stampme] Margin alert: ${args.merchantName} (${(args.ratio * 100).toFixed(0)}%)`,
    text:
      `Merchant: ${args.merchantName} (${args.merchantId})\n` +
      `Passes this month: ${args.passesIssued}\n` +
      `PassKit cost: $${args.costUsd.toFixed(2)}\n` +
      `Revenue: $${args.revenueUsd.toFixed(2)}\n` +
      `Ratio: ${(args.ratio * 100).toFixed(1)}% (threshold 60%)\n\n` +
      `Action: review pricing tier or rate-limit issuance for this merchant.`,
  });
}
```

- [ ] Run all tests — green.
- [ ] **Commit:** `feat(passkit): daily margin alert cron + Vercel cron config`

---

## Task 12 — End-to-End Smoke Test (Manual + Scripted)

**Files:**
- Create: `scripts/passkit-smoke.ts`

**Steps:**

- [ ] Write a one-shot script that exercises the full chain against PassKit's **sandbox** (verify sandbox URL in Task 1 — likely `https://api.pub1.passkit.io` for sandbox vs `pub2` for prod):

```ts
// scripts/passkit-smoke.ts
import "dotenv/config";
import { createProgram, updateProgramTemplate } from "@/lib/passkit/programs";
import { issuePass, updatePassStamps, markRedeemed } from "@/lib/passkit/passes";

async function main() {
  console.log("→ createProgram");
  const prog = await createProgram({
    merchantId: `smoke_${Date.now()}`,
    name: "Smoke Test Cafe",
    brandColor: "#0F4C3A",
    logoUrl: "https://placehold.co/120x120/0F4C3A/FFFFFF?text=ST",
    rewardLabel: "Free coffee",
    stampsRequired: 5,
  });
  console.log("  ✓", prog);

  console.log("→ issuePass");
  const pass = await issuePass({
    programId: prog.passKitProgramId,
    customerPhone: "+966501234567",
    idempotencyKey: `smoke-${Date.now()}`,
  });
  console.log("  ✓ apple:", pass.applePassUrl);
  console.log("  ✓ google:", pass.googleWalletUrl);

  for (let i = 1; i <= 5; i++) {
    console.log(`→ updatePassStamps ${i}/5`);
    await updatePassStamps({
      passKitPassId: pass.passKitPassId,
      stampsCount: i,
      idempotencyKey: `smoke-stamp-${i}-${pass.passKitPassId}`,
    });
  }

  console.log("→ markRedeemed");
  await markRedeemed({
    passKitPassId: pass.passKitPassId,
    idempotencyKey: `smoke-redeem-${pass.passKitPassId}`,
  });
  console.log("✓ ALL GREEN");
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
```

- [ ] Add npm script to `package.json`: `"smoke:passkit": "tsx scripts/passkit-smoke.ts"`.
- [ ] Run with sandbox creds: `bun run smoke:passkit`. Open the returned `applePassUrl` on an iPhone — confirm pass installs, stamps update, and reward state appears after the 5th update.
- [ ] Document any deviations from REST surface in `docs/passkit-setup.md`.
- [ ] **Commit:** `chore(passkit): end-to-end smoke script + manual verification notes`

---

## Task 13 — Sentry Tagging Audit + Final Verification

**Files:**
- Create: `src/lib/passkit/__tests__/sentry-tags.test.ts`

**Steps:**

- [ ] Write integration-style test asserting Sentry receives `vendor: "passkit"` tags on every failure path:

```ts
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import * as Sentry from "@sentry/nextjs";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const captureException = vi.spyOn(Sentry, "captureException").mockImplementation(() => "evt-id" as unknown as string);

beforeEach(() => captureException.mockClear());

describe("Sentry tagging", () => {
  it("tags vendor=passkit on upstream 500", async () => {
    const { passkitClient } = await import("../client");
    server.use(http.get("https://api.pub2.passkit.io/x", () => new HttpResponse(null, { status: 500 })));
    await expect(passkitClient.request("GET", "/x")).rejects.toBeTruthy();
    expect(captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: expect.objectContaining({ vendor: "passkit" }) }),
    );
  });
});
```

- [ ] Run full suite: `bun run test`. All tests green.
- [ ] Run typecheck + lint: `bun run typecheck && bun run lint`.
- [ ] **Commit:** `test(passkit): assert Sentry tags vendor=passkit on all failures`

---

## Phase 2 / Future Work (Document as TODOs in code, do NOT implement)

- [ ] **Strip image** for stamp progress (visual filled/unfilled circles). MVP is text-only "3/10". Phase 2: generate strip image at update time via Cloudflare Images or `@napi-rs/canvas`, push to R2, link in PassKit template.
- [ ] **Per-staff PIN + audit trail** in `StampEvent.staffPinId` — currently merchant-level PIN.
- [ ] **Live FX rate** for SAR→USD in margin cron (currently hardcoded 0.2667).
- [ ] **QStash queue** for webhook side-effects if synchronous DB writes start exceeding PassKit's 5s timeout.
- [ ] **PassKit sandbox vs prod env split** — current single `PASSKIT_API_URL` env var. Add `PASSKIT_ENV=sandbox|prod` switch when going to staging.
- [ ] **Vendor lock-in escape hatch** (spec §8 risk): abstract `passes.ts` behind a `WalletProvider` interface so a future native Apple PassKit + Google Wallet API implementation can swap in.

---

## Acceptance Criteria

- [ ] `bun run test` passes 100%, including: client retry logic, program create/update, pass issue/stamp/redeem, webhook signature (positive + 4 negatives), syncProgram backfill + idempotency, margin alert (alert + no-alert), Sentry tagging.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean.
- [ ] `bun run smoke:passkit` against sandbox prints "ALL GREEN" and a real Apple Wallet pass installs on iPhone.
- [ ] Onboarding finish (Plan 2) automatically calls `syncProgram` and the merchant's LoyaltyProgram row has a non-null `passKitProgramId` after first signup.
- [ ] Manual "Sync to wallet" button on `/dashboard/cards` is idempotent (clicking twice produces no errors and no duplicate PassKit programs).
- [ ] Webhook endpoint returns 400 on invalid signature, 200 on valid event, and `pass.removed` flips DB `Pass.status = DELETED`.
- [ ] Margin cron returns 401 without `CRON_SECRET`, scans active merchants, and emails on > 60% cost ratio.
- [ ] Spec §12 risk #1 (PassKit pricing) is acknowledged in `docs/passkit-setup.md` with the actual confirmed tier from sales.

---

## Open Risks Surfaced by This Plan

- 🔴 **PassKit REST endpoint paths** (`/members/program`, `/members/member`) need verification against current docs in Task 1. If they differ, only path strings change — schemas and tests stay valid.
- 🔴 **PassKit pricing per pass** still unconfirmed (spec §12 #1). Margin cron is the safety net but does not prevent overrun mid-month — consider a hard rate limit at issuance time in Phase 2.
- 🟡 **Webhook header names** (`X-PassKit-Signature`, `X-PassKit-Timestamp`) assumed; verify in PassKit dashboard at Task 1. Adjust route handler if different.
- 🟡 **Apple/Google Wallet template parity**: PassKit claims a single template covers both, but Google Wallet's "loyalty class" has stricter required fields (issuer name, program name). Confirm in smoke test.
- 🟡 **Resend rate limits** on margin alert — at scale (>100 merchants alerting per day) batch into a single digest email.
