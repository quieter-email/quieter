import type { ReactNode } from "react";
import { HeadContent, Scripts } from "@tanstack/react-router";
export const RootDocument = ({ children }: Readonly<{ children: ReactNode }>) => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);
