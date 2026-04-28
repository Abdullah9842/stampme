import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { env } from "./env";

// Prisma 7 + adapter-neon: PrismaNeon takes a `PoolConfig` directly and
// manages the underlying `@neondatabase/serverless` Pool internally.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient() {
  const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? makeClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
