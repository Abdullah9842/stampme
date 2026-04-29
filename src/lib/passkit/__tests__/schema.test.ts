import { describe, it, expect } from "vitest";
import { PassStatus } from "@prisma/client";

describe("PassStatus enum", () => {
  it("includes ISSUE_FAILED", () => {
    expect(PassStatus.ISSUE_FAILED).toBe("ISSUE_FAILED");
  });
});
