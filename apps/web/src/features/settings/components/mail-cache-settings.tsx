import { Button } from "@quieter/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useSelector } from "@tanstack/react-store";
import { useState } from "react";

import { toastError } from "#/lib/error-toast";
import { MailSyncSession, mailSyncState } from "#/lib/mail-sync/session";

import { SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

const limits = [50, 75, 100, 200, 250];

export const MailCacheSettings = () => {
  const { mailboxIds, status } = useSelector(mailSyncState, (state) => state);
  const [busy, setBusy] = useState(false);
  if (status === null || status.connection === "disabled") {
    return null;
  }
  const session = MailSyncSession.forMailbox(mailboxIds[0] ?? "");
  const budget = Math.round(status.budgetBytes / (1024 * 1024));
  const options = [...new Set([...limits, budget])].toSorted(
    (left, right) => left - right
  );
  const changeCache = async (limit: number | null) => {
    if (session === null) {
      return;
    }
    setBusy(true);
    try {
      if (limit === null) {
        await session.client.action({ input: null, method: "clear-cache" });
      } else {
        await session.client.action({
          input: limit * 1024 * 1024,
          method: "budget",
        });
      }
    } catch (error) {
      toastError(error, { boundary: "mail_cache_settings" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection title="Mail on this device">
      <SettingsRows>
        <SettingsRow
          title="Cached mail"
          action={
            <Button
              disabled={busy || session === null}
              onClick={() => {
                void changeCache(null);
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
                  void changeCache(Number(value));
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
