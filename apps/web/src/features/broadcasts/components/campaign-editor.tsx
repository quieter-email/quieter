import type { Campaign } from "@quieter/mail/campaigns";
import {
  createEmailDesign,
  emailContentSchema,
} from "@quieter/mail/email-design";
import { Button, LinkButton } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { EmailPreview } from "@quieter/ui/email-editor";
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
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { resolveMailDomainVerified } from "#/features/settings/components/organization-settings/mail-domains";
import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import {
  BroadcastError,
  BroadcastHeader,
  BroadcastLoading,
  useDraftNavigation,
} from "./broadcast-elements";
import { useBroadcastWorkspace } from "./broadcast-workspace";
import { EmailContentEditor } from "./email-content-editor";

export type CampaignStep = "content" | "audience" | "review";

/* oxlint-disable eslint/no-nested-ternary, unicorn/no-nested-ternary -- Campaign steps and page states have exclusive branches. */
const CampaignSteps = ({
  campaign,
  step,
}: {
  campaign: Campaign;
  step: CampaignStep;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  return (
    <nav
      aria-label="Campaign steps"
      className="flex items-center gap-2 border-b border-border pb-3"
    >
      {(["content", "audience", "review"] as const).map((item, index) => (
        <LinkButton
          aria-current={step === item ? "step" : undefined}
          key={item}
          params={{ campaignId: campaign.id }}
          search={{ organizationId }}
          size="sm"
          to={
            item === "content"
              ? "/campaigns/$campaignId/content"
              : item === "audience"
                ? "/campaigns/$campaignId/audience"
                : "/campaigns/$campaignId/review"
          }
          variant={step === item ? "secondary" : "ghost"}
        >
          <span className="text-caption text-muted-fg">{index + 1}</span>
          {item === "content"
            ? "Content"
            : item === "audience"
              ? "Audience"
              : "Review"}
        </LinkButton>
      ))}
    </nav>
  );
};

export const CampaignCreate = () => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const navigation = useDraftNavigation(name !== "" || audienceId !== "");
  const audiences = useQuery({
    queryFn: async () =>
      await rpc.audiences.list({ limit: 100, organizationId }),
    queryKey: ["audiences", organizationId, "campaign-picker"],
  });
  const create = useMutation({
    mutationFn: async () =>
      await rpc.campaigns.create({
        audienceId,
        content: { design: createEmailDesign(), kind: "visual" },
        from: "",
        name,
        organizationId,
        segmentIds: [],
        subject: "",
        text: "",
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "campaign-create",
        fallback: "Could not create campaign. Please try again.",
      });
    },
    onSuccess: async (campaign) => {
      await client.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
      await navigation.leave(async () => {
        await navigate({
          params: { campaignId: campaign.id },
          replace: true,
          search: { organizationId },
          to: "/campaigns/$campaignId/content",
        });
      });
    },
  });
  return (
    <div className="flex flex-col gap-8">
      <BroadcastHeader back="campaigns" title="New campaign" />
      <form
        className="mx-auto flex w-full max-w-160 flex-col gap-6 py-8 md:py-14"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Field>
          <FieldLabel htmlFor="new-campaign-name">Campaign name</FieldLabel>
          <Input
            id="new-campaign-name"
            disabled={!canManage || create.isPending}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="October newsletter"
            required
            value={name}
          />
        </Field>
        <Field>
          <FieldLabel>Audience</FieldLabel>
          <Select
            disabled={!canManage || create.isPending}
            items={
              audiences.data?.items.map((audience) => ({
                label: audience.name,
                value: audience.id,
              })) ?? []
            }
            onValueChange={(value) => {
              setAudienceId(value ?? "");
            }}
            value={audienceId}
          >
            <SelectTrigger
              aria-label="Campaign audience"
              pending={audiences.isPending}
            >
              <SelectValue placeholder="Choose an audience" />
            </SelectTrigger>
            <SelectContent>
              <SelectList>
                {audiences.data?.items.map((audience) => (
                  <SelectItem key={audience.id} value={audience.id}>
                    {audience.name}
                  </SelectItem>
                ))}
              </SelectList>
            </SelectContent>
          </Select>
        </Field>
        {audiences.isError ? (
          <BroadcastError onRetry={() => void audiences.refetch()} />
        ) : audiences.data?.items.length === 0 ? (
          <LinkButton
            search={{ organizationId }}
            size="sm"
            to="/audiences"
            variant="outline"
          >
            Create an audience
          </LinkButton>
        ) : null}
        <div className="flex justify-end">
          <Button
            disabled={
              !canManage || !name.trim() || !audienceId || create.isPending
            }
            pending={create.isPending}
            size="sm"
            type="submit"
          >
            Create draft
          </Button>
        </div>
      </form>
      {navigation.dialog}
    </div>
  );
};

export const CampaignEditor = ({
  campaign,
  step = "content",
}: {
  campaign: Campaign;
  step?: "content" | "audience";
}) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(campaign);
  const [draft, setDraft] = useState({
    audienceId: campaign.audienceId,
    content: campaign.content,
    from: campaign.from,
    name: campaign.name,
    segmentIds: campaign.segmentIds,
    subject: campaign.subject,
    text: campaign.text,
  });
  const [templateId, setTemplateId] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const dirty =
    draft.name !== saved.name ||
    draft.audienceId !== saved.audienceId ||
    draft.from !== saved.from ||
    draft.subject !== saved.subject ||
    JSON.stringify(draft.content) !== JSON.stringify(saved.content) ||
    draft.segmentIds.join("\n") !== saved.segmentIds.join("\n");
  const navigation = useDraftNavigation(dirty);
  const audiences = useQuery({
    enabled: step === "audience",
    queryFn: async () =>
      await rpc.audiences.list({ limit: 100, organizationId }),
    queryKey: ["audiences", organizationId, "campaign-picker"],
  });
  const segments = useQuery({
    enabled: step === "audience" && !!draft.audienceId,
    queryFn: async () =>
      await rpc.audiences.listSegments({
        audienceId: draft.audienceId,
        organizationId,
      }),
    queryKey: ["audiences", organizationId, draft.audienceId, "segments"],
  });
  const domains = useQuery({
    enabled: step === "content",
    queryFn: async () => await rpc.mailDomains.list({ organizationId }),
    queryKey: ["mail-domains", organizationId],
  });
  const templates = useQuery({
    enabled: step === "content",
    queryFn: async () =>
      await rpc.templates.list({ limit: 100, organizationId }),
    queryKey: ["templates", organizationId, "campaign-picker"],
  });
  const save = useMutation({
    mutationFn: async (_next: "stay" | "audience" | "review") =>
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
    onSuccess: async (data, next) => {
      setSaved(data);
      setDraft({
        audienceId: data.audienceId,
        content: data.content,
        from: data.from,
        name: data.name,
        segmentIds: data.segmentIds,
        subject: data.subject,
        text: data.text,
      });
      await queryClient.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
      if (next === "stay") {
        toast.success("Draft saved.");
      } else {
        await navigation.leave(async () => {
          await navigate({
            params: { campaignId: campaign.id },
            search: { organizationId },
            to:
              next === "audience"
                ? "/campaigns/$campaignId/audience"
                : "/campaigns/$campaignId/review",
          });
        });
      }
    },
  });
  const validContent = emailContentSchema.safeParse(draft.content).success;
  const ready =
    validContent && draft.subject.trim() !== "" && draft.from.includes("@");
  const next = step === "content" ? "audience" : "review";
  const selectedTemplate = templates.data?.items.find(
    (template) => template.id === templateId
  );
  return (
    <div className="flex flex-col gap-5">
      <BroadcastHeader
        action={
          <div className="flex items-center gap-2">
            <span
              aria-live="polite"
              className="mr-2 text-caption text-muted-fg"
            >
              {dirty ? "Unsaved" : "Saved"}
            </span>
            {canManage ? (
              <>
                <Button
                  disabled={
                    !dirty ||
                    save.isPending ||
                    !validContent ||
                    !draft.name.trim()
                  }
                  onClick={() => {
                    save.mutate("stay");
                  }}
                  pending={save.isPending && save.variables === "stay"}
                  size="sm"
                  variant="outline"
                >
                  Save draft
                </Button>
                <Button
                  disabled={save.isPending || !ready || !draft.audienceId}
                  onClick={() => {
                    if (dirty) {
                      save.mutate(next);
                    } else {
                      void navigate({
                        params: { campaignId: campaign.id },
                        search: { organizationId },
                        to:
                          next === "audience"
                            ? "/campaigns/$campaignId/audience"
                            : "/campaigns/$campaignId/review",
                      });
                    }
                  }}
                  pending={save.isPending && save.variables !== "stay"}
                  size="sm"
                >
                  {step === "content" ? "Continue" : "Review send"}
                </Button>
              </>
            ) : null}
          </div>
        }
        back="campaigns"
        title={saved.name}
      />
      <CampaignSteps campaign={saved} step={step} />
      {step === "content" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="campaign-name">Name</FieldLabel>
              <Input
                id="campaign-name"
                disabled={!canManage || save.isPending}
                maxLength={200}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                }}
                value={draft.name}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="campaign-from">From</FieldLabel>
              <Input
                id="campaign-from"
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
            <Field>
              <FieldLabel htmlFor="campaign-subject">Subject</FieldLabel>
              <Input
                id="campaign-subject"
                disabled={!canManage || save.isPending}
                maxLength={998}
                onChange={(event) => {
                  setDraft({ ...draft, subject: event.target.value });
                }}
                value={draft.subject}
              />
            </Field>
          </div>
          {domains.isError ? (
            <BroadcastError onRetry={() => void domains.refetch()} />
          ) : domains.data?.domains.filter(resolveMailDomainVerified).length ===
            0 ? (
            <p className="text-caption text-muted-fg">
              Verify a sending domain in team settings before sending.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Select
                disabled={!canManage || save.isPending}
                items={
                  templates.data?.items.map((template) => ({
                    label: template.name,
                    value: template.id,
                  })) ?? []
                }
                onValueChange={(value) => {
                  setTemplateId(value ?? "");
                }}
                value={templateId}
              >
                <SelectTrigger
                  aria-label="Choose a template"
                  pending={templates.isPending}
                >
                  <SelectValue placeholder="Start from a template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    {templates.data?.items.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!selectedTemplate || !canManage || save.isPending}
              onClick={() => {
                if (selectedTemplate) {
                  setDraft({
                    ...draft,
                    content: structuredClone(selectedTemplate.content),
                    subject: selectedTemplate.subject || draft.subject,
                  });
                  setEditorKey(editorKey + 1);
                }
              }}
              size="sm"
              variant="ghost"
            >
              Use template
            </Button>
            {templates.isError ? (
              <Button
                onClick={() => void templates.refetch()}
                size="sm"
                variant="ghost"
              >
                Retry templates
              </Button>
            ) : null}
          </div>
          <EmailContentEditor
            disabled={!canManage || save.isPending}
            key={editorKey}
            onChange={(content) => {
              setDraft({ ...draft, content });
            }}
            value={draft.content}
          />
        </>
      ) : (
        <div className="mx-auto flex w-full max-w-180 flex-col gap-6 py-6">
          <Field>
            <FieldLabel>Audience</FieldLabel>
            <Select
              disabled={!canManage || save.isPending}
              items={
                audiences.data?.items.map((audience) => ({
                  label: audience.name,
                  value: audience.id,
                })) ?? []
              }
              onValueChange={(value) => {
                if (value) {
                  setDraft({ ...draft, audienceId: value, segmentIds: [] });
                }
              }}
              value={draft.audienceId}
            >
              <SelectTrigger
                aria-label="Audience"
                pending={audiences.isPending}
              >
                <SelectValue placeholder="Choose an audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectList>
                  {audiences.data?.items.map((audience) => (
                    <SelectItem key={audience.id} value={audience.id}>
                      {audience.name}
                    </SelectItem>
                  ))}
                </SelectList>
              </SelectContent>
            </Select>
          </Field>
          {audiences.isError ? (
            <BroadcastError onRetry={() => void audiences.refetch()} />
          ) : null}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-body font-medium">Recipients</legend>
            <label
              className="flex items-center gap-3 rounded-lg border border-border p-4 text-body"
              htmlFor="campaign-whole-audience"
            >
              <Checkbox
                checked={draft.segmentIds.length === 0}
                disabled={!canManage || save.isPending}
                id="campaign-whole-audience"
                onCheckedChange={(checked) => {
                  if (checked) {
                    setDraft({ ...draft, segmentIds: [] });
                  }
                }}
              >
                <CheckboxIndicator />
              </Checkbox>
              Whole audience
            </label>
            {segments.data?.map((segment) => (
              <label
                className="flex items-center gap-3 rounded-lg border border-border p-4 text-body"
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
                        : draft.segmentIds.filter((id) => id !== segment.id),
                    });
                  }}
                >
                  <CheckboxIndicator />
                </Checkbox>
                {segment.name}
              </label>
            ))}
          </fieldset>
          {segments.isError ? (
            <BroadcastError onRetry={() => void segments.refetch()} />
          ) : null}
          {draft.segmentIds.length > 1 ? (
            <p className="text-caption text-muted-fg">
              Contacts matching any selected segment.
            </p>
          ) : null}
        </div>
      )}
      {navigation.dialog}
    </div>
  );
};

const CampaignReview = ({ campaign }: { campaign: Campaign }) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirmedToken, setConfirmedToken] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const preview = useQuery({
    queryFn: async () => {
      try {
        return await rpc.campaigns.preview({
          campaignId: campaign.id,
          organizationId,
        });
      } catch (error) {
        toastError(error, {
          boundary: "campaign-review",
          fallback: "Could not review campaign. Please try again.",
        });
        throw error;
      }
    },
    queryKey: [
      "campaign-review",
      organizationId,
      campaign.id,
      campaign.updatedAt,
    ],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });
  const audience = useQuery({
    queryFn: async () =>
      await rpc.audiences.get({
        audienceId: campaign.audienceId,
        organizationId,
      }),
    queryKey: ["audiences", organizationId, campaign.audienceId],
  });
  const segments = useQuery({
    enabled: campaign.segmentIds.length > 0,
    queryFn: async () =>
      await rpc.audiences.listSegments({
        audienceId: campaign.audienceId,
        organizationId,
      }),
    queryKey: ["audiences", organizationId, campaign.audienceId, "segments"],
  });
  const targetingReady =
    audience.isSuccess &&
    (campaign.segmentIds.length === 0 ||
      (segments.isSuccess &&
        campaign.segmentIds.every((id) =>
          segments.data.some((segment) => segment.id === id)
        )));
  const send = useMutation({
    mutationFn: async () => {
      if (
        !preview.data ||
        !targetingReady ||
        confirmedToken !== preview.data.previewToken ||
        preview.data.eligibleCount === 0
      ) {
        throw new Error("Review the campaign before sending.");
      }
      return await rpc.campaigns.send({
        campaignId: campaign.id,
        confirmed: true,
        expectedUpdatedAt: campaign.updatedAt,
        idempotencyKey,
        organizationId,
        previewToken: preview.data.previewToken,
      });
    },
    onError: (error) => {
      setConfirmedToken(null);
      toastError(error, {
        boundary: "campaign-send",
        fallback: "Could not start campaign. Please try again.",
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
      void navigate({
        params: { campaignId: campaign.id },
        search: { organizationId },
        to: "/campaigns/$campaignId",
      });
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <BroadcastHeader
        action={
          <Button
            disabled={preview.isFetching || send.isPending}
            onClick={() => {
              setConfirmedToken(null);
              setIdempotencyKey(crypto.randomUUID());
              void preview.refetch();
            }}
            size="sm"
            variant="outline"
          >
            Refresh review
          </Button>
        }
        back="campaigns"
        title={campaign.name}
      />
      <CampaignSteps campaign={campaign} step="review" />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-body font-medium">
                {campaign.subject}
              </p>
              <p className="mt-1 text-caption text-muted-fg">
                From {campaign.from}
              </p>
            </div>
            <Button
              aria-pressed={device === "mobile"}
              onClick={() => {
                setDevice(device === "mobile" ? "desktop" : "mobile");
              }}
              size="sm"
              variant="ghost"
            >
              {device === "mobile" ? "Desktop" : "Mobile"}
            </Button>
          </div>
          <EmailPreview
            device={device}
            html={campaign.html}
            text={campaign.text}
          />
        </div>
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-bg-surface p-5">
          <div>
            <h2 className="text-body font-medium">
              {audience.data?.name ?? "Loading audience"}
            </h2>
            <p className="mt-1 text-caption text-muted-fg">
              {campaign.segmentIds.length
                ? segments.data
                    ?.filter((segment) =>
                      campaign.segmentIds.includes(segment.id)
                    )
                    .map((segment) => segment.name)
                    .join(", ")
                : "Whole audience"}
            </p>
          </div>
          {audience.isError || segments.isError ? (
            <BroadcastError
              onRetry={() => {
                void audience.refetch();
                if (campaign.segmentIds.length > 0) {
                  void segments.refetch();
                }
              }}
            />
          ) : null}
          {preview.isPending ? (
            <BroadcastLoading label="Reviewing recipients" />
          ) : preview.isError ? (
            <BroadcastError onRetry={() => void preview.refetch()} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-body">
                <dt className="text-muted-fg">Recipients</dt>
                <dd className="text-right font-medium">
                  {preview.data.eligibleCount.toLocaleString()}
                </dd>
                <dt className="text-muted-fg">Excluded</dt>
                <dd className="text-right">
                  {preview.data.excludedCount.toLocaleString()}
                </dd>
                <dt className="text-muted-fg">Estimated cost</dt>
                <dd className="text-right">
                  {new Intl.NumberFormat("en", {
                    currency: "USD",
                    maximumFractionDigits: 4,
                    minimumFractionDigits: 2,
                    style: "currency",
                  }).format(preview.data.estimatedCostMicroCents / 100_000_000)}
                </dd>
              </dl>
              {Object.keys(preview.data.exclusions).length ? (
                <ul className="flex flex-col gap-1 text-caption text-muted-fg">
                  {Object.entries(preview.data.exclusions).map(
                    ([reason, count]) => (
                      <li key={reason}>
                        {count.toLocaleString()} {reason.replaceAll("_", " ")}
                      </li>
                    )
                  )}
                </ul>
              ) : null}
              <p className="border-t border-border pt-4 text-caption/5 text-muted-fg">
                Each email includes an unsubscribe link.
              </p>
              {canManage ? (
                <>
                  <label
                    className="flex items-start gap-2 text-body/5"
                    htmlFor="campaign-send-confirmation"
                  >
                    <Checkbox
                      checked={confirmedToken === preview.data.previewToken}
                      disabled={
                        send.isPending ||
                        !targetingReady ||
                        preview.isFetching ||
                        preview.data.eligibleCount === 0
                      }
                      id="campaign-send-confirmation"
                      onCheckedChange={(checked) => {
                        setConfirmedToken(
                          checked ? preview.data.previewToken : null
                        );
                      }}
                    >
                      <CheckboxIndicator />
                    </Checkbox>
                    I reviewed this email and its recipients.
                  </label>
                  <Button
                    disabled={
                      send.isPending ||
                      !targetingReady ||
                      preview.isFetching ||
                      confirmedToken !== preview.data.previewToken ||
                      preview.data.eligibleCount === 0
                    }
                    onClick={() => {
                      send.mutate();
                    }}
                    pending={send.isPending}
                    size="sm"
                  >
                    Send to {preview.data.eligibleCount.toLocaleString()}{" "}
                    contacts
                  </Button>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const CampaignPage = ({
  campaignId,
  step,
}: {
  campaignId: string;
  step: CampaignStep;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  const campaign = useQuery({
    queryFn: async () =>
      await rpc.campaigns.get({ campaignId, organizationId }),
    queryKey: ["campaigns", organizationId, campaignId, "draft"],
  });
  if (campaign.isPending) {
    return <BroadcastLoading label="Loading campaign" />;
  }
  if (campaign.isError) {
    return <BroadcastError onRetry={() => void campaign.refetch()} />;
  }
  if (campaign.data.campaign.status !== "draft") {
    return (
      <div className="flex flex-col gap-5">
        <BroadcastHeader back="campaigns" title={campaign.data.campaign.name} />
        <LinkButton
          params={{ campaignId }}
          search={{ organizationId }}
          size="sm"
          to="/campaigns/$campaignId"
        >
          View delivery report
        </LinkButton>
      </div>
    );
  }
  return step === "review" ? (
    <CampaignReview
      campaign={campaign.data.campaign}
      key={`${campaignId}-${campaign.data.campaign.updatedAt}`}
    />
  ) : (
    <CampaignEditor
      campaign={campaign.data.campaign}
      key={`${campaignId}-${step}`}
      step={step}
    />
  );
};
