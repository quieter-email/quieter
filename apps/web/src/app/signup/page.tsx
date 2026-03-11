import { AuthScreen } from "~/components/auth-screen";
import { redirectIfAuthenticated } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  await redirectIfAuthenticated("/");

  return <AuthScreen mode="signup" />;
}
