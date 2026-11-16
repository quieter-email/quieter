"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import type { CollaborationScope } from "@quieter/mail/collaboration";
import type { CollaborationNoteParticipant } from "@quieter/mail/collaboration-notes";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { Input } from "@quieter/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { Text } from "@quieter/ui/text";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { collaborationFailure } from "./notes-session";

export const NoteParticipants = ({
  disabled,
  epoch,
  onAccessLost,
  onChange,
  prefix,
  scope,
  selected,
}: {
  disabled: boolean;
  epoch: number;
  onAccessLost: () => void;
  onChange: (participants: CollaborationNoteParticipant[]) => void;
  prefix: readonly unknown[];
  scope: CollaborationScope;
  selected: CollaborationNoteParticipant[];
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [afterMemberId, setAfterMemberId] = useState<string>();
  const labelId = useId();
  const catalog = useQuery({
    enabled: open && !disabled,
    queryFn: async ({ signal }) =>
      await rpc.collaboration.notes.participants(
        {
          ...scope,
          search,
          ...(afterMemberId === undefined ? {} : { afterMemberId }),
        },
        { signal }
      ),
    queryKey: [
      ...prefix,
      "private",
      "participants",
      epoch,
      search,
      afterMemberId,
    ],
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    if (catalog.isError && collaborationFailure(catalog.error) === "lost") {
      onAccessLost();
    }
  }, [catalog.error, catalog.isError, onAccessLost]);
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button disabled={disabled} size="sm" variant="secondary" />}
        >
          Notify teammates{selected.length > 0 ? ` (${selected.length})` : ""}
        </PopoverTrigger>
        <PopoverContent align="start" scrollable size="sm">
          <div className="space-y-3">
            <PopoverTitle>Notify teammates</PopoverTitle>
            <Text size="caption" tone="muted">
              Only selected teammates are notified. This never sends email.
            </Text>
            <Input
              aria-label="Find a teammate"
              maxLength={128}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setAfterMemberId(undefined);
              }}
              placeholder="Find a teammate"
              value={search}
            />
            <fieldset aria-labelledby={labelId} className="space-y-2">
              <Text id={labelId} size="caption" tone="muted">
                Current participants
              </Text>
              {catalog.isPending ? (
                <Text size="sm" tone="muted">
                  Loading teammates...
                </Text>
              ) : null}
              {catalog.isError ? (
                <div className="space-y-2">
                  <Text size="sm" tone="muted">
                    Could not load teammates.
                  </Text>
                  <Button
                    onClick={() => {
                      void (async () => {
                        const result = await catalog.refetch();
                        if (result.isError) {
                          toastError(result.error, {
                            boundary: "internal-note-participants",
                          });
                        }
                      })();
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              {catalog.data?.participants.map((participant) => {
                const checked = selected.some(
                  (entry) => entry.memberId === participant.memberId
                );
                return (
                  <label
                    className="flex items-center gap-2"
                    key={participant.memberId}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || (!checked && selected.length >= 50)}
                      onCheckedChange={(next) => {
                        onChange(
                          next
                            ? [...selected, participant]
                            : selected.filter(
                                (entry) =>
                                  entry.memberId !== participant.memberId
                              )
                        );
                      }}
                    >
                      <CheckboxIndicator />
                    </Checkbox>
                    <Text as="span" size="sm">
                      {participant.name}
                    </Text>
                  </label>
                );
              })}
              {catalog.data?.participants.length === 0 ? (
                <Text size="sm" tone="muted">
                  No matching teammates.
                </Text>
              ) : null}
            </fieldset>
            <ActionFooter>
              {afterMemberId === undefined ? null : (
                <Button
                  onClick={() => {
                    setAfterMemberId(undefined);
                  }}
                  variant="secondary"
                >
                  First
                </Button>
              )}
              {catalog.data?.nextMemberId ? (
                <Button
                  onClick={() => {
                    const next = catalog.data?.nextMemberId;
                    if (next) {
                      setAfterMemberId(next);
                    }
                  }}
                  variant="secondary"
                >
                  More
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  setOpen(false);
                }}
              >
                Done
              </Button>
            </ActionFooter>
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 ? (
        <div aria-label="Selected teammates" className="flex flex-wrap gap-2">
          {selected.map((participant) => (
            <Button
              aria-label={`Stop notifying ${participant.name}`}
              aria-pressed
              disabled={disabled}
              key={participant.memberId}
              onClick={() => {
                onChange(
                  selected.filter(
                    (entry) => entry.memberId !== participant.memberId
                  )
                );
              }}
              size="auto"
              variant="chip"
            >
              {participant.name}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
