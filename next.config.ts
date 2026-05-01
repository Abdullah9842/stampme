import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const securityHeaders = [
  // HSTS: 2-year max-age, include subdomains, preload-eligible
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block framing entirely (clickjacking protection)
  { key: "X-Frame-Options", value: "DENY" },
  // Referrer: send origin only on cross-origin requests
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Speed up resolution without leaking navigation via prefetch
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Allow camera for QR scanner (self), restrict everything else
  // NOTE: CSP is deferred to Plan 7 — needs careful allowlisting for
  // Sentry tunnel, Clerk, PostHog, R2, and PassKit smartpass URLs.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "img.clerk.com" },
    ],
  },
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

const withIntl = withNextIntl(nextConfig);

export default withSentryConfig(withIntl, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? "stampme",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  disableLogger: true,
  automaticVercelMonitors: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
