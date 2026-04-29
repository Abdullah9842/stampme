import { passkitClient } from "./client";
import {
  CreateProgramInput,
  type CreateProgramOutput,
  PassKitError,
  PassKitErrorCode,
  UpdateProgramTemplateInput,
} from "./types";

export async function createProgram(input: CreateProgramInput): Promise<CreateProgramOutput> {
  const parsed = CreateProgramInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { merchantId, name, brandColor, logoUrl, rewardLabel, stampsRequired } = parsed.data;

  const body = {
    name,
    description: rewardLabel,
    backgroundColor: brandColor,
    foregroundColor: "#FFFFFF",
    labelColor: "#FFFFFF",
    images: { logo: logoUrl, icon: logoUrl },
    fields: {
      header: [{ key: "stamps", label: "Stamps", value: `0/${stampsRequired}` }],
      secondary: [{ key: "reward", label: "Reward", value: rewardLabel }],
    },
    metadata: {
      stampsRequired,
      merchantId,
      app: "stampme",
    },
  };

  const res = await passkitClient.request<{ id: string; templateId: string }>(
    "POST",
    "/members/program",
    { body, idempotencyKey: merchantId },
  );

  if (!res?.id || !res?.templateId) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "PassKit createProgram returned no id",
      upstream: res,
    });
  }

  return { passKitProgramId: res.id, passKitTemplateId: res.templateId };
}

export async function updateProgramTemplate(input: UpdateProgramTemplateInput): Promise<void> {
  const parsed = UpdateProgramTemplateInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { programId, brandColor, logoUrl, rewardLabel, stampsRequired, name } = parsed.data;

  await passkitClient.request<unknown>(
    "PUT",
    `/members/program/template/${encodeURIComponent(programId)}`,
    {
      body: {
        name,
        backgroundColor: brandColor,
        foregroundColor: "#FFFFFF",
        labelColor: "#FFFFFF",
        images: { logo: logoUrl, icon: logoUrl },
        fields: {
          header: [{ key: "stamps", label: "Stamps", value: `0/${stampsRequired}` }],
          secondary: [{ key: "reward", label: "Reward", value: rewardLabel }],
        },
      },
      idempotencyKey: `tpl:${programId}`,
    },
  );
}
