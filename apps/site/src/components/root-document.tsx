import { ColorModeScript } from "@quieter/ui/color-mode";
import { HeadContent, Scripts, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const RootDocument = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorModeScript
          forcedTheme={pathname === "/home" ? "dark" : undefined}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
};
