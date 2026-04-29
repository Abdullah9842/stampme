import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Env mock — must come before any passkit imports
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: {
    PASSKIT_CERTIFICATE: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    PASSKIT_KEY: "-----BEGIN EC PRIVATE KEY-----\nfake\n-----END EC PRIVATE KEY-----",
    PASSKIT_CA_CHAIN: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    PASSKIT_WEBHOOK_SECRET: "whsec_stub",
    NODE_ENV: "test",
  },
}));

// ---------------------------------------------------------------------------
// Proto message stubs
// The proto classes have complex protobuf internals; we stub them with plain
// objects whose setter methods return `this` (builder pattern) and getters
// return pre-configured values.
// ---------------------------------------------------------------------------

/** Build a minimal stub that mimics the proto builder pattern. */
function makeProtoStub(overrides: Record<string, unknown> = {}) {
  const stub: Record<string, unknown> = { ...overrides };
  return new Proxy(stub, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop.startsWith("set")) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return (_: unknown) => new Proxy(target, this);
      }
      if (prop.startsWith("get")) return () => undefined;
      if (prop === "addStatus") return () => new Proxy(target, this);
      if (prop === "clearImages") return () => new Proxy(target, this);
      return undefined;
    },
  });
}

const fakeTemplateId = "tpl_test_abc";
const fakeProgramId = "prg_test_abc";
const fakeTierId = `tier-${fakeProgramId}`;
const fakePasstemplateid = "tpl_existing_xyz";

const fakeIdMsg = (id: string) => ({ getId: () => id });

// ── gRPC client method mocks ─────────────────────────────────────────────
const mockGetDefaultTemplate = vi.fn();
const mockCreateTemplate = vi.fn();
const mockGetTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockCreateProgram = vi.fn();
const mockCreateTier = vi.fn();
const mockGetTier = vi.fn();

vi.mock("../client", () => ({
  passkitGrpc: vi.fn(() => ({
    templates: {
      getDefaultTemplate: mockGetDefaultTemplate,
      createTemplate: mockCreateTemplate,
      getTemplate: mockGetTemplate,
      updateTemplate: mockUpdateTemplate,
    },
    members: {
      createProgram: mockCreateProgram,
      createTier: mockCreateTier,
      getTier: mockGetTier,
    },
  })),
}));

// ── Mock proto constructors ──────────────────────────────────────────────
// IMPORTANT: vi.fn().mockImplementation must use a regular function (not an arrow
// function) when the code calls `new Constructor()`. Arrow functions are not valid
// constructors. We use function declarations wrapped in vi.fn() here.
vi.mock("passkit-node-sdk/io/common/template_pb", () => ({
  DefaultTemplateRequest: function DefaultTemplateRequest() { return makeProtoStub(); },
  PassTemplate: function PassTemplate() { return makeProtoStub(); },
  Colors: function Colors() { return makeProtoStub(); },
}));

vi.mock("passkit-node-sdk/io/common/protocols_pb", () => ({
  PassProtocol: { MEMBERSHIP: 100 },
}));

vi.mock("passkit-node-sdk/io/member/program_pb", () => ({
  Program: function Program() { return makeProtoStub(); },
  PointsType: function PointsType() { return makeProtoStub(); },
  BalanceType: { BALANCE_TYPE_INT: 1 },
}));

vi.mock("passkit-node-sdk/io/member/tier_pb", () => ({
  Tier: function Tier() { return makeProtoStub(); },
  TierRequestInput: function TierRequestInput() {
    return makeProtoStub({ getPasstemplateid: () => fakePasstemplateid });
  },
}));

vi.mock("passkit-node-sdk/io/common/project_pb", () => ({
  ProjectStatus: {
    PROJECT_DRAFT: 4,
    PROJECT_ACTIVE_FOR_OBJECT_CREATION: 1,
  },
}));

vi.mock("passkit-node-sdk/io/common/common_objects_pb", () => ({
  Id: function Id() { return makeProtoStub(); },
}));

import { createProgram, updateProgramTemplate } from "../programs";
import { PassKitError } from "../types";

// Helper: configure a gRPC callback mock to resolve with a value
function resolveWith<T>(mockFn: ReturnType<typeof vi.fn>, value: T) {
  mockFn.mockImplementation((_req: unknown, cb: (err: null, res: T) => void) =>
    cb(null, value),
  );
}

// Helper: configure a gRPC callback mock to reject with an error
function rejectWith(mockFn: ReturnType<typeof vi.fn>, err: Error) {
  mockFn.mockImplementation((_req: unknown, cb: (err: Error, res: null) => void) =>
    cb(err, null),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path wiring
  resolveWith(mockGetDefaultTemplate, makeProtoStub({ getColors: () => makeProtoStub() }));
  resolveWith(mockCreateTemplate, fakeIdMsg(fakeTemplateId));
  resolveWith(mockCreateProgram, fakeIdMsg(fakeProgramId));
  resolveWith(mockCreateTier, fakeIdMsg(fakeTierId));
  resolveWith(mockGetTier, makeProtoStub({ getPasstemplateid: () => fakePasstemplateid }));
  resolveWith(mockGetTemplate, makeProtoStub({ getColors: () => null }));
  resolveWith(mockUpdateTemplate, makeProtoStub());
});

const validInput = {
  merchantId: "m_1",
  name: "Brew Bros Loyalty",
  brandColor: "#0F4C3A",
  logoUrl: "https://r2.stampme.com/m_1/logo.png",
  rewardLabel: "Free coffee",
  stampsRequired: 10,
};

describe("createProgram", () => {
  it("calls getDefaultTemplate → createTemplate → createProgram → createTier in order", async () => {
    const result = await createProgram(validInput);
    expect(mockGetDefaultTemplate).toHaveBeenCalledOnce();
    expect(mockCreateTemplate).toHaveBeenCalledOnce();
    expect(mockCreateProgram).toHaveBeenCalledOnce();
    expect(mockCreateTier).toHaveBeenCalledOnce();
    expect(result).toEqual({
      passKitProgramId: fakeProgramId,
      passKitTemplateId: fakeTemplateId,
    });
  });

  it("throws VALIDATION for bad input (invalid brandColor)", async () => {
    await expect(
      createProgram({ ...validInput, brandColor: "red" } as never),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("throws UPSTREAM when createTemplate returns empty id", async () => {
    resolveWith(mockCreateTemplate, fakeIdMsg(""));
    await expect(createProgram(validInput)).rejects.toMatchObject({ code: "UPSTREAM" });
    expect(mockCreateProgram).not.toHaveBeenCalled(); // aborts before program creation
  });

  it("throws UPSTREAM when createProgram returns empty id", async () => {
    resolveWith(mockCreateProgram, fakeIdMsg(""));
    await expect(createProgram(validInput)).rejects.toMatchObject({ code: "UPSTREAM" });
    expect(mockCreateTier).not.toHaveBeenCalled(); // aborts before tier creation
  });

  it("propagates gRPC errors from createTemplate as-is", async () => {
    rejectWith(mockCreateTemplate, new Error("gRPC unavailable"));
    await expect(createProgram(validInput)).rejects.toThrow("gRPC unavailable");
  });
});

describe("updateProgramTemplate", () => {
  const updateInput = {
    programId: fakeProgramId,
    name: "Brew Bros v2",
    brandColor: "#1A1A1A",
    logoUrl: "https://r2.stampme.com/m_1/logo-v2.png",
    rewardLabel: "Free latte",
    stampsRequired: 12,
  };

  it("fetches tier by programId, then fetches + updates template", async () => {
    await updateProgramTemplate(updateInput);
    expect(mockGetTier).toHaveBeenCalledOnce();
    expect(mockGetTemplate).toHaveBeenCalledOnce();
    expect(mockUpdateTemplate).toHaveBeenCalledOnce();
  });

  it("throws VALIDATION for bad input", async () => {
    await expect(
      updateProgramTemplate({ ...updateInput, brandColor: "blue" } as never),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("throws NOT_FOUND if getTier returns a tier with no passtemplateid", async () => {
    resolveWith(mockGetTier, makeProtoStub({ getPasstemplateid: () => "" }));
    await expect(updateProgramTemplate(updateInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockGetTemplate).not.toHaveBeenCalled();
  });

  it("propagates gRPC errors from getTier", async () => {
    rejectWith(mockGetTier, new Error("permission denied"));
    await expect(updateProgramTemplate(updateInput)).rejects.toThrow("permission denied");
  });

  it("uses existing colors object from template if available", async () => {
    const existingColors = makeProtoStub();
    resolveWith(
      mockGetTemplate,
      makeProtoStub({ getColors: () => existingColors }),
    );
    await updateProgramTemplate(updateInput);
    expect(mockUpdateTemplate).toHaveBeenCalledOnce();
  });
});

describe("PassKitError wrapping", () => {
  it("is an instance of PassKitError on VALIDATION failures", async () => {
    const err = await createProgram({ ...validInput, stampsRequired: 99 } as never).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(PassKitError);
  });
});
