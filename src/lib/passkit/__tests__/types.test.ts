import { describe, it, expect } from "vitest";
import { PassKitError, PassKitErrorCode } from "../types";

describe("PassKitError", () => {
  it("preserves code, status, and cause", () => {
    const cause = new Error("network down");
    const err = new PassKitError({
      code: PassKitErrorCode.NETWORK,
      message: "boom",
      status: 503,
      cause,
    });
    expect(err.code).toBe("NETWORK");
    expect(err.status).toBe(503);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("PassKitError");
  });

  it("is JSON-serialisable without leaking the cause stack", () => {
    const err = new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "upstream 500",
      status: 500,
    });
    const json = err.toJSON();
    expect(json).toMatchObject({ name: "PassKitError", code: "UPSTREAM", status: 500 });
    expect(JSON.stringify(json)).not.toContain("cause");
  });
});
