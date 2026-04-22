"use client";

import { ComputerIcon, Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, useColorMode } from "@quieter/ui";

export const GeneralSettingsPanel = () => {
  const { configColorMode, cycleColorMode, isMounted } = useColorMode();

  return (
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
  );
};
