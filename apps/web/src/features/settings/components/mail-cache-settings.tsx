import { Button } from "@quieter/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";

import { toastError } from "#/lib/error-toast";
import { MailSyncSession, mailSyncState } from "#/lib/mail-sync/session";

import { SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

const limits = [50, 75, 100, 200, 250];

export const MailCacheSettings = () => {
  const { mailboxIds, status } = useSelector(mailSyncState, (state) => state);
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Worker events update the status store and query cache before completion.
  const { isPending: busy, mutate: changeCache } = useMutation({
    mutationFn: async (limit: number | boolean | null) => {
      const selected = MailSyncSession.forMailbox(mailboxIds[0] ?? "");
      if (selected === null) {
        return;
      }
      if (limit === null) {
        await selected.client.action({ input: null, method: "clear-cache" });
      } else if (typeof limit === "boolean") {
        await selected.setPersistence(limit);
      } else {
        await selected.client.action({
          input: limit * 1024 * 1024,
          method: "budget",
        });
      }
    },
    onError: (error) => {
      toastError(error, { boundary: "mail_cache_settings" });
    },
  });
  if (status === null) {
    return null;
  }
  const session = MailSyncSession.forMailbox(mailboxIds[0] ?? "");
  const budget = Math.round(status.budgetBytes / (1024 * 1024));
  const options = [...new Set([...limits, budget])].toSorted(
    (left, right) => left - right
  );
  return (
    <SettingsSection title="Mail on this device">
      <SettingsRows>
        <SettingsRow
          title="Keep mail between visits"
          action={
            <Switch
              aria-label="Keep mail between visits"
              checked={status.persistent}
              disabled={busy || session === null}
              onCheckedChange={(checked) => {
                changeCache(checked);
              }}
            >
              <SwitchThumb />
            </Switch>
          }
        >
          Turn this off on a shared device. Mail will stay in memory only, and
          previously cached mail will be removed from this browser. Drafts you
          are editing are kept separately until you save or discard them.
        </SettingsRow>
        <SettingsRow
          title="Cached mail"
          action={
            <Button
              disabled={busy || session === null}
              onClick={() => {
                changeCache(null);
              }}
              size="sm"
              variant="outline"
            >
              Clear cache
            </Button>
          }
        >
          {status.persistent
            ? `${Math.round(status.cacheBytes / (1024 * 1024))} MB stored in this browser.`
            : "This browser is using a temporary cache."}{" "}
          Recent and visible messages load in the background. Attachments are
          downloaded only when you open them.
        </SettingsRow>
        <SettingsRow
          title="Storage limit"
          action={
            <Select
              disabled={busy || !status.persistent}
              items={options.map((value) => ({
                label: `${value} MB`,
                value: String(value),
              }))}
              onValueChange={(value) => {
                if (value !== null) {
                  changeCache(Number(value));
                }
              }}
              value={String(budget)}
            >
              <SelectTrigger
                aria-label="Mail cache storage limit"
                className="w-36"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {options.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} MB
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          Older content is removed automatically as space fills up. Clearing the
          cache keeps your drafts and pending changes.
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
};
