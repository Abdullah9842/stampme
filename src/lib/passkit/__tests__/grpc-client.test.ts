import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock env before importing client (Zod validation runs on module load)
vi.mock("@/lib/env", () => ({
  env: {
    PASSKIT_CERTIFICATE: "-----BEGIN CERTIFICATE-----\nMIIfake==\n-----END CERTIFICATE-----",
    PASSKIT_KEY: "-----BEGIN EC PRIVATE KEY-----\nMEcfake==\n-----END EC PRIVATE KEY-----",
    PASSKIT_CA_CHAIN: "-----BEGIN CERTIFICATE-----\nMIIcafake==\n-----END CERTIFICATE-----",
    PASSKIT_WEBHOOK_SECRET: "whsec_stub",
  },
}));

// Mock @grpc/grpc-js so no actual network connections are opened.
// makeGenericClientConstructor is called at module load time; it must return a
// real constructor function (not an arrow fn) so `new Client()` works.
vi.mock("@grpc/grpc-js", () => ({
  credentials: {
    createSsl: vi.fn().mockReturnValue({ fake: "creds" }),
  },
  makeGenericClientConstructor: vi.fn().mockReturnValue(
    function FakeGrpcClient() { return {}; },
  ),
}));

// Mock the passkit-node-sdk gRPC client constructors so the module loads cleanly.
// Must be real constructor functions (not arrow fns) because client.ts does `new MembersClient(...)`.
vi.mock("passkit-node-sdk/io/member/a_rpc_grpc_pb", () => ({
  MembersClient: function MembersClient() { return { _type: "members" }; },
}));
vi.mock("passkit-node-sdk/io/core/a_rpc_templates_grpc_pb", () => ({
  TemplatesClient: function TemplatesClient() { return { _type: "templates" }; },
}));
vi.mock("passkit-node-sdk/io/core/a_rpc_images_grpc_pb", () => ({
  ImagesClient: function ImagesClient() { return { _type: "images" }; },
}));

import { passkitGrpc, _resetPasskitGrpcSingleton } from "../client";
import * as grpc from "@grpc/grpc-js";

beforeEach(() => {
  _resetPasskitGrpcSingleton();
  vi.clearAllMocks();
});

describe("passkitGrpc", () => {
  it("constructs without throwing and exposes members/templates/images sub-clients", () => {
    const client = passkitGrpc();
    expect(client).toBeDefined();
    expect(client.members).toBeDefined();
    expect(client.templates).toBeDefined();
    expect(client.images).toBeDefined();
  });

  it("creates SSL credentials from the three PEM env vars", () => {
    passkitGrpc();
    expect(grpc.credentials.createSsl).toHaveBeenCalledOnce();
    // createSsl(rootCerts, privateKey, certChain) — three Buffer args
    const calls = (grpc.credentials.createSsl as ReturnType<typeof vi.fn>).mock.calls;
    const firstCall: unknown[] = calls[0] as unknown[];
    expect(Buffer.isBuffer(firstCall[0])).toBe(true); // rootCerts (CA chain)
    expect(Buffer.isBuffer(firstCall[1])).toBe(true); // privateKey
    expect(Buffer.isBuffer(firstCall[2])).toBe(true); // certChain (client cert)
  });

  it("returns the same singleton on repeated calls", () => {
    const first = passkitGrpc();
    const second = passkitGrpc();
    expect(first).toBe(second);
    // Credentials should only be created once
    expect(grpc.credentials.createSsl).toHaveBeenCalledOnce();
  });

  it("creates a fresh instance after _resetPasskitGrpcSingleton", () => {
    const first = passkitGrpc();
    _resetPasskitGrpcSingleton();
    const second = passkitGrpc();
    expect(first).not.toBe(second);
  });
});
