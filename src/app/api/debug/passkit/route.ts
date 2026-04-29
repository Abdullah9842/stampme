import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Trivial gate so this endpoint can't be hit anonymously after we're done debugging
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const grpc = await import("@grpc/grpc-js");
    const passkitMembers = (await import("passkit-node-sdk/io/member/a_rpc_grpc_pb.js" as string)) as {
      MembersClient: new (host: string, creds: unknown) => unknown;
    };
    const passkitTemplates = (await import("passkit-node-sdk/io/core/a_rpc_templates_grpc_pb.js" as string)) as {
      TemplatesClient: new (host: string, creds: unknown) => { getDefaultTemplate: (req: unknown, cb: (err: unknown, res: unknown) => void) => void };
    };
    const passkitTemplate = (await import("passkit-node-sdk/io/common/template_pb.js" as string)) as {
      DefaultTemplateRequest: new () => { setProtocol: (p: number) => unknown; setRevision: (n: number) => unknown };
      PassProtocol: { MEMBERSHIP: number };
    };

    const credentials = grpc.credentials.createSsl(
      Buffer.from(env.PASSKIT_CA_CHAIN),
      Buffer.from(env.PASSKIT_KEY),
      Buffer.from(env.PASSKIT_CERTIFICATE),
    );

    const HOST = "grpc.pub1.passkit.io:443";
    const templates = new passkitTemplates.TemplatesClient(HOST, credentials);

    const reqMsg = new passkitTemplate.DefaultTemplateRequest();
    reqMsg.setProtocol(passkitTemplate.PassProtocol.MEMBERSHIP);
    reqMsg.setRevision(1);

    const result: unknown = await new Promise((resolve, reject) =>
      templates.getDefaultTemplate(reqMsg, (err: unknown, res: unknown) => (err ? reject(err) : resolve(res))),
    );

    return NextResponse.json({
      ok: true,
      type: typeof result,
      hasGetName: typeof (result as { getName?: () => string })?.getName === "function",
    });
  } catch (e) {
    const err = e as { code?: number; details?: string; message?: string; name?: string; stack?: string };
    return NextResponse.json({
      ok: false,
      name: err.name,
      message: err.message,
      code: err.code,
      details: err.details,
      stack: err.stack?.split("\n").slice(0, 8),
    });
  }
}
