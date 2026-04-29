import { passkitGrpc } from "./client";
import {
  CreateProgramInput,
  type CreateProgramOutput,
  PassKitError,
  PassKitErrorCode,
  UpdateProgramTemplateInput,
} from "./types";

// ---------------------------------------------------------------------------
// Proto message imports
// ---------------------------------------------------------------------------
import {
  DefaultTemplateRequest,
  Colors,
} from "passkit-node-sdk/io/common/template_pb";
// PassProtocol lives in protocols_pb but template_pb re-exports it via
// goog.object.extend. Import directly from protocols_pb for clarity.
import { PassProtocol } from "passkit-node-sdk/io/common/protocols_pb";
import { Program, PointsType, BalanceType } from "passkit-node-sdk/io/member/program_pb";
import { Tier, TierRequestInput } from "passkit-node-sdk/io/member/tier_pb";
import { ProjectStatus } from "passkit-node-sdk/io/common/project_pb";
import { Id } from "passkit-node-sdk/io/common/common_objects_pb";

// ---------------------------------------------------------------------------
// Generic gRPC callback → Promise adapter
//
// passkit-node-sdk ships no TypeScript declarations (pure-JS proto-generated).
// All proto message types are `any` from the ambient .d.ts we provide in
// src/types/passkit-node-sdk.d.ts. Using `unknown` here keeps this helper
// type-safe for our own code while accepting any SDK object as request/response.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promisify<TReq = any, TRes = any>(
  fn: (req: TReq, cb: (err: Error | null, res: TRes) => void) => void,
  req: TReq,
): Promise<TRes> {
  return new Promise((resolve, reject) =>
    fn(req, (err, res) => (err ? reject(err) : resolve(res))),
  );
}

// ---------------------------------------------------------------------------
// Tier ID convention
//
// The PassKit Program proto does not hold a templateId directly — the link is
// made through a Tier (passtemplateid). We use a deterministic tier ID so that
// updateProgramTemplate can look it up later using only the programId.
// ---------------------------------------------------------------------------
function defaultTierId(passKitProgramId: string): string {
  return `tier-${passKitProgramId}`;
}

// ---------------------------------------------------------------------------
// createProgram
//
// Full create flow (mirrors the official quickstart pattern):
//   1. getDefaultTemplate(MEMBERSHIP, rev=1) → PassTemplate object
//   2. Mutate template (name, description, colors)
//   3. createTemplate(template)              → Id → passKitTemplateId
//   4. createProgram(program)                → Id → passKitProgramId
//   5. createTier(tier)                      → links program ↔ template
//
// NOTE: BalanceType in the SDK is BALANCE_TYPE_STRING/INT/DOUBLE/MONEY.
// There is no STAMPS enum value — BALANCE_TYPE_INT is correct for stamp counts.
// stampsRequired is stored in our DB; PassKit is not aware of the per-program cap.
// ---------------------------------------------------------------------------
export async function createProgram(input: CreateProgramInput): Promise<CreateProgramOutput> {
  const parsed = CreateProgramInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { name, brandColor, rewardLabel } = parsed.data;

  const grpcClient = passkitGrpc();

  // ── Step 1: fetch default membership template ───────────────────────────
  const tplReq = new DefaultTemplateRequest();
  tplReq.setProtocol(PassProtocol.MEMBERSHIP);
  tplReq.setRevision(1);

  const template = await promisify(
    grpcClient.templates.getDefaultTemplate.bind(grpcClient.templates),
    tplReq,
  );

  // ── Step 2: customize template ──────────────────────────────────────────
  template.setName(name);
  template.setDescription(rewardLabel);
  // Mutate the default template's Colors in place — replacing the whole Colors
  // object wipes fields PassKit requires (textcolor etc.) and triggers
  // INVALID_ARGUMENT "colors have incorrect format".
  const existingColors = template.getColors();
  if (existingColors) {
    existingColors.setBackgroundcolor(brandColor);
  } else {
    const colors = new Colors();
    colors.setBackgroundcolor(brandColor);
    colors.setForegroundcolor("#FFFFFF");
    colors.setLabelcolor("#FFFFFF");
    template.setColors(colors);
  }
  // Timezone is required by the quickstart; UTC is a safe default.
  template.setTimezone("UTC");

  // ── Step 3: create the customized template ─────────────────────────────
  const createdTemplateIdMsg = await promisify(
    grpcClient.templates.createTemplate.bind(grpcClient.templates),
    template,
  );
  const passKitTemplateId = createdTemplateIdMsg.getId();

  if (!passKitTemplateId) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "createProgram: createTemplate returned empty id",
    });
  }

  // ── Step 4: create the loyalty program ────────────────────────────────
  const pointsType = new PointsType();
  pointsType.setBalancetype(BalanceType.BALANCE_TYPE_INT);

  const program = new Program();
  program
    .setName(name)
    .addStatus(ProjectStatus.PROJECT_DRAFT)
    .addStatus(ProjectStatus.PROJECT_ACTIVE_FOR_OBJECT_CREATION)
    .setPointstype(pointsType);

  const createdProgramIdMsg = await promisify(
    grpcClient.members.createProgram.bind(grpcClient.members),
    program,
  );
  const passKitProgramId = createdProgramIdMsg.getId();

  if (!passKitProgramId) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "createProgram: createProgram returned empty id",
    });
  }

  // ── Step 5: create the default tier (links template ↔ program) ─────────
  // Tier ID is deterministic from programId so updateProgramTemplate can look
  // it up later without needing a stored tierId.
  const tier = new Tier();
  tier
    .setId(defaultTierId(passKitProgramId))
    .setName("Default")
    .setTierindex(1)
    .setProgramid(passKitProgramId)
    .setPasstemplateid(passKitTemplateId)
    .setTimezone("UTC");

  // TODO(plan-4): capture tierId if member enrolment endpoints require it directly.
  await promisify(
    grpcClient.members.createTier.bind(grpcClient.members),
    tier,
  );

  return { passKitProgramId, passKitTemplateId };
}

// ---------------------------------------------------------------------------
// updateProgramTemplate
//
// The input carries `programId` (the PassKit program ID). We reconstruct the
// tier ID using the same convention as createProgram, then getTier to retrieve
// the passtemplateid. With that we fetch + mutate + push the template update.
// ---------------------------------------------------------------------------
export async function updateProgramTemplate(input: UpdateProgramTemplateInput): Promise<void> {
  const parsed = UpdateProgramTemplateInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { programId, brandColor, rewardLabel, name } = parsed.data;

  const grpcClient = passkitGrpc();

  // Retrieve the tier to get its passtemplateid.
  const tierReq = new TierRequestInput();
  tierReq.setProgramid(programId);
  tierReq.setTierid(defaultTierId(programId));

  const tier = await promisify(
    grpcClient.members.getTier.bind(grpcClient.members),
    tierReq,
  );
  const passKitTemplateId = tier.getPasstemplateid();

  if (!passKitTemplateId) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `updateProgramTemplate: no template linked to program ${programId}`,
    });
  }

  // Fetch the existing template to avoid clobbering unrelated fields.
  const templateIdMsg = new Id();
  templateIdMsg.setId(passKitTemplateId);

  const existing = await promisify(
    grpcClient.templates.getTemplate.bind(grpcClient.templates),
    templateIdMsg,
  );

  existing.setName(name);
  existing.setDescription(rewardLabel);

  const colors = existing.getColors() ?? new Colors();
  colors.setBackgroundcolor(brandColor);
  colors.setForegroundcolor("#FFFFFF");
  colors.setLabelcolor("#FFFFFF");
  existing.setColors(colors);

  await promisify(
    grpcClient.templates.updateTemplate.bind(grpcClient.templates),
    existing,
  );
}
