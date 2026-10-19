import type { Campaign } from "@quieter/mail/campaigns";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { ContentSection } from "@quieter/ui/content-section";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useState } from "react";

import { resolveMailDomainVerified } from "#/features/settings/components/organization-settings/mail-domains";
import {
  SettingsCard,
  SettingsErrorState,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import { useBroadcastWorkspace } from "./broadcast-workspace";

export const CampaignEditor = ({ campaign }: { campaign: Campaign }) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(campaign);
  const [draft, setDraft] = useState({
    audienceId: campaign.audienceId,
    from: campaign.from,
    name: campaign.name,
    segmentIds: campaign.segmentIds,
    subject: campaign.subject,
    text: campaign.text,
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const dirty =
    draft.name !== saved.name ||
    draft.audienceId !== saved.audienceId ||
    draft.from !== saved.from ||
    draft.subject !== saved.subject ||
    draft.text !== saved.text ||
    draft.segmentIds.join("\n") !== saved.segmentIds.join("\n");
  const blocker = useBlocker({
    enableBeforeUnload: dirty,
    shouldBlockFn: () => dirty,
    withResolver: true,
  });
  const audiences = useQuery({
    queryFn: async () =>
      await rpc.audiences.list({ limit: 100, organizationId }),
    queryKey: ["audiences", organizationId, "campaign-picker"],
  });
  const segments = useQuery({
    enabled: !!draft.audienceId,
    queryFn: async () =>
      await rpc.audiences.listSegments({
        audienceId: draft.audienceId,
        organizationId,
      }),
    queryKey: ["audiences", organizationId, draft.audienceId, "segments"],
  });
  const domains = useQuery({
    queryFn: async () => await rpc.mailDomains.list({ organizationId }),
    queryKey: ["mail-domains", organizationId],
  });
  const verifiedDomains =
    domains.data?.domains
      .filter(resolveMailDomainVerified)
      .map((domain) => domain.domain) ?? [];
  const save = useMutation({
    mutationFn: async () =>
      await rpc.campaigns.update({
        ...draft,
        campaignId: campaign.id,
        expectedUpdatedAt: saved.updatedAt,
        organizationId,
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "campaign-draft",
        fallback: "Could not save campaign. Please try again.",
      });
    },
    onSuccess: async (data) => {
      setSaved(data);
      setDraft({
        audienceId: data.audienceId,
        from: data.from,
        name: data.name,
        segmentIds: data.segmentIds,
        subject: data.subject,
        text: data.text,
      });
      await queryClient.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
      toast.success("Draft saved.");
    },
  });
  const preview = useMutation({
    mutationFn: async () =>
      await rpc.campaigns.preview({ campaignId: campaign.id, organizationId }),
    onError: (error) => {
      toastError(error, {
        boundary: "campaign-review",
        fallback: "Could not review campaign. Please try again.",
      });
    },
    onSuccess: () => {
      setConfirmed(false);
      setSendKey(crypto.randomUUID());
      setReviewOpen(true);
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      if (!preview.data) {
        throw new Error("Review the campaign before sending.");
      }
      return await rpc.campaigns.send({
        campaignId: campaign.id,
        confirmed: true,
        expectedUpdatedAt: saved.updatedAt,
        idempotencyKey: sendKey,
        organizationId,
        previewToken: preview.data.previewToken,
      });
    },
    onError: (error) => {
      toastError(error, {
        boundary: "campaign-send",
        fallback: "Could not start campaign. Please try again.",
      });
    },
    onSuccess: async () => {
      setReviewOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
    },
  });
  const audience = audiences.data?.items.find(
    (item) => item.id === draft.audienceId
  );
  const selectedSegments =
    segments.data?.filter((segment) => draft.segmentIds.includes(segment.id)) ??
    [];
  const saveLabel = dirty
    ? "Unsaved changes"
    : `Saved ${new Date(saved.updatedAt).toLocaleString()}`;
  return (
    <>
      <form
        className="space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <ContentSection
          title="Draft"
          description={
            dirty
              ? "You have unsaved changes. Save before reviewing your send."
              : "Saved draft. Nothing sends until you confirm the review."
          }
        >
          <SettingsCard>
            <div className="grid gap-5 p-5 sm:p-6">
              <Field>
                <FieldLabel>Campaign name</FieldLabel>
                <Input
                  disabled={!canManage || save.isPending}
                  maxLength={200}
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value });
                  }}
                  required
                  value={draft.name}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Audience</FieldLabel>
                  <Select
                    disabled={!canManage || save.isPending}
                    items={
                      audiences.data?.items.map((item) => ({
                        label: item.name,
                        value: item.id,
                      })) ?? []
                    }
                    onValueChange={(value) => {
                      if (value) {
                        setDraft({
                          ...draft,
                          audienceId: value,
                          segmentIds: [],
                        });
                      }
                    }}
                    value={draft.audienceId}
                  >
                    <SelectTrigger aria-label="Audience">
                      <SelectValue placeholder="Choose an audience" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectList>
                        {audiences.data?.items.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectList>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Sender email</FieldLabel>
                  <Input
                    disabled={!canManage || save.isPending}
                    maxLength={320}
                    onChange={(event) => {
                      setDraft({ ...draft, from: event.target.value });
                    }}
                    placeholder="hello@yourdomain.com"
                    type="email"
                    value={draft.from}
                  />
                </Field>
              </div>
              {domains.isError ? (
                <SettingsErrorState
                  message="Could not load sender domains."
                  onRetry={() => void domains.refetch()}
                />
              ) : (
                <p className="text-caption/5 text-muted-fg">
                  {verifiedDomains.length
                    ? `Verified sender domains: ${verifiedDomains.join(", ")}`
                    : "Verify a sending domain in team settings before sending."}
                </p>
              )}
              {audiences.isError ? (
                <SettingsErrorState
                  message="Could not load audiences."
                  onRetry={() => void audiences.refetch()}
                />
              ) : null}
              {segments.isError ? (
                <SettingsErrorState
                  message="Could not load segments."
                  onRetry={() => void segments.refetch()}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-body font-medium text-fg">Segments</p>
                  <p className="text-caption/5 text-muted-fg">
                    Leave all unchecked for the whole audience. Multiple
                    segments include contacts matching any selected segment.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {segments.data?.map((segment) => (
                      <label
                        className="flex items-center gap-2 text-body"
                        htmlFor={`campaign-segment-${segment.id}`}
                        key={segment.id}
                      >
                        <Checkbox
                          checked={draft.segmentIds.includes(segment.id)}
                          disabled={!canManage || save.isPending}
                          id={`campaign-segment-${segment.id}`}
                          onCheckedChange={(checked) => {
                            setDraft({
                              ...draft,
                              segmentIds: checked
                                ? [...draft.segmentIds, segment.id]
                                : draft.segmentIds.filter(
                                    (id) => id !== segment.id
                                  ),
                            });
                          }}
                        >
                          <CheckboxIndicator />
                        </Checkbox>
                        {segment.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <Field>
                <FieldLabel>Subject</FieldLabel>
                <Input
                  disabled={!canManage || save.isPending}
                  maxLength={998}
                  onChange={(event) => {
                    setDraft({ ...draft, subject: event.target.value });
                  }}
                  value={draft.subject}
                />
              </Field>
              <Field>
                <FieldLabel>Message</FieldLabel>
                <Textarea
                  // oxlint-disable-next-line shadcn/no-restyle -- Give the campaign's plain text message a comfortable writing area.
                  className="min-h-72"
                  disabled={!canManage || save.isPending}
                  maxLength={100_000}
                  onChange={(event) => {
                    setDraft({ ...draft, text: event.target.value });
                  }}
                  placeholder="Write your message…"
                  value={draft.text}
                />
              </Field>
              <p className="text-caption/5 text-muted-fg">
                An unsubscribe link is included automatically for every
                recipient.
              </p>
            </div>
          </SettingsCard>
        </ContentSection>
        {canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className="text-caption text-muted-fg">
              {save.isPending ? "Saving…" : saveLabel}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={!dirty || save.isPending || preview.isPending}
                size="sm"
                type="submit"
                variant="outline"
              >
                Save draft
              </Button>
              <Button
                disabled={
                  dirty ||
                  save.isPending ||
                  preview.isPending ||
                  !draft.from ||
                  !draft.subject.trim() ||
                  !draft.text.trim()
                }
                onClick={() => {
                  preview.mutate();
                }}
                size="sm"
              >
                {preview.isPending ? "Reviewing…" : "Review send"}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!send.isPending) {
            setReviewOpen(open);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[min(94vw,44rem)] flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Review campaign</DialogTitle>
            <DialogDescription>
              Confirm the saved message and who will receive it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
            {preview.data ? (
              <>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-body">
                  <dt className="text-muted-fg">From</dt>
                  <dd className="break-all text-fg">{saved.from}</dd>
                  <dt className="text-muted-fg">Verified domains</dt>
                  <dd className="text-fg">
                    {preview.data.verifiedDomains.join(", ")}
                  </dd>
                  <dt className="text-muted-fg">Audience</dt>
                  <dd className="text-fg">
                    {audience?.name ?? saved.audienceId}
                  </dd>
                  <dt className="text-muted-fg">Selection</dt>
                  <dd className="text-fg">
                    {selectedSegments.length > 0
                      ? selectedSegments
                          .map((segment) => segment.name)
                          .join(", ")
                      : "Whole audience"}
                  </dd>
                  <dt className="text-muted-fg">Eligible</dt>
                  <dd className="text-fg">
                    {preview.data.eligibleCount.toLocaleString()} contacts
                  </dd>
                  <dt className="text-muted-fg">Excluded</dt>
                  <dd className="text-fg">
                    {preview.data.excludedCount.toLocaleString()} contacts
                  </dd>
                  <dt className="text-muted-fg">Estimated cost</dt>
                  <dd className="text-fg">
                    {new Intl.NumberFormat("en", {
                      currency: "USD",
                      maximumFractionDigits: 4,
                      minimumFractionDigits: 2,
                      style: "currency",
                    }).format(
                      preview.data.estimatedCostMicroCents / 100_000_000
                    )}
                  </dd>
                </dl>
                {Object.keys(preview.data.exclusions).length ? (
                  <ul className="space-y-1 text-caption text-muted-fg">
                    {Object.entries(preview.data.exclusions).map(
                      ([reason, count]) => (
                        <li key={reason}>
                          {count.toLocaleString()} excluded,{" "}
                          {reason.replaceAll("_", " ")}
                        </li>
                      )
                    )}
                  </ul>
                ) : null}
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="text-body font-medium text-fg">
                    {saved.subject}
                  </p>
                  <p className="max-h-64 overflow-y-auto text-body/6 whitespace-pre-wrap text-fg">
                    {saved.text}
                  </p>
                  <p className="border-t border-border pt-3 text-caption text-muted-fg">
                    Each message includes a personal unsubscribe link.
                  </p>
                </div>
                <p className="text-caption/5 text-muted-fg">
                  Contacts who unsubscribe or become blocked before delivery are
                  excluded. Sending continues on the server when you leave this
                  page.
                </p>
                <label
                  className="flex items-start gap-2 text-body"
                  htmlFor="campaign-send-confirmation"
                >
                  <Checkbox
                    checked={confirmed}
                    id="campaign-send-confirmation"
                    disabled={send.isPending}
                    onCheckedChange={setConfirmed}
                  >
                    <CheckboxIndicator />
                  </Checkbox>
                  I reviewed this message and want to send it to{" "}
                  {preview.data.eligibleCount.toLocaleString()} eligible
                  contacts.
                </label>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter className="shrink-0">
            <DialogCloseButton disabled={send.isPending}>
              Back to draft
            </DialogCloseButton>
            <Button
              disabled={
                !confirmed ||
                send.isPending ||
                (preview.data?.eligibleCount ?? 0) === 0
              }
              onClick={() => {
                send.mutate();
              }}
              size="sm"
            >
              {send.isPending
                ? "Starting…"
                : `Send to ${preview.data?.eligibleCount.toLocaleString() ?? 0} contacts`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) {
            blocker.reset?.();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes have not been saved. Stay here to save this draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              onClick={() => blocker.reset?.()}
              size="sm"
              variant="outline"
            >
              Keep editing
            </Button>
            <Button
              onClick={() => blocker.proceed?.()}
              size="sm"
              variant="destructive"
            >
              Discard changes and leave
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
