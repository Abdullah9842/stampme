import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/lib/i18n/routing";
import { NextResponse } from "next/server";

const intlMiddleware = createIntlMiddleware(routing);

const isProtectedRoute = createRouteMatcher([
  "/:locale/dashboard(.*)",
  "/:locale/onboarding(.*)",
  "/:locale/programs(.*)",
  "/:locale/cards(.*)",
  "/:locale/settings(.*)",
]);

const isApiRoute = createRouteMatcher(["/api/(.*)", "/c/(.*)", "/scan(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  if (isApiRoute(req)) {
    const apiResponse = NextResponse.next();
    apiResponse.headers.set("x-pathname", req.nextUrl.pathname);
    return apiResponse;
  }

  const response = intlMiddleware(req);
  response.headers.set("x-pathname", req.nextUrl.pathname);
  return response;
});

export const config = {
  matcher: [
    "/((?!_next|_vercel|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
