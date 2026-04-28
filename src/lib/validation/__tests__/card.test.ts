import { describe, it, expect } from "vitest";
import { createCardSchema, updateCardSchema } from "@/lib/validation/card";

describe("createCardSchema", () => {
  const valid = {
    programName: "Coffee Lovers",
    stampsRequired: 10,
    rewardLabel: "Free coffee",
  };

  it("accepts a valid payload", () => {
    expect(createCardSchema.safeParse(valid).success).toBe(true);
  });

  it("requires program name 2-60 chars", () => {
    expect(createCardSchema.safeParse({ ...valid, programName: "" }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, programName: "a" }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, programName: "x".repeat(61) }).success).toBe(false);
  });

  it("constrains stampsRequired to 5..20 inclusive", () => {
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 4 }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 5 }).success).toBe(true);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 20 }).success).toBe(true);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 21 }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 10.5 }).success).toBe(false);
  });

  it("caps reward label at 50 chars", () => {
    expect(createCardSchema.safeParse({ ...valid, rewardLabel: "x".repeat(50) }).success).toBe(true);
    expect(createCardSchema.safeParse({ ...valid, rewardLabel: "x".repeat(51) }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, rewardLabel: "" }).success).toBe(false);
  });
});

describe("updateCardSchema", () => {
  it("requires id and at least one field", () => {
    expect(updateCardSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(updateCardSchema.safeParse({ id: "abc", programName: "New" }).success).toBe(true);
  });

  it("rejects payload where only id is defined and other fields are undefined", () => {
    expect(updateCardSchema.safeParse({ id: "abc", programName: undefined }).success).toBe(false);
  });
});
