import {
  SettingsErrorState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import {
  DEFAULT_VIEW_OPTIONS,
  setDefaultView,
  useDefaultView,
} from "@quieter/app/features/settings/domain/default-view-setting";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  getMailboxesQueryKey,
  mailboxesQueryOptions,
} from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const DefaultMailboxSetting = () => {
  const userId = authClient.useSession().data?.user.id ?? "";
  const defaultView = useDefaultView(userId);
  const queryClient = useQueryClient();
  const { data, error, isError, isPending, refetch } = useQuery(
    mailboxesQueryOptions()
  );
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    onError: (mutationError) => {
      toastError(mutationError, { boundary: "default-mailbox-setting" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });
  const items = [
    { label: "All inboxes", value: "all-inboxes" },
    ...(data?.groups ?? []).flatMap((group) =>
      group.mailboxes
        .filter((mailbox) => mailbox.provider !== "api")
        .map((mailbox) => ({
          label: mailbox.displayName?.trim()
            ? `${mailbox.displayName} (${mailbox.emailAddress})`
            : mailbox.emailAddress,
          value: mailbox.id,
        }))
    ),
  ];

  return (
    <SettingsSection title="Mail">
      {isError ? (
        <SettingsErrorState
          message={error.message}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : (
        <SettingsRows>
          <SettingsRow
            action={
              <Select
                disabled={!userId}
                items={DEFAULT_VIEW_OPTIONS}
                onValueChange={(value) => {
                  const option = DEFAULT_VIEW_OPTIONS.find(
                    (item) => item.value === value
                  );
                  if (option) {
                    setDefaultView(userId, option.value);
                  }
                }}
                value={defaultView}
              >
                <SelectTrigger
                  aria-label="Default view"
                  className="w-36 @md:w-60"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectList>
                    {DEFAULT_VIEW_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            }
            title="Default view"
          >
            Choose what opens when you start Quieter on this device.
          </SettingsRow>
          <SettingsRow
            action={
              <Select
                disabled={isPending || setDefaultMailboxMutation.isPending}
                items={items}
                onValueChange={(value) => {
                  if (value === null) {
                    return;
                  }
                  setDefaultMailboxMutation.mutate({
                    mailboxId: value === "all-inboxes" ? null : value,
                  });
                }}
                value={data?.defaultMailboxId ?? "all-inboxes"}
              >
                <SelectTrigger
                  aria-label="Default mailbox"
                  className="w-36 @md:w-60"
                  pending={isPending || setDefaultMailboxMutation.isPending}
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectList>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        <span className="block max-w-72 truncate">
                          {item.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            }
            title="Default mailbox"
          >
            Choose which mailbox to use when opening mail.
          </SettingsRow>
        </SettingsRows>
      )}
    </SettingsSection>
  );
};
