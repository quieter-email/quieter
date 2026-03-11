import { auth } from "@quietr/auth";
import { assertDatabaseConfigured } from "@quietr/database";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const createAuthHeaders = async () => new Headers(await headers());

export const getSession = cache(async () => {
  assertDatabaseConfigured();
  return await auth.api.getSession({ headers: await createAuthHeaders() });
});

export const requireSession = cache(async () => {
  const session = await getSession();

  if (!session?.user) {
    redirect("/home");
  }

  return session;
});

export const redirectIfAuthenticated = cache(async (href = "/") => {
  const session = await getSession();

  if (session?.user) {
    redirect(href);
  }
});
