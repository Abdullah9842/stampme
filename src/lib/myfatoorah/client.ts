import "server-only";
import pRetry from "p-retry";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";
import { MyFatoorahError, MyFatoorahErrorCode } from "./types";

interface RequestOpts {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

class MyFatoorahClient {
  async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: RequestOpts = {},
  ): Promise<T> {
    const url = new URL(path, env.MYFATOORAH_BASE_URL);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const run = async () => {
      const res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${env.MYFATOORAH_API_KEY}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });

      const text = await res.text();
      const json = text ? safeJson(text) : null;

      if (res.status >= 200 && res.status < 300) {
        // MyFatoorah wraps responses in { IsSuccess, Message, ValidationErrors, Data }
        const wrapped = json as {
          IsSuccess?: boolean;
          Message?: string;
          Data?: unknown;
        } | null;
        if (wrapped && wrapped.IsSuccess === false) {
          throw new MyFatoorahError({
            code: MyFatoorahErrorCode.VALIDATION,
            message:
              wrapped.Message ??
              `MyFatoorah ${method} ${path} returned IsSuccess=false`,
            upstream: wrapped,
          });
        }
        return (wrapped?.Data ?? wrapped) as T;
      }

      const code = mapStatus(res.status);
      throw new MyFatoorahError({
        code,
        message:
          extractMessage(json) ??
          `MyFatoorah ${method} ${path} → ${res.status}`,
        status: res.status,
        upstream: json ?? text,
      });
    };

    try {
      return await pRetry(run, {
        retries: 2,
        minTimeout: 250,
        factor: 2,
        randomize: true,
        shouldRetry: ({ error }: { error: unknown }) => {
          if (!(error instanceof MyFatoorahError)) return true;
          // VALIDATION errors (IsSuccess=false on 200) should not be retried
          if (error.code === MyFatoorahErrorCode.VALIDATION) return false;
          const status = error.status ?? 500;
          return status >= 500 || status === 408 || status === 429;
        },
      });
    } catch (e) {
      const final =
        e instanceof MyFatoorahError
          ? e
          : new MyFatoorahError({
              code: MyFatoorahErrorCode.NETWORK,
              message: (e as Error).message ?? "myfatoorah request failed",
              cause: e,
            });
      Sentry.captureException(final, {
        tags: {
          vendor: "myfatoorah",
          endpoint: `${method} ${path}`,
          code: final.code,
        },
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
  return (j.Message as string) ?? (j.message as string) ?? undefined;
}

function mapStatus(status: number): MyFatoorahErrorCode {
  if (status === 401 || status === 403) return MyFatoorahErrorCode.AUTH;
  if (status === 404) return MyFatoorahErrorCode.NOT_FOUND;
  if (status === 422 || status === 400) return MyFatoorahErrorCode.VALIDATION;
  if (status === 429) return MyFatoorahErrorCode.RATE_LIMITED;
  if (status >= 500) return MyFatoorahErrorCode.UPSTREAM;
  return MyFatoorahErrorCode.UNKNOWN;
}

export const myfatoorahClient = new MyFatoorahClient();
