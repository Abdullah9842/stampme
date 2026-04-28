import { SignUp } from "@clerk/nextjs";
import { setRequestLocale } from "next-intl/server";

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 p-6">
      <SignUp appearance={{ elements: { rootBox: "mx-auto" } }} />
    </main>
  );
}
