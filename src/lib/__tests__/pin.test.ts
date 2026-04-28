import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, isValidPinFormat } from "@/lib/pin";

describe("isValidPinFormat", () => {
  it("accepts exactly 4 digits", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("0000")).toBe(true);
  });

  it("rejects non-digit chars", () => {
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("12 4")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("12345")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("produces argon2 hash that verifies correctly", async () => {
    const hash = await hashPin("1234");
    expect(hash).toMatch(/^\$argon2/);
    expect(await verifyPin("1234", hash)).toBe(true);
  });

  it("rejects wrong PIN", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("9999", hash)).toBe(false);
  });

  it("hashes are non-deterministic (salted)", async () => {
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a).not.toBe(b);
  }, 10000);

  it("throws on invalid PIN format at hash time", async () => {
    await expect(hashPin("abc")).rejects.toThrow(/4 digits/);
  });
});
