import { Add01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import {
  emailContentSchema,
  renderEmailContent,
} from "@quieter/mail/email-design";
import type { EmailTemplate } from "@quieter/mail/templates";
import { ActionFooter } from "@quieter/ui/action-footer";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button, LinkButton } from "@quieter/ui/button";
import { EmailPreview } from "@quieter/ui/email-editor";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useReducer, useRef, useState } from "react";

import {
  BroadcastError,
  BroadcastHeader,
  BroadcastLoading,
  useDraftNavigation,
} from "./broadcast-elements";
import { useBroadcastWorkspace } from "./broadcast-workspace";
import { EmailContentEditor } from "./email-content-editor";
import { TemplateCodeSetup } from "./template-code-setup";
import {
  createTemplateEditorDraft,
  templateEditorDraftReducer,
} from "./template-editor-draft";

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
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
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
    <div className="flex flex-col gap-4">
      <BroadcastHeader
        action={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <TemplateCodeSetup organizationId={organizationId} />
              <LinkButton
                search={{ organizationId }}
                size="default"
                to="/templates/new"
              >
                <HugeiconsIcon aria-hidden icon={Add01Icon} />
                Create template
              </LinkButton>
            </div>
          ) : undefined
        }
        controls={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
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
              size="default"
              variant="ghost"
            >
              {archived ? "Show active" : "Archived"}
            </Button>
          </div>
        }
        title="Templates"
      />
      {templates.isPending ? (
        <BroadcastLoading label="Loading templates" />
      ) : templates.isError ? (
        <BroadcastError onRetry={() => void templates.refetch()} />
      ) : templates.data.items.length === 0 ? (
        <div className="grid min-h-80 place-content-center gap-3 p-4 text-center">
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
              size="default"
              to="/templates/new"
              variant="secondary"
            >
              Create template
            </LinkButton>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 2xl:grid-cols-3">
          {templates.data.items.map((template) => {
            const rendered = renderEmailContent(template.content);
            return (
              <article key={template.id}>
                <Surface padding="compact" className="overflow-hidden">
                  <Surface
                    chrome="inset"
                    padding="none"
                    variant="detail"
                    className="relative h-56 overflow-hidden"
                  >
                    <div aria-hidden inert>
                      <EmailPreview
                        html={rendered.html}
                        text={rendered.text}
                        title={`${template.name} preview`}
                      />
                    </div>
                    <Link
                      aria-label={`Edit ${template.name}`}
                      className="absolute inset-0 focus-visible:outline focus-visible:outline-ring"
                      params={{ templateId: template.id }}
                      search={{ organizationId }}
                      to="/templates/$templateId"
                    >
                      <span className="sr-only">Open template</span>
                    </Link>
                  </Surface>
                  <div className="flex flex-col gap-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        className="min-w-0"
                        params={{ templateId: template.id }}
                        search={{ organizationId }}
                        to="/templates/$templateId"
                      >
                        <Text size="body" truncate weight="medium">
                          {template.name}
                        </Text>
                      </Link>
                      <span className="text-caption text-muted-fg">
                        {template.content.kind === "visual"
                          ? "Design"
                          : template.content.kind === "html"
                            ? "HTML"
                            : "Text"}
                      </span>
                    </div>
                    {canManage ? (
                      <ActionFooter>
                        <Button
                          disabled={duplicate.isPending}
                          onClick={() => {
                            duplicate.mutate(template.id);
                          }}
                          size="default"
                          variant="secondary"
                        >
                          <HugeiconsIcon aria-hidden icon={Copy01Icon} />
                          Duplicate
                        </Button>
                        <Button
                          disabled={archive.isPending}
                          onClick={() => {
                            archive.mutate(template);
                          }}
                          size="default"
                          variant="secondary"
                        >
                          {archived ? "Restore" : "Archive"}
                        </Button>
                      </ActionFooter>
                    ) : null}
                  </div>
                </Surface>
              </article>
            );
          })}
        </div>
      )}
      {offset > 0 ||
      (templates.data?.nextOffset !== null &&
        templates.data?.nextOffset !== undefined) ? (
        <div className="flex justify-end gap-2 px-4 pb-4">
          <Button
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 24));
            }}
            size="default"
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
            size="default"
            variant="secondary"
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
  const [draft, dispatch] = useReducer(
    templateEditorDraftReducer,
    template,
    createTemplateEditorDraft
  );
  const { saved, received, name, subject, content } = draft;
  const [reloadOpen, setReloadOpen] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const dirty =
    !saved ||
    name !== saved.name ||
    subject !== saved.subject ||
    JSON.stringify(content) !== JSON.stringify(saved.content);
  const remoteChanged =
    saved !== undefined &&
    received !== undefined &&
    Date.parse(received.updatedAt) > Date.parse(saved.updatedAt);
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
    onMutate: async () => {
      if (saved) {
        await client.cancelQueries({
          queryKey: ["templates", organizationId, saved.id],
        });
      }
    },
    onSuccess: async (result) => {
      const queryKey = ["templates", organizationId, result.id];
      await client.cancelQueries({ queryKey });
      client.setQueryData<EmailTemplate>(queryKey, (previous) =>
        previous &&
        Date.parse(previous.updatedAt) > Date.parse(result.updatedAt)
          ? previous
          : result
      );
      dispatch({ kind: "saved", template: result });
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
  if (
    template &&
    (!received ||
      Date.parse(template.updatedAt) > Date.parse(received.updatedAt))
  ) {
    dispatch({ kind: "received", saving: save.isPending, template });
  }
  return (
    <div className="flex flex-col gap-0.5">
      <BroadcastHeader
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span aria-live="polite" className="text-caption text-muted-fg">
              {dirty ? "Unsaved" : "Saved"}
              {saved?.archivedAt ? ", archived" : ""}
            </span>
            {canManage ? (
              <>
                <TemplateCodeSetup
                  organizationId={organizationId}
                  templateId={saved?.id}
                />
                <Button
                  disabled={!dirty || !valid || save.isPending || remoteChanged}
                  onClick={() => {
                    save.mutate();
                  }}
                  pending={save.isPending}
                  size="default"
                >
                  Save template
                </Button>
              </>
            ) : null}
          </div>
        }
        back="templates"
        title={saved?.name ?? "New template"}
      />
      <div className="flex flex-col gap-4 p-4">
        {remoteChanged ? (
          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <output className="text-body-sm/5 text-muted-fg">
                The saved template changed. Your unsaved edits are kept here.
                Reload the saved version to continue with the latest changes.
              </output>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  setReloadOpen(true);
                }}
                size="default"
                variant="destructive"
              >
                Reload saved version
              </Button>
            </div>
          </Surface>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="template-name">Name</FieldLabel>
            <Input
              disabled={!canManage || save.isPending}
              id="template-name"
              maxLength={200}
              onChange={(event) => {
                dispatch({
                  fields: { name: event.target.value },
                  kind: "edit",
                });
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
                dispatch({
                  fields: { subject: event.target.value },
                  kind: "edit",
                });
              }}
              placeholder="Email subject"
              value={subject}
            />
          </Field>
        </div>
        <EmailContentEditor
          disabled={!canManage || save.isPending}
          onChange={(value) => {
            dispatch({ fields: { content: value }, kind: "edit" });
          }}
          value={content}
        />
      </div>
      <AlertDialog onOpenChange={setReloadOpen} open={reloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved edits?</AlertDialogTitle>
            <AlertDialogDescription>
              Reloading replaces your edits with the latest saved template.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              onClick={() => {
                setReloadOpen(false);
              }}
              variant="secondary"
            >
              Keep editing
            </Button>
            <Button
              onClick={() => {
                if (received) {
                  dispatch({ kind: "reload", template: received });
                }
                setReloadOpen(false);
              }}
              variant="destructive"
            >
              Discard edits and reload
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {navigation.dialog}
    </div>
  );
};

export const TemplateDetail = ({ templateId }: { templateId: string }) => {
  const { organizationId } = useBroadcastWorkspace();
  const template = useQuery({
    queryFn: async ({ signal }) =>
      await rpc.templates.get({ organizationId, templateId }, { signal }),
    queryKey: ["templates", organizationId, templateId],
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });
  if (template.isPending) {
    return <BroadcastLoading label="Loading template" />;
  }
  if (template.data === undefined) {
    return <BroadcastError onRetry={() => void template.refetch()} />;
  }
  return <TemplateEditor key={template.data.id} template={template.data} />;
};
