"use client";

import { LinkButton } from "@quieter/ui/button";

export const RouteNotFound = () => (
  <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 px-6">
    <h1 className="text-2xl">Page not found</h1>
    <LinkButton to="/home">Back to quieter</LinkButton>
  </main>
);
