import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist limitMock so it survives module resets
// ---------------------------------------------------------------------------
const limitMock = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mock @upstash/redis — must be a proper class mock (new-able)
// ---------------------------------------------------------------------------
vi.mock("@upstash/redis", () => {
  class Redis {
    constructor(_opts: unknown) {}
  }
  return { Redis };
});

// ---------------------------------------------------------------------------
// Mock @upstash/ratelimit — must be a proper class mock (new-able)
// slidingWindow is a static method on the class
// ---------------------------------------------------------------------------
vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    limit: typeof limitMock;
    constructor(_opts: unknown) {
      this.limit = limitMock;
    }
    static slidingWindow(_count: number, _window: string) {
      return { kind: "sliding_window" };
    }
  }
  return { Ratelimit };
});

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: {
    UPSTASH_REDIS_REST_URL: "https://stub.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "stub-token-12345678901234567890",
  },
}));

// Import after mocks are set up
import {
  enrollIpLimiter,
  enrollPhoneLimiter,
  recoverPhoneLimiter,
  RateLimitError,
} from "../ratelimit";

describe("ratelimit", () => {
  beforeEach(() => {
    limitMock.mockReset();
  });

  it("enrollIpLimiter allows when under quota", async () => {
    limitMock.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 3600_000 });
    const r = await enrollIpLimiter.limit("203.0.113.1");
    expect(r.success).toBe(true);
    expect(r.remaining).toBe(9);
  });

  it("enrollPhoneLimiter blocks when over quota", async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 86400_000 });
    const r = await enrollPhoneLimiter.limit("+966500000000");
    expect(r.success).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("recoverPhoneLimiter allows on first attempt", async () => {
    limitMock.mockResolvedValue({ success: true, remaining: 2, reset: Date.now() + 3600_000 });
    const r = await recoverPhoneLimiter.limit("+966500000000");
    expect(r.success).toBe(true);
  });

  it("RateLimitError carries resetAt timestamp", () => {
    const resetAt = Date.now() + 3600_000;
    const err = new RateLimitError(resetAt);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RateLimitError");
    expect(err.message).toBe("Rate limit exceeded");
    expect(err.resetAt).toBe(resetAt);
  });
});
