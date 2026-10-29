"use client";

import { LinkButton } from "@quieter/ui/button";
import type { ErrorComponentProps } from "@tanstack/react-router";

export const RouteError = (_props: ErrorComponentProps) => (
  <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 px-6">
    <h1 className="text-2xl">This page did not load</h1>
    <p>Reload the page. If it keeps failing, go back to the landing page.</p>
    <LinkButton to="/home">Back to quieter</LinkButton>
  </main>
);
