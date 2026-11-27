"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import {
  persistQueryByKey,
  queryPersister,
} from "@quieter/app/lib/query-persister";
import {
  DateTimePreferencesProvider,
  useDateTimePreferences,
} from "@quieter/ui/date-time-preferences";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { z } from "zod";

const preferencePatchSchema = z.object({
  timeFormat: z.enum(["12h", "24h"]).optional(),
  undoSendEnabled: z.boolean().optional(),
  weekStartsOn: z.literal([0, 1, 2, 3, 4, 5, 6]).optional(),
});

export const useAccountPreferences = (enabled = true) => {
  const query = useQuery({
    ...orpc.accountPreferences.get.queryOptions(),
    enabled,
    persister: queryPersister.persisterFn,
  });
  const pending = useMutationState({
    filters: {
      mutationKey: orpc.accountPreferences.update.mutationOptions().mutationKey,
      status: "pending",
    },
    select: ({ state }) => preferencePatchSchema.safeParse(state.variables),
  });
  const data = query.data === undefined ? undefined : { ...query.data };
  if (data !== undefined) {
    for (const patch of pending) {
      if (patch.success) {
        Object.assign(data, patch.data);
      }
    }
  }
  return { ...query, data };
};

export const useUpdateAccountPreferences = (boundary: string) => {
  const queryClient = useQueryClient();
  const { queryKey } = orpc.accountPreferences.get.queryOptions();
  return useMutation({
    ...orpc.accountPreferences.update.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary });
    },
    onSuccess: async (preferences) => {
      await queryClient.cancelQueries({ exact: true, queryKey });
      queryClient.setQueryData(queryKey, preferences);
      void persistQueryByKey(queryKey, queryClient);
    },
    scope: { id: "account-preferences" },
  });
};

export const AccountDateTimeProvider = ({
  children,
  userId,
}: PropsWithChildren<{ userId: string | undefined }>) => {
  const fallback = useDateTimePreferences();
  const { data } = useAccountPreferences(Boolean(userId));

  return (
    <DateTimePreferencesProvider value={data ?? fallback}>
      {children}
    </DateTimePreferencesProvider>
  );
};
