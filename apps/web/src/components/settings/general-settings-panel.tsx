"use client";

import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, useColorMode } from "@quietr/ui";

export const GeneralSettingsPanel = () => {
  const { colorMode, isMounted, setColorMode } = useColorMode();
  const isDarkMode = isMounted && colorMode === "dark";

  return (
    <Button onClick={() => setColorMode(isDarkMode ? "light" : "dark")} size="sm" variant="default">
      {!isMounted ? (
        <>
          <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
          Theme
        </>
      ) : isDarkMode ? (
        <>
          <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Sun01Icon} />
          Light mode
        </>
      ) : (
        <>
          <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
          Dark mode
        </>
      )}
    </Button>
  );
};
