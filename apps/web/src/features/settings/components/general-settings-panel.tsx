"use client";

import { ComputerIcon, Image01Icon, Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Switch, SwitchThumb, useColorMode } from "@quieter/ui";
import {
  setExternalImagesEnabled,
  useExternalImagesEnabled,
} from "~/features/settings/domain/external-images-setting";

export const GeneralSettingsPanel = () => {
  const { configColorMode, cycleColorMode, isMounted } = useColorMode();
  const externalImagesEnabled = useExternalImagesEnabled();

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Appearance</h2>
        <Button onClick={() => cycleColorMode()} size="sm" variant="default">
          {!isMounted ? (
            <>
              <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
              Theme
            </>
          ) : configColorMode === "light" ? (
            <>
              <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
              Dark mode
            </>
          ) : configColorMode === "dark" ? (
            <>
              <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={ComputerIcon} />
              System
            </>
          ) : (
            <>
              <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Sun01Icon} />
              Light mode
            </>
          )}
        </Button>
      </section>

      <section className="border-t border-border/70 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              aria-hidden
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            >
              <HugeiconsIcon className="size-4" icon={Image01Icon} />
            </div>
            <div className="min-w-0">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="external-images-toggle"
              >
                Allow external images
              </label>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                When disabled, remote images stay hidden until you allow them for the open message.
              </p>
            </div>
          </div>

          <Switch
            checked={externalImagesEnabled}
            className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
            id="external-images-toggle"
            onCheckedChange={setExternalImagesEnabled}
          >
            <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
          </Switch>
        </div>
      </section>
    </div>
  );
};
