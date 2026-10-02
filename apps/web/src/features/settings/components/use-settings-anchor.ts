import { useEffect, useRef } from "react";

import { settingsRouteApi } from "#/lib/route-apis";

export const useSettingsAnchor = (title: string) => {
  const { section } = settingsRouteApi.useSearch();
  const ref = useRef<HTMLDivElement>(null);
  const selected =
    section !== "" &&
    section ===
      title
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/gu, "-")
        .replaceAll(/^-|-$/gu, "");
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "center" });
    }
  }, [selected]);
  return { ref, selected };
};
