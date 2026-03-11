import { redirect } from "next/navigation";
import { redirectIfAuthenticated } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function AuthPage() {
  await redirectIfAuthenticated("/");

  redirect("/login");
}
