"use client";

import { orpc } from "@quieter/app/lib/orpc";
import {
  DateTimePreferencesProvider,
  useDateTimePreferences,
} from "@quieter/ui/date-time-preferences";
import { useQuery } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

export const AccountDateTimeProvider = ({
  children,
  userId,
}: PropsWithChildren<{ userId: string | undefined }>) => {
  const fallback = useDateTimePreferences();
  const { data } = useQuery({
    ...orpc.accountPreferences.get.queryOptions(),
    enabled: Boolean(userId),
  });

  return (
    <DateTimePreferencesProvider value={data ?? fallback}>
      {children}
    </DateTimePreferencesProvider>
  );
};
