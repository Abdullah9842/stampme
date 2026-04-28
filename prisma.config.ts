// Prisma 7 config — connection URLs live here (not in schema.prisma).
// Loads env from .env.local (Next.js convention) so Prisma CLI and Next.js
// share one env file.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Prisma 7 Datasource only accepts `url` + `shadowDatabaseUrl`.
  // `DIRECT_URL` is no longer used by Prisma — Neon's driver adapter handles
  // pooling internally. We keep DIRECT_URL in env.ts for forward compatibility
  // (e.g. batch jobs that bypass the pooler).
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
