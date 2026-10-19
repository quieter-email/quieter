import type { AudienceContact } from "@quieter/mail/audiences";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Pill } from "@quieter/ui/pill";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  SettingsErrorState,
  SettingsLoadingState,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import { useBroadcastWorkspace } from "./broadcast-workspace";

type ContactAction =
  | "save"
  | "add"
  | "unsubscribe"
  | "resubscribe"
  | "remove"
  | "block";

export const AudienceContactDialog = ({
  audienceId,
  contact,
  onClose,
}: {
  audienceId: string;
  contact?: AudienceContact;
  onClose: () => void;
}) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [tags, setTags] = useState(contact?.tags.join(", ") ?? "");
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false);
  const [confirmation, setConfirmation] =
    useState<Exclude<ContactAction, "save" | "add">>();
  const [historyCursor, setHistoryCursor] = useState<string>();
  // oxlint-disable-next-line react/hook-use-state -- Preserve this operation key while retrying within the contact dialog.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const confirmationCopy = {
    block: contact?.suppression
      ? "Clear this team-wide manual safety block? Subscription stays unchanged."
      : "Block all team email to this address? Subscription stays unchanged.",
    remove:
      "Remove this contact from the audience? Their history remains available.",
    resubscribe: "Record fresh consent before resubscribing.",
    unsubscribe: "Stop this audience's email for this contact?",
  };
  const submitLabel = contact ? "Save changes" : "Add contact";
  const history = useQuery({
    enabled: !!contact,
    queryFn: async () =>
      await rpc.audiences.listHistory({
        audienceId,
        cursor: historyCursor,
        limit: 50,
        membershipId: contact?.id,
        organizationId,
      }),
    queryKey: [
      "audiences",
      organizationId,
      audienceId,
      "history",
      contact?.id,
      historyCursor,
    ],
  });
  const mutation = useMutation({
    mutationFn: async (action: ContactAction) => {
      const input = {
        audienceId,
        channel: "manual" as const,
        idempotencyKey,
        membershipId: contact?.id ?? "",
        organizationId,
      };
      if (action === "add") {
        return await rpc.audiences.registerContact({
          audienceId,
          consentSource: source,
          email,
          idempotencyKey,
          name,
          organizationId,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
      }
      if (action === "save") {
        return await rpc.audiences.updateContact({
          ...input,
          name,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
      }
      if (action === "resubscribe") {
        return await rpc.audiences.resubscribeContact({
          ...input,
          consentConfirmed: true,
          consentSource: source,
          occurredAt: new Date().toISOString(),
        });
      }
      if (action === "unsubscribe") {
        return await rpc.audiences.unsubscribeContact({
          ...input,
          reason,
          source: "Audience contact details",
        });
      }
      if (action === "remove") {
        return await rpc.audiences.removeContact({
          ...input,
          reason,
          source: "Audience contact details",
        });
      }
      return await rpc.audiences.setSuppression({
        ...input,
        reason,
        suppressed: !contact?.suppression,
      });
    },
    onError: (error) => {
      toastError(error, {
        boundary: "audience-contact",
        fallback: "Could not update contact. Please try again.",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["audiences", organizationId],
      });
      onClose();
    },
  });
  let historyContent: ReactNode;
  if (history.isPending) {
    historyContent = <SettingsLoadingState label="Loading contact history" />;
  } else {
    historyContent = history.isError ? (
      <SettingsErrorState
        message="Could not load history."
        onRetry={() => void history.refetch()}
      />
    ) : (
      <ol className="max-h-60 divide-y divide-border overflow-y-auto">
        {history.data.items.map((event) => (
          <li className="py-3 text-caption/5" key={event.id}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-fg">
                {event.eventType.replaceAll("_", " ")}
                {event.applied
                  ? ""
                  : " (recorded without changing current state)"}
              </span>
              <time className="text-muted-fg">
                {new Date(event.occurredAt).toLocaleString()}
              </time>
            </div>
            <p className="text-muted-fg">
              {event.source}
              {event.reason ? `, ${event.reason}` : ""}
            </p>
            <p className="text-muted-fg">
              Recorded {new Date(event.recordedAt).toLocaleString()},{" "}
              {event.actorType.replaceAll("_", " ")}, {event.channel}
            </p>
          </li>
        ))}
      </ol>
    );
  }
  let historyPagination: ReactNode;
  if (history.data?.nextCursor) {
    historyPagination = (
      <Button
        onClick={() => {
          setHistoryCursor(history.data?.nextCursor ?? undefined);
        }}
        size="sm"
        variant="ghost"
      >
        Older events
      </Button>
    );
  } else {
    historyPagination = historyCursor ? (
      <Button
        onClick={() => {
          setHistoryCursor(undefined);
        }}
        size="sm"
        variant="ghost"
      >
        Latest events
      </Button>
    ) : null;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent className="w-[min(94vw,40rem)]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(contact ? "save" : "add");
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {contact ? contact.name || contact.email : "Add contact"}
            </DialogTitle>
            <DialogDescription>
              {contact
                ? "Subscription consent and safety blocks are managed separately."
                : "Add someone who has agreed to hear from your team."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody spacing="4">
            {contact ? (
              <div className="flex flex-wrap gap-2">
                <Pill tone={contact.status === "subscribed" ? "green" : "gray"}>
                  {contact.status}
                </Pill>
                <Pill tone={contact.suppression ? "red" : "gray"}>
                  {contact.suppression
                    ? `Blocked, ${contact.suppression.reason}`
                    : "No safety block"}
                </Pill>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input
                  disabled={!!contact || !canManage}
                  maxLength={320}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  required
                  type="email"
                  value={email}
                />
              </Field>
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  disabled={!canManage}
                  maxLength={200}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  value={name}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Tags</FieldLabel>
              <Input
                disabled={!canManage}
                onChange={(event) => {
                  setTags(event.target.value);
                }}
                placeholder="customer, newsletter"
                value={tags}
              />
            </Field>
            {contact ? (
              <p className="text-caption/5 text-muted-fg">
                Consent source: {contact.consentSource}
                <br />
                Consent recorded for{" "}
                {new Date(contact.consentOccurredAt).toLocaleString()}.
              </p>
            ) : (
              <>
                <Field>
                  <FieldLabel>Consent source</FieldLabel>
                  <Input
                    maxLength={500}
                    onChange={(event) => {
                      setSource(event.target.value);
                    }}
                    required
                    value={source}
                  />
                </Field>
                <label
                  className="flex items-start gap-2 text-body"
                  htmlFor="audience-contact-consent"
                >
                  <Checkbox
                    checked={consent}
                    id="audience-contact-consent"
                    onCheckedChange={setConsent}
                  >
                    <CheckboxIndicator />
                  </Checkbox>
                  This person agreed to receive email from this team.
                </label>
              </>
            )}
            {contact && canManage ? (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-body text-fg">Contact actions</p>
                <div className="flex flex-wrap gap-2">
                  {contact.status === "subscribed" ? (
                    <Button
                      onClick={() => {
                        setConfirmation("unsubscribe");
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Unsubscribe
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        setConfirmation("resubscribe");
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Resubscribe with consent
                    </Button>
                  )}
                  {contact.status === "removed" ? null : (
                    <Button
                      onClick={() => {
                        setConfirmation("remove");
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Remove from audience
                    </Button>
                  )}
                  {!contact.suppression ||
                  contact.suppression.reason === "manual" ? (
                    <Button
                      onClick={() => {
                        setConfirmation("block");
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {contact.suppression
                        ? "Clear manual safety block"
                        : "Block across team"}
                    </Button>
                  ) : null}
                </div>
                {confirmation ? (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <p className="text-body text-fg">
                      {confirmationCopy[confirmation]}
                    </p>
                    <Field>
                      <FieldLabel>
                        {confirmation === "resubscribe"
                          ? "New consent source"
                          : "Reason"}
                      </FieldLabel>
                      <Input
                        maxLength={500}
                        onChange={(event) => {
                          if (confirmation === "resubscribe") {
                            setSource(event.target.value);
                          } else {
                            setReason(event.target.value);
                          }
                        }}
                        value={confirmation === "resubscribe" ? source : reason}
                      />
                    </Field>
                    {confirmation === "resubscribe" ? (
                      <label
                        className="flex items-start gap-2 text-body"
                        htmlFor="audience-contact-consent"
                      >
                        <Checkbox
                          checked={consent}
                          id="audience-contact-consent"
                          onCheckedChange={setConsent}
                        >
                          <CheckboxIndicator />
                        </Checkbox>
                        This person has given fresh consent to receive email.
                      </label>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        disabled={
                          mutation.isPending ||
                          (confirmation === "resubscribe" &&
                            (!consent || !source.trim()))
                        }
                        onClick={() => {
                          mutation.mutate(confirmation);
                        }}
                        size="sm"
                      >
                        Confirm{" "}
                        {confirmation === "block"
                          ? "safety change"
                          : confirmation}
                      </Button>
                      <Button
                        onClick={() => {
                          setConfirmation(undefined);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {contact ? (
              <section className="space-y-3 border-t border-border pt-4">
                <h2 className="text-body text-fg">History</h2>
                {historyContent}
                {historyPagination}
              </section>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton disabled={mutation.isPending}>
              Close
            </DialogCloseButton>
            {canManage ? (
              <Button
                disabled={
                  mutation.isPending ||
                  (!contact && (!consent || !email || !source.trim()))
                }
                size="sm"
                type="submit"
              >
                {mutation.isPending ? "Saving…" : submitLabel}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
