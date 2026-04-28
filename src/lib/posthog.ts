import { PostHog } from "posthog-node";

let serverClient: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return null;
  if (!serverClient) {
    serverClient = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });
  }
  return serverClient;
}

export const posthogBrowserInitArgs = {
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  options: {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only" as const,
  },
};
