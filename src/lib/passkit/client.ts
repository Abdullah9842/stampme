import "server-only";
import * as grpc from "@grpc/grpc-js";
import { MembersClient } from "passkit-node-sdk/io/member/a_rpc_grpc_pb";
import { TemplatesClient } from "passkit-node-sdk/io/core/a_rpc_templates_grpc_pb";
import { ImagesClient } from "passkit-node-sdk/io/core/a_rpc_images_grpc_pb";
import { env } from "@/lib/env";

const GRPC_HOST = "grpc.pub1.passkit.io:443";

class PassKitGrpc {
  readonly members: InstanceType<typeof MembersClient>;
  readonly templates: InstanceType<typeof TemplatesClient>;
  readonly images: InstanceType<typeof ImagesClient>;

  constructor() {
    // mTLS credentials: ca chain (root cert), private key, client cert — in that order
    // per @grpc/grpc-js createSsl(rootCerts, privateKey, certChain)
    const credentials = grpc.credentials.createSsl(
      Buffer.from(env.PASSKIT_CA_CHAIN),
      Buffer.from(env.PASSKIT_KEY),
      Buffer.from(env.PASSKIT_CERTIFICATE),
    );
    this.members = new MembersClient(GRPC_HOST, credentials);
    this.templates = new TemplatesClient(GRPC_HOST, credentials);
    this.images = new ImagesClient(GRPC_HOST, credentials);
  }
}

let _client: PassKitGrpc | null = null;

export function passkitGrpc(): PassKitGrpc {
  if (!_client) _client = new PassKitGrpc();
  return _client;
}

// Reset singleton — used in tests only
export function _resetPasskitGrpcSingleton(): void {
  _client = null;
}
