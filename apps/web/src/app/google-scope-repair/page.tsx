import type { SearchParams } from "nuqs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getGoogleScopeRepairPageHref,
  getGoogleScopeRepairReturnTo,
  getGoogleScopeRepairStartHref,
} from "~/lib/google-scope-repair";
import { getGoogleScopeRepairTarget, requireSession } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

type GoogleScopeRepairPageProps = {
  searchParams: Promise<SearchParams>;
};

const readStringParam = (value: string | string[] | null | undefined) => {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
};

export default async function GoogleScopeRepairPage({ searchParams }: GoogleScopeRepairPageProps) {
  await requireSession();

  const params = await searchParams;
  const requestedTargetAccountId = readStringParam(params.targetAccountId);
  const returnTo = getGoogleScopeRepairReturnTo(readStringParam(params.from));
  const hasReturnedFromGoogle = readStringParam(params.returned) === "1";
  const repairTarget = await getGoogleScopeRepairTarget({
    targetAccountId: requestedTargetAccountId,
  });

  if (!repairTarget) {
    redirect(returnTo);
  }

  if (requestedTargetAccountId !== repairTarget.providerAccountId) {
    redirect(
      getGoogleScopeRepairPageHref({
        from: returnTo,
        targetAccountId: repairTarget.providerAccountId,
      }),
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-6 py-20">
      <div className="w-full max-w-xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-medium tracking-tight text-foreground">
            Reconnect {repairTarget.emailAddress}
          </h1>
          <p className="text-sm text-muted-foreground">
            Quietr needs Google permissions for {repairTarget.emailAddress}.
          </p>
          {hasReturnedFromGoogle ? (
            <p className="text-sm text-muted-foreground">
              If Google shows multiple accounts, choose {repairTarget.emailAddress}. Quietr will
              keep asking until this mailbox has the required permissions.
            </p>
          ) : null}
        </div>

        <div className="pt-1">
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            href={getGoogleScopeRepairStartHref({
              from: returnTo,
              targetAccountId: repairTarget.providerAccountId,
            })}
          >
            Continue to Google
          </Link>
        </div>
      </div>
    </div>
  );
}
