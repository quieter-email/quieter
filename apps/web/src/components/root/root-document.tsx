import { ColorModeScript } from "@quieter/ui/color-mode";
import { HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DeploymentUpdateDialog } from "./deployment-update-dialog";

export const RootDocument = ({
  children,
}: Readonly<{ children: ReactNode }>) => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <ColorModeScript />
      <HeadContent />
    </head>
    <body>
      {children}
      <DeploymentUpdateDialog />
      <Scripts />
    </body>
  </html>
);
