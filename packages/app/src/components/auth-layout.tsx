"use client";

import { Brand } from "@quieter/ui/brand";
import { Text } from "@quieter/ui/text";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AtmosphericBackground } from "./atmospheric-background";

export const AuthLayout = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <main className="dark relative isolate min-h-dvh w-full overflow-hidden bg-bg">
    <AtmosphericBackground variant="closing" />
    <div
      aria-hidden
      className="auth-background-shade pointer-events-none absolute inset-0"
    />
    <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-[22rem]">
        <Brand
          // oxlint-disable-next-line shadcn/no-restyle -- Auth keeps the shared brand size centered above the form.
          className="mx-auto mb-8 h-6 w-24 text-fg"
          variant="combination"
        />
        <Text as="h1" className="text-center" size="title" weight="medium">
          {title}
        </Text>
        {children}
        <nav
          aria-label="Legal"
          className="mt-10 flex justify-center gap-5 text-caption text-muted-fg"
        >
          <Link
            className="rounded-sm underline underline-offset-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            to="/terms"
          >
            Terms
          </Link>
          <Link
            className="rounded-sm underline underline-offset-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            to="/privacy"
          >
            Privacy
          </Link>
        </nav>
      </div>
    </div>
  </main>
);
