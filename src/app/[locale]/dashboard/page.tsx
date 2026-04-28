import { auth, currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";

// Plan 1 stub — replaced by Plan 2 (onboarding/card designer).
// Confirms the auth loop works end-to-end after sign-up.
export default async function DashboardStub({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { userId } = await auth();
  if (!userId) redirect(`/${locale}/sign-in`);

  const user = await currentUser();
  const display =
    user?.primaryPhoneNumber?.phoneNumber ??
    user?.primaryEmailAddress?.emailAddress ??
    user?.username ??
    userId;

  return (
    <div className="container mx-auto flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-bold">stampme · dashboard</h1>
      <p className="text-muted-foreground">
        Signed in as <span className="font-mono text-foreground">{display}</span>
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        Plan 1 stub — Plan 2 will replace this with the merchant onboarding flow + card
        designer.
      </p>
      <UserButton />
    </div>
  );
}
