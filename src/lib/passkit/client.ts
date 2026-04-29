import pRetry from "p-retry";
import { SignJWT, importPKCS8 } from "jose";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";
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

  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: RequestOpts = {},
  ): Promise<T> {
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

      const res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });

      const text = await res.text();
      const json = text ? safeJson(text) : null;

      if (res.status >= 200 && res.status < 300) return json as T;

      const code = mapStatus(res.status);
      throw new PassKitError({
        code,
        message: extractMessage(json) ?? `PassKit ${method} ${path} → ${res.status}`,
        status: res.status,
        upstream: json ?? text,
      });
    };

    try {
      return await pRetry(run, {
        retries: 2, // total 3 attempts
        minTimeout: 250,
        factor: 2,
        randomize: true,
        shouldRetry: (context: { error: unknown }) => {
          const err = context.error;
          if (!(err instanceof PassKitError)) return true; // network errors retry
          const status = err.status ?? 500;
          return status >= 500 || status === 408 || status === 429;
        },
      });
    } catch (e) {
      const final =
        e instanceof PassKitError
          ? e
          : new PassKitError({
              code: PassKitErrorCode.NETWORK,
              message: (e as Error).message ?? "passkit request failed",
              cause: e,
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
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

export const passkitClient = new PassKitClient();
