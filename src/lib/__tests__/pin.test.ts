import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, isValidPinFormat } from "@/lib/pin";

describe("isValidPinFormat", () => {
  it("accepts exactly 6 digits", () => {
    expect(isValidPinFormat("123456")).toBe(true);
    expect(isValidPinFormat("000000")).toBe(true);
  });

  it("rejects non-digit chars", () => {
    expect(isValidPinFormat("12a456")).toBe(false);
    expect(isValidPinFormat("12 456")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidPinFormat("12345")).toBe(false);
    expect(isValidPinFormat("1234567")).toBe(false);
    expect(isValidPinFormat("1234")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("produces argon2 hash that verifies correctly", async () => {
    const hash = await hashPin("123456");
    expect(hash).toMatch(/^\$argon2/);
    expect(await verifyPin("123456", hash)).toBe(true);
  });

  it("rejects wrong PIN", async () => {
    const hash = await hashPin("123456");
    expect(await verifyPin("999999", hash)).toBe(false);
  });

  it("hashes are non-deterministic (salted)", async () => {
    const a = await hashPin("123456");
    const b = await hashPin("123456");
    expect(a).not.toBe(b);
  });

  it("throws on invalid PIN format at hash time", async () => {
    await expect(hashPin("abc")).rejects.toThrow(/6 digits/);
  });
});
