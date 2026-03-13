import type { SearchParams } from "nuqs/server";
import { AuthScreen } from "~/components/auth-screen";
import { redirectIfAuthenticated } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectIfAuthenticated("/");

  const params = await searchParams;
  const authErrorCode = Array.isArray(params.error) ? params.error[0] : (params.error ?? null);

  return <AuthScreen authErrorCode={authErrorCode} mode="login" />;
}
