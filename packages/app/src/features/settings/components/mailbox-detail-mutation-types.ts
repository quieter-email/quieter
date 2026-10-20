import type { MailboxGrantRole } from "@quieter/app/features/mailbox/components/mailbox-access-pill";
import type { UseMutationResult } from "@tanstack/react-query";

export type SettingsMutation<TVariables> = {
  isPending: boolean;
  mutate: (
    variables: TVariables,
    options?: { onError?: (error: unknown) => void; onSettled?: () => void }
  ) => void;
};

export type ManagedMailboxUpdateInput = {
  displayName?: string;
  divisionId?: string | null;
  includeApiSentMessages?: boolean;
  mailboxId: string;
};

export type ManagedMailboxGrantInput = {
  mailboxId: string;
  role: MailboxGrantRole;
  userId: string;
};

export type ManagedMailboxDivisionGrantInput = {
  divisionId: string;
  mailboxId: string;
  role: MailboxGrantRole;
};

export type ManagedMailboxAccessModeInput = {
  accessMode: "private" | "shared";
  mailboxId: string;
  ownerUserId?: string;
};

export type ManagedMailboxToggleInput = {
  enabled: boolean;
  mailboxId: string;
};

export const asSettingsMutation = <TVariables>(
  mutation: Pick<
    UseMutationResult<unknown, unknown, TVariables>,
    "isPending" | "mutate"
  >
): SettingsMutation<TVariables> => mutation;
