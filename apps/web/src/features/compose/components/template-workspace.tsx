"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  Loading03Icon,
  NoteEditIcon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { Tooltip, TooltipContent, TooltipGroup, TooltipTrigger } from "@quieter/ui/tooltip";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { WorkspaceSection, workspaceSectionVariants } from "~/components/workspace-section";
import { appEaseInOut, appMotionDuration } from "~/features/motion/app-motion";
import { orpc } from "~/lib/orpc";
import { normalizeComposeBodyHtml } from "../domain/draft";
import {
  ComposeEditor,
  ComposeEditorBody,
  type ComposeEditorHandle,
  ComposeEditorToolbar,
} from "./compose-editor";

type MailTemplateItem = {
  bodyHtml: string;
  canEdit: boolean;
  id: string;
  name: string;
  scope: "personal" | "team";
};

type TemplateFormValues = {
  bodyHtml: string;
  name: string;
  scope: "personal" | "team";
};

const emptyTemplateFormValues: TemplateFormValues = {
  bodyHtml: "",
  name: "",
  scope: "personal",
};

export const TemplateWorkspace = ({
  mailboxId,
  onOpenSidebar,
}: {
  mailboxId: string;
  onOpenSidebar: () => void;
}) => {
  const queryClient = useQueryClient();
  const queryOptions = orpc.mailTemplates.list.queryOptions({ input: { mailboxId } });
  const templatesQuery = useQuery(queryOptions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<MailTemplateItem | null>(null);
  const [search, setSearch] = useState("");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const templateEditorRef = useRef<ComposeEditorHandle | null>(null);
  const templateForm = useForm({
    defaultValues: emptyTemplateFormValues,
    onSubmit: async ({ value }) => {
      if (!value.name.trim()) {
        toast.error("Give this template a name.");
        return;
      }
      if (!normalizeComposeBodyHtml(value.bodyHtml)) {
        toast.error("Add template content before saving.");
        return;
      }

      if (editingId) {
        await updateMutation.mutateAsync({ ...value, id: editingId, mailboxId, subject: "" });
      } else {
        await createMutation.mutateAsync({ ...value, mailboxId, subject: "" });
      }
    },
  });
  const refreshTemplates = async () => {
    await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
  };
  const selectTemplate = (template: MailTemplateItem) => {
    setEditingId(template.id);
    setMobileEditorOpen(true);
    templateForm.reset({
      bodyHtml: template.bodyHtml,
      name: template.name,
      scope: template.scope,
    });
  };
  const startNewTemplate = () => {
    setEditingId(null);
    setMobileEditorOpen(true);
    templateForm.reset(emptyTemplateFormValues);
  };
  const createMutation = useMutation({
    ...orpc.mailTemplates.create.mutationOptions(),
    onSuccess: async (template) => {
      await refreshTemplates();
      setEditingId(template.id);
      toast.success("Template saved.");
    },
    onError: (error) => toast.error(error.message || "Could not save the template."),
  });
  const updateMutation = useMutation({
    ...orpc.mailTemplates.update.mutationOptions(),
    onSuccess: async () => {
      await refreshTemplates();
      toast.success("Template updated.");
    },
    onError: (error) => toast.error(error.message || "Could not update the template."),
  });
  const deleteMutation = useMutation({
    ...orpc.mailTemplates.delete.mutationOptions(),
    onSuccess: async () => {
      await refreshTemplates();
      setDeleteTemplate(null);
      setEditingId(null);
      setMobileEditorOpen(false);
      templateForm.reset(emptyTemplateFormValues);
      toast.success("Template deleted.");
    },
    onError: (error) => toast.error(error.message || "Could not delete the template."),
  });
  const templates = templatesQuery.data?.templates ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredTemplates = normalizedSearch
    ? templates.filter((template) => template.name.toLowerCase().includes(normalizedSearch))
    : templates;
  const currentTemplate = templates.find((template) => template.id === editingId) ?? null;
  const canEditCurrentTemplate = !currentTemplate || currentTemplate.canEdit;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const reducedMotion = useReducedMotion();

  return (
    <>
      <WorkspaceSection
        className={cn("bg-bg", {
          flex: !mobileEditorOpen,
          hidden: mobileEditorOpen,
        })}
        layout="cell"
      >
        <header className="@container p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <IconButtonTooltip label="Open sidebar">
              <Button
                aria-label="Open sidebar"
                className="lg:hidden"
                onClick={onOpenSidebar}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={SidebarLeftIcon} />
              </Button>
            </IconButtonTooltip>
            <h1 className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-fg">
              Templates
            </h1>
            <Button onClick={startNewTemplate} size="sm" type="button">
              <HugeiconsIcon icon={Add01Icon} />
              New
            </Button>
          </div>
          <label className="relative mt-3 block">
            <HugeiconsIcon
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-fg"
              icon={Search01Icon}
            />
            <Input
              aria-label="Search templates"
              className="pl-9"
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search templates"
              value={search}
            />
          </label>
        </header>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5">
          {filteredTemplates.map((template) => (
            <button
              aria-current={editingId === template.id ? "true" : undefined}
              className={cn(
                "group flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                {
                  "bg-muted text-fg": editingId === template.id,
                  "text-muted-fg hover:bg-muted/55 hover:text-fg": editingId !== template.id,
                },
              )}
              key={template.id}
              onClick={() => selectTemplate(template)}
              type="button"
            >
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-fg/30 transition-colors",
                  {
                    "bg-primary": editingId === template.id,
                    "group-hover:bg-muted-fg/60": editingId !== template.id,
                  },
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{template.name}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-fg">
                  <span>{template.scope === "team" ? "Team" : "Personal"}</span>
                </span>
              </span>
            </button>
          ))}
          {templatesQuery.isPending ? (
            <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-muted-fg">
              <HugeiconsIcon className="size-3.5 animate-spin" icon={Loading03Icon} />
              Loading templates
            </div>
          ) : templatesQuery.isError ? (
            <p className="px-3 py-10 text-center text-xs/5 text-destructive">
              Could not load templates.
            </p>
          ) : filteredTemplates.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-fg">
                {templates.length === 0 ? "No templates yet" : "No matches"}
              </p>
              <p className="mt-1 text-xs/5 text-muted-fg">
                {templates.length === 0
                  ? "Create a reusable message for replies or new email."
                  : "Try a different search."}
              </p>
            </div>
          ) : null}
        </div>
      </WorkspaceSection>

      <form
        className={cn(workspaceSectionVariants({ layout: "cell" }), "border-0 bg-bg", {
          flex: mobileEditorOpen,
          hidden: !mobileEditorOpen,
        })}
        onSubmit={(event) => {
          event.preventDefault();
          void templateForm.handleSubmit();
        }}
      >
        <div className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated/60 sm:m-4">
          <header className="flex shrink-0 items-center gap-3 p-3">
            <IconButtonTooltip label="Back to templates">
              <Button
                aria-label="Back to templates"
                className="lg:hidden"
                onClick={() => setMobileEditorOpen(false)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} />
              </Button>
            </IconButtonTooltip>
            <templateForm.Field name="name">
              {(field) => (
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Template name</span>
                  <Input
                    aria-label="Template name"
                    autoFocus={!editingId}
                    chrome="ghost"
                    className="h-auto px-0 py-1 text-sm font-medium tracking-tight"
                    disabled={!canEditCurrentTemplate}
                    onBlur={() => field.handleBlur()}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    placeholder="Template name"
                    value={field.state.value}
                  />
                </label>
              )}
            </templateForm.Field>
          </header>

          <templateForm.Field name="bodyHtml">
            {(field) => (
              <ComposeEditor
                disabled={!canEditCurrentTemplate}
                html={field.state.value}
                key={editingId ?? "new"}
                onBlur={() => field.handleBlur()}
                onChange={({ html }) => field.handleChange(html)}
                onInlineImageFiles={() => {}}
                ref={templateEditorRef}
              >
                <ComposeEditorBody className="mx-2 min-h-0 flex-1 rounded-lg border border-border bg-bg-elevated p-5 sm:p-6" />
                <div className="flex shrink-0 items-center gap-1 p-2">
                  <ComposeEditorToolbar />
                  <IconButtonTooltip label="Insert placeholder">
                    <Button
                      aria-label="Insert placeholder"
                      disabled={!canEditCurrentTemplate}
                      onClick={() => templateEditorRef.current?.insertPlaceholder("Placeholder")}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <HugeiconsIcon icon={Add01Icon} />
                    </Button>
                  </IconButtonTooltip>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <templateForm.Field name="scope">
                      {(field) => (
                        <LayoutGroup id="template-scope">
                          <div
                            aria-label="Template scope"
                            className="squircle mr-1 flex items-center rounded-lg border p-1"
                            role="group"
                          >
                            <TooltipGroup>
                              {(["personal", "team"] as const).map((scope) => {
                                const selected = field.state.value === scope;
                                const disabled =
                                  !canEditCurrentTemplate ||
                                  (scope === "team" &&
                                    !templatesQuery.data?.canManageTeamTemplates);

                                return (
                                  <Tooltip key={scope}>
                                    <TooltipTrigger className="inline-flex" render={<span />}>
                                      <button
                                        aria-pressed={selected}
                                        className={cn(
                                          "relative h-6 rounded-md px-2.5 text-[13px] transition-colors select-none",
                                          {
                                            "text-fg": selected,
                                            "text-muted-fg hover:text-fg": !selected,
                                            "pointer-events-none opacity-50": disabled,
                                          },
                                        )}
                                        disabled={disabled}
                                        onClick={() => field.handleChange(scope)}
                                        type="button"
                                      >
                                        {selected ? (
                                          <motion.span
                                            aria-hidden
                                            className="squircle absolute inset-0 rounded-md border border-border bg-bg-surface shadow-sm"
                                            layoutId="template-scope-indicator"
                                            transition={{
                                              duration: reducedMotion
                                                ? 0
                                                : appMotionDuration.layout,
                                              ease: appEaseInOut,
                                            }}
                                          />
                                        ) : null}
                                        <span className="relative z-10">
                                          {scope === "team" ? "Team" : "Personal"}
                                        </span>
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {scope === "team"
                                        ? "Available to the current team."
                                        : "Available across your account."}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </TooltipGroup>
                          </div>
                        </LayoutGroup>
                      )}
                    </templateForm.Field>
                    {editingId && currentTemplate?.canEdit ? (
                      <Button
                        aria-label="Delete template"
                        onClick={() => setDeleteTemplate(currentTemplate)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon icon={Delete02Icon} />
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    ) : null}
                    {canEditCurrentTemplate ? (
                      <Button disabled={isSaving} size="sm" type="submit">
                        {isSaving ? (
                          <HugeiconsIcon className="animate-spin" icon={Loading03Icon} />
                        ) : (
                          <HugeiconsIcon icon={NoteEditIcon} />
                        )}
                        Save template
                      </Button>
                    ) : (
                      <span className="px-2 text-xs text-muted-fg">Only team admins can edit</span>
                    )}
                  </div>
                </div>
              </ComposeEditor>
            )}
          </templateForm.Field>
        </div>
      </form>

      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTemplate(null);
        }}
        open={!!deleteTemplate}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTemplate?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTemplate?.scope === "team"
                ? "This removes the shared template for everyone on this team."
                : "This removes the template from your saved templates."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody className="text-sm text-muted-fg">
            Messages that already used this template will not change.
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton>Cancel</AlertDialogCloseButton>
            <AlertDialogCloseButton
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTemplate) {
                  deleteMutation.mutate({ id: deleteTemplate.id, mailboxId });
                }
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogCloseButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
