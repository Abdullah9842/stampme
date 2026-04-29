import { getResend } from "./resend";

export async function sendMarginAlert(args: {
  to: string;
  merchantName: string;
  merchantId: string;
  passesIssued: number;
  costUsd: number;
  revenueUsd: number;
  ratio: number;
}) {
  const from = process.env.RESEND_FROM_EMAIL ?? "stampme <alerts@stampme.com>";
  await getResend().emails.send({
    from,
    to: args.to,
    subject: `[stampme] Margin alert: ${args.merchantName} (${(args.ratio * 100).toFixed(0)}%)`,
    text:
      `Merchant: ${args.merchantName} (${args.merchantId})\n` +
      `Passes this month: ${args.passesIssued}\n` +
      `PassKit cost: $${args.costUsd.toFixed(2)}\n` +
      `Revenue: $${args.revenueUsd.toFixed(2)}\n` +
      `Ratio: ${(args.ratio * 100).toFixed(1)}% (threshold 60%)\n\n` +
      `Action: review pricing tier or rate-limit issuance for this merchant.`,
  });
}
