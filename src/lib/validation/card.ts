import { z } from "zod";

export const createCardSchema = z.object({
  programName: z.string().trim().min(2, "Program name is required").max(60),
  stampsRequired: z
    .number()
    .int("Stamps required must be a whole number")
    .min(5, "Minimum 5 stamps")
    .max(20, "Maximum 20 stamps"),
  rewardLabel: z
    .string()
    .trim()
    .min(1, "Reward label is required")
    .max(50, "Reward label must be 50 characters or fewer"),
});

export const updateCardSchema = z
  .object({
    id: z.string().min(1),
    programName: z.string().trim().min(2).max(60).optional(),
    stampsRequired: z.number().int().min(5).max(20).optional(),
    rewardLabel: z.string().trim().min(1).max(50).optional(),
  })
  .refine(
    (d) => Object.keys(d).filter((k) => k !== "id").length > 0,
    { message: "At least one field is required" },
  );

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
