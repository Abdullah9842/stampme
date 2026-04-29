import { describe, it, expect } from "vitest";
import { ksaPhoneSchema, merchantSlugSchema, enrollPayloadSchema } from "./enrollment";

describe("ksaPhoneSchema", () => {
  it.each([
    "+966500000000",
    "+966512345678",
    "+966591234567",
  ])("accepts valid KSA mobile %s", (phone) => {
    expect(ksaPhoneSchema.parse(phone)).toBe(phone);
  });

  it("normalizes 05XXXXXXXX to +9665XXXXXXXX", () => {
    expect(ksaPhoneSchema.parse("0512345678")).toBe("+966512345678");
  });

  it("normalizes 5XXXXXXXX to +9665XXXXXXXX", () => {
    expect(ksaPhoneSchema.parse("512345678")).toBe("+966512345678");
  });

  it("strips spaces and dashes", () => {
    expect(ksaPhoneSchema.parse("+966 50 000 0000")).toBe("+966500000000");
    expect(ksaPhoneSchema.parse("+966-50-000-0000")).toBe("+966500000000");
  });

  it.each([
    "+966400000000",
    "+96650000000",
    "+9665000000000",
    "+1234567890",
    "abcdefghij",
    "",
  ])("rejects invalid %s", (phone) => {
    expect(() => ksaPhoneSchema.parse(phone)).toThrow();
  });
});

describe("merchantSlugSchema", () => {
  it.each(["acme", "acme-cafe", "cafe-99", "a-b-c"])("accepts %s", (s) => {
    expect(merchantSlugSchema.parse(s)).toBe(s);
  });

  it.each(["A-Cafe", "cafe_under", "-bad", "bad-", "ab", "x".repeat(81)])(
    "rejects %s",
    (s) => {
      expect(() => merchantSlugSchema.parse(s)).toThrow();
    },
  );
});

describe("enrollPayloadSchema", () => {
  it("accepts valid payload", () => {
    const out = enrollPayloadSchema.parse({
      merchantSlug: "acme-cafe",
      phone: "0512345678",
    });
    expect(out.phone).toBe("+966512345678");
  });
});
