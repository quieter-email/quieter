import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";

import appCss from "../styles.css?url";

const appCssHref = typeof appCss === "string" ? appCss : "";

export type UnsubscribePage =
  | { status: "confirmation" }
  | { status: "success" }
  | { status: "error"; message: string };

export const UnsubscribeDocument = ({ page }: { page: UnsubscribePage }) => {
  const title = {
    confirmation: "Leave this audience",
    error: "Could not unsubscribe",
    success: "You have been unsubscribed",
  }[page.status];
  const description =
    page.status === "error"
      ? page.message
      : {
          confirmation:
            "You will stop receiving broadcasts from this audience. Your other subscriptions will stay the same.",
          success: "You will no longer receive broadcasts from this audience.",
        }[page.status];

  return (
    <html className="dark" lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width,initial-scale=1" name="viewport" />
        <meta content="dark" name="color-scheme" />
        <title>{title}</title>
        <link href={appCssHref} rel="stylesheet" />
      </head>
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
          <div className="w-full max-w-136">
            <Surface padding="comfortable" variant="panel">
              <div className="flex flex-col gap-6">
                <Text as="h1" size="title" weight="medium">
                  {title}
                </Text>
                <Text tone="muted">{description}</Text>
                {page.status === "confirmation" ? (
                  <form method="post">
                    <input
                      name="List-Unsubscribe"
                      type="hidden"
                      value="One-Click"
                    />
                    <ActionFooter>
                      <Button type="submit">Unsubscribe</Button>
                    </ActionFooter>
                  </form>
                ) : null}
              </div>
            </Surface>
          </div>
        </main>
      </body>
    </html>
  );
};
