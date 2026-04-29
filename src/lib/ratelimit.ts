import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

/** 10 enrollments per hour per IP — anti-abuse */
export const enrollIpLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
  prefix: "rl:enroll:ip",
});

/** 5 enrollments per day per phone — anti-spam */
export const enrollPhoneLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 d"),
  analytics: true,
  prefix: "rl:enroll:phone",
});

/** 3 recovery attempts per hour per phone */
export const recoverPhoneLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  analytics: true,
  prefix: "rl:recover:phone",
});

export class RateLimitError extends Error {
  constructor(public readonly resetAt: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
  }
}
