import { Resend } from "resend";

let client: Resend | null = null;

export function getResend(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    client = new Resend(key);
  }
  return client;
}

export async function sendTestEmail(to: string) {
  const from = process.env.RESEND_FROM_EMAIL ?? "stampme <onboarding@resend.dev>";
  return getResend().emails.send({
    from,
    to,
    subject: "stampme test",
    html: "<p>It works.</p>",
  });
}
