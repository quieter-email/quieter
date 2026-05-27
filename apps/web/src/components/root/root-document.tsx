import type { ReactNode } from "react";
import { HeadContent, Scripts } from "@tanstack/react-router";
import { LogoDevFooter } from "./logo-dev-footer";

export const RootDocument = ({ children }: Readonly<{ children: ReactNode }>) => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <LogoDevFooter />
      <Scripts />
    </body>
  </html>
);
