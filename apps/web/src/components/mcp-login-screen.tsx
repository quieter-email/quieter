"use client";

import { AuthLayout } from "@quieter/app/components/auth-layout";
import { getRouteApi } from "@tanstack/react-router";

import { AuthCredentials } from "#/components/auth-screen";

const routeApi = getRouteApi("/_app/oauth/login");

export const McpLoginScreen = () => {
  const search = routeApi.useSearch();

  return (
    <AuthLayout title="Continue to quieter">
      <p className="mt-4 text-center text-body text-muted-fg">
        Sign in to connect an app to your account.
      </p>
      <AuthCredentials
        returnTo={`/oauth/login?${new URLSearchParams(search)}`}
      />
    </AuthLayout>
  );
};
