import type { SearchParams } from "nuqs/server";
import { AuthScreen } from "~/components/auth-screen";
import { redirectIfAuthenticated } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

type SignupPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  await redirectIfAuthenticated("/");

  const params = await searchParams;
  const authErrorCode = Array.isArray(params.error) ? params.error[0] : (params.error ?? null);

  return <AuthScreen authErrorCode={authErrorCode} mode="signup" />;
}
