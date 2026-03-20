import { auth } from "@quietr/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const createAuthHeaders = async () => new Headers(await headers());

export const requireSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await createAuthHeaders() });

  if (!session?.user) {
    redirect("/home");
  }

  return session;
});

export const redirectIfAuthenticated = cache(async (href = "/") => {
  const session = await auth.api.getSession({ headers: await createAuthHeaders() });

  if (session?.user) {
    redirect(href);
  }
});
