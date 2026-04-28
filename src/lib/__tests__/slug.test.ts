import { describe, it, expect } from "vitest";
import { generateMerchantSlug, ensureUniqueSlug } from "@/lib/slug";

describe("generateMerchantSlug", () => {
  it("lowercases and hyphenates basic English", () => {
    expect(generateMerchantSlug("My Coffee Shop")).toBe("my-coffee-shop");
  });

  it("strips punctuation and emojis", () => {
    expect(generateMerchantSlug("Café! ☕ Riyadh")).toBe("cafe-riyadh");
  });

  it("transliterates Arabic to latin-friendly slug", () => {
    const slug = generateMerchantSlug("قهوة الرياض");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeGreaterThan(0);
  });

  it("falls back to 'merchant' when input is unsluggable", () => {
    expect(generateMerchantSlug("!!!")).toBe("merchant");
    expect(generateMerchantSlug("")).toBe("merchant");
  });

  it("truncates to 48 chars", () => {
    const long = "a".repeat(100);
    expect(generateMerchantSlug(long).length).toBeLessThanOrEqual(48);
  });

  it("does not leave a trailing hyphen after 48-char truncation", () => {
    // Construct an input where the slug, before slicing, is longer than 48 and
    // would land a hyphen exactly at index 47.
    // e.g. "ab-".repeat(20) → "ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-"
    // (60 chars, hyphens at every 3rd position; slice(0,48) cuts on a hyphen)
    const input = "ab-".repeat(20);
    const result = generateMerchantSlug(input);
    expect(result.endsWith("-")).toBe(false);
    expect(result.length).toBeLessThanOrEqual(48);
  });
});

describe("ensureUniqueSlug", () => {
  it("returns base slug if unused", async () => {
    const result = await ensureUniqueSlug("my-cafe", async () => false);
    expect(result).toBe("my-cafe");
  });

  it("appends -2, -3, ... until unique", async () => {
    const taken = new Set(["my-cafe", "my-cafe-2"]);
    const result = await ensureUniqueSlug("my-cafe", async (s) => taken.has(s));
    expect(result).toBe("my-cafe-3");
  });

  it("gives up after 50 attempts and appends nanoid suffix", async () => {
    const result = await ensureUniqueSlug("popular", async () => true);
    expect(result).toMatch(/^popular-[a-z0-9]{6}$/);
  });
});
