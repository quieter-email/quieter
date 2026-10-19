import { Add01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createEmailDesign,
  emailContentSchema,
  renderEmailContent,
} from "@quieter/mail/email-design";
import type { EmailContent } from "@quieter/mail/email-design";
import type { EmailTemplate } from "@quieter/mail/templates";
import { Button, LinkButton } from "@quieter/ui/button";
import { EmailPreview } from "@quieter/ui/email-editor";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

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

/* oxlint-disable eslint/no-nested-ternary, unicorn/no-nested-ternary -- Library loading, empty, and result states are exclusive. */
export const TemplatesList = () => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const duplicateKey = useRef<{ key: string; templateId: string } | null>(null);
  const templates = useQuery({
    queryFn: async () =>
      await rpc.templates.list({
        archived,
        limit: 24,
        offset,
        organizationId,
        search,
      }),
    queryKey: ["templates", organizationId, "list", archived, search, offset],
  });
  const duplicate = useMutation({
    mutationFn: async (templateId: string) => {
      if (duplicateKey.current?.templateId !== templateId) {
        duplicateKey.current = { key: crypto.randomUUID(), templateId };
      }
      return await rpc.templates.duplicate({
        idempotencyKey: duplicateKey.current.key,
        organizationId,
        templateId,
      });
    },
    onError: (error) => {
      toastError(error, {
        boundary: "templates",
        fallback: "Could not duplicate template. Please try again.",
      });
    },
    onSuccess: async (template) => {
      duplicateKey.current = null;
      await client.invalidateQueries({
        queryKey: ["templates", organizationId],
      });
      void navigate({
        params: { templateId: template.id },
        search: { organizationId },
        to: "/templates/$templateId",
      });
    },
  });
  const archive = useMutation({
    mutationFn: async (template: EmailTemplate) =>
      await rpc.templates.archive({
        archived: !archived,
        expectedUpdatedAt: template.updatedAt,
        organizationId,
        templateId: template.id,
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "templates",
        fallback: "Could not update template. Please try again.",
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["templates", organizationId],
      });
    },
  });
  return (
    <div className="flex flex-col gap-6">
      <BroadcastHeader
        action={
          canManage ? (
            <LinkButton
              search={{ organizationId }}
              size="sm"
              to="/templates/new"
            >
              <HugeiconsIcon aria-hidden icon={Add01Icon} />
              Create template
            </LinkButton>
          ) : undefined
        }
        title="Templates"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-72">
          <Input
            aria-label="Search templates"
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
            placeholder="Search templates"
            value={search}
          />
        </div>
        <Button
          aria-pressed={archived}
          onClick={() => {
            setArchived(!archived);
            setOffset(0);
          }}
          size="sm"
          variant="ghost"
        >
          {archived ? "Show active" : "Archived"}
        </Button>
      </div>
      {templates.isPending ? (
        <BroadcastLoading label="Loading templates" />
      ) : templates.isError ? (
        <BroadcastError onRetry={() => void templates.refetch()} />
      ) : templates.data.items.length === 0 ? (
        <div className="grid min-h-80 place-content-center gap-3 rounded-xl border border-dashed border-border text-center">
          <p className="text-body text-muted-fg">
            {search
              ? "No matching templates"
              : archived
                ? "No archived templates"
                : "Your first template starts here"}
          </p>
          {canManage && !archived && !search ? (
            <LinkButton
              search={{ organizationId }}
              size="sm"
              to="/templates/new"
              variant="outline"
            >
              Create template
            </LinkButton>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
          {templates.data.items.map((template) => {
            const rendered = renderEmailContent(template.content);
            return (
              <article
                className="overflow-hidden rounded-xl border border-border bg-bg-surface"
                key={template.id}
              >
                <div className="relative h-56 overflow-hidden border-b border-border bg-muted/40">
                  <div aria-hidden inert>
                    <EmailPreview
                      html={rendered.html}
                      text={rendered.text}
                      title={`${template.name} preview`}
                    />
                  </div>
                  <LinkButton
                    aria-label={`Edit ${template.name}`}
                    // oxlint-disable-next-line shadcn/no-restyle -- The preview has a full-card accessible link.
                    className="absolute inset-0 h-full w-full rounded-none opacity-0 focus-visible:opacity-100"
                    params={{ templateId: template.id }}
                    search={{ organizationId }}
                    to="/templates/$templateId"
                    variant="ghost"
                  >
                    <span className="sr-only">Open template</span>
                  </LinkButton>
                </div>
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <LinkButton
                      params={{ templateId: template.id }}
                      search={{ organizationId }}
                      size="sm"
                      to="/templates/$templateId"
                      variant="ghost"
                    >
                      {template.name}
                    </LinkButton>
                    <span className="text-caption text-muted-fg">
                      {template.content.kind === "visual"
                        ? "Design"
                        : template.content.kind === "html"
                          ? "HTML"
                          : "Text"}
                    </span>
                  </div>
                  {canManage ? (
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        disabled={duplicate.isPending}
                        onClick={() => {
                          duplicate.mutate(template.id);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <HugeiconsIcon aria-hidden icon={Copy01Icon} />
                        Duplicate
                      </Button>
                      <Button
                        disabled={archive.isPending}
                        onClick={() => {
                          archive.mutate(template);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        {archived ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {offset > 0 ||
      (templates.data?.nextOffset !== null &&
        templates.data?.nextOffset !== undefined) ? (
        <div className="flex justify-end gap-2">
          <Button
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 24));
            }}
            size="sm"
            variant="ghost"
          >
            Previous
          </Button>
          <Button
            disabled={
              templates.data?.nextOffset === null ||
              templates.data?.nextOffset === undefined
            }
            onClick={() => {
              setOffset(templates.data?.nextOffset ?? offset);
            }}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
};

/* oxlint-enable eslint/no-nested-ternary, unicorn/no-nested-ternary */

export const TemplateEditor = ({ template }: { template?: EmailTemplate }) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [saved, setSaved] = useState(template);
  const [name, setName] = useState(template?.name ?? "Untitled template");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [content, setContent] = useState<EmailContent>(
    () => template?.content ?? { design: createEmailDesign(), kind: "visual" }
  );
  const idempotencyKey = useRef(crypto.randomUUID());
  const dirty =
    !saved ||
    name !== saved.name ||
    subject !== saved.subject ||
    JSON.stringify(content) !== JSON.stringify(saved.content);
  const navigation = useDraftNavigation(dirty);
  const valid =
    name.trim() !== "" && emailContentSchema.safeParse(content).success;
  const save = useMutation({
    mutationFn: async () =>
      saved
        ? await rpc.templates.update({
            content,
            expectedUpdatedAt: saved.updatedAt,
            name,
            organizationId,
            subject,
            templateId: saved.id,
          })
        : await rpc.templates.create({
            content,
            idempotencyKey: idempotencyKey.current,
            name,
            organizationId,
            subject,
          }),
    onError: (error) => {
      toastError(error, {
        boundary: "template-editor",
        fallback: "Could not save template. Please try again.",
      });
    },
    onSuccess: async (result) => {
      setSaved(result);
      setName(result.name);
      setSubject(result.subject);
      setContent(result.content);
      await client.invalidateQueries({
        queryKey: ["templates", organizationId],
      });
      toast.success("Template saved.");
      if (!template) {
        await navigation.leave(async () => {
          await navigate({
            params: { templateId: result.id },
            replace: true,
            search: { organizationId },
            to: "/templates/$templateId",
          });
        });
      }
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <BroadcastHeader
        action={
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="text-caption text-muted-fg">
              {dirty ? "Unsaved" : "Saved"}
              {saved?.archivedAt ? ", archived" : ""}
            </span>
            {canManage ? (
              <Button
                disabled={!dirty || !valid || save.isPending}
                onClick={() => {
                  save.mutate();
                }}
                pending={save.isPending}
                size="sm"
              >
                Save template
              </Button>
            ) : null}
          </div>
        }
        back="templates"
        title={saved?.name ?? "New template"}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="template-name">Name</FieldLabel>
          <Input
            disabled={!canManage || save.isPending}
            id="template-name"
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
            value={name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="template-subject">Subject</FieldLabel>
          <Input
            disabled={!canManage || save.isPending}
            id="template-subject"
            maxLength={998}
            onChange={(event) => {
              setSubject(event.target.value);
            }}
            placeholder="Email subject"
            value={subject}
          />
        </Field>
      </div>
      <EmailContentEditor
        disabled={!canManage || save.isPending}
        onChange={setContent}
        value={content}
      />
      {navigation.dialog}
    </div>
  );
};

export const TemplateDetail = ({ templateId }: { templateId: string }) => {
  const { organizationId } = useBroadcastWorkspace();
  const template = useQuery({
    queryFn: async () =>
      await rpc.templates.get({ organizationId, templateId }),
    queryKey: ["templates", organizationId, templateId],
  });
  if (template.isPending) {
    return <BroadcastLoading label="Loading template" />;
  }
  if (template.isError) {
    return <BroadcastError onRetry={() => void template.refetch()} />;
  }
  return <TemplateEditor key={template.data.id} template={template.data} />;
};
