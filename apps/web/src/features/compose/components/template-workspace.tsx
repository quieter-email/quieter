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
import { Field, FieldControl, FieldLabel } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { ToolbarButton, ToolbarSeparator } from "@quieter/ui/toolbar";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  WorkspaceSection,
  workspaceSectionVariants,
} from "#/components/workspace-section";
import { orpc } from "#/lib/orpc";

import { normalizeComposeBodyHtml } from "../domain/draft";
import {
  ComposeEditor,
  ComposeEditorBody,
  ComposeEditorToolbar,
} from "./compose-editor";
import type { ComposeEditorHandle } from "./compose-editor";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

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
  const queryOptions = orpc.mailTemplates.list.queryOptions({
    input: { mailboxId },
  });
  const templatesQuery = useQuery(queryOptions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<MailTemplateItem | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const templateEditorRef = useRef<ComposeEditorHandle | null>(null);
  const refreshTemplates = async () => {
    await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
  };
  const createMutation = useMutation({
    ...orpc.mailTemplates.create.mutationOptions(),
    onError: (error) => {
      toast.error(error.message || "Could not save the template.");
    },
    onSuccess: async (template) => {
      await refreshTemplates();
      setEditingId(template.id);
      toast.success("Template saved.");
    },
  });
  const updateMutation = useMutation({
    ...orpc.mailTemplates.update.mutationOptions(),
    onError: (error) => {
      toast.error(error.message || "Could not update the template.");
    },
    onSuccess: async () => {
      await refreshTemplates();
      toast.success("Template updated.");
    },
  });
  const templateForm = useForm({
    defaultValues: emptyTemplateFormValues,
    onSubmit: async ({ value }) => {
      if (value.name.trim() === "") {
        toast.error("Give this template a name.");
        return;
      }
      if (!normalizeComposeBodyHtml(value.bodyHtml)) {
        toast.error("Add template content before saving.");
        return;
      }

      if (hasText(editingId)) {
        await updateMutation.mutateAsync({
          ...value,
          id: editingId,
          mailboxId,
          subject: "",
        });
      } else {
        await createMutation.mutateAsync({ ...value, mailboxId, subject: "" });
      }
    },
  });
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
  const deleteMutation = useMutation({
    ...orpc.mailTemplates.delete.mutationOptions(),
    onError: (error) => {
      toast.error(error.message || "Could not delete the template.");
    },
    onSuccess: async () => {
      await refreshTemplates();
      setDeleteTemplate(null);
      setEditingId(null);
      setMobileEditorOpen(false);
      templateForm.reset(emptyTemplateFormValues);
      toast.success("Template deleted.");
    },
  });
  const templates = templatesQuery.data?.templates ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredTemplates = normalizedSearch
    ? templates.filter((template) =>
        template.name.toLowerCase().includes(normalizedSearch)
      )
    : templates;
  const currentTemplate =
    templates.find((template) => template.id === editingId) ?? null;
  const canEditCurrentTemplate = !currentTemplate || currentTemplate.canEdit;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  let templateQueryState: ReactNode = null;
  if (templatesQuery.isPending) {
    templateQueryState = (
      <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-muted-fg">
        <HugeiconsIcon className="size-3.5 animate-spin" icon={Loading03Icon} />
        Loading templates
      </div>
    );
  } else if (templatesQuery.isError) {
    templateQueryState = (
      <p className="px-3 py-10 text-center text-xs/5 text-destructive">
        Could not load templates.
      </p>
    );
  } else if (filteredTemplates.length === 0) {
    const emptyTitle =
      templates.length === 0 ? "No templates yet" : "No matches";
    const emptyDescription =
      templates.length === 0
        ? "Create a reusable message for replies or new email."
        : "Try a different search.";
    templateQueryState = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-medium text-fg">{emptyTitle}</p>
        <p className="mt-1 text-xs/5 text-muted-fg">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <>
      <WorkspaceSection
        className={cn({
          flex: !mobileEditorOpen,
          hidden: mobileEditorOpen,
        })}
        layout="cell"
      >
        <header className="@container p-4 sm:p-5">
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
          <label
            className="relative mt-4 block"
            htmlFor="template-workspace-search"
          >
            <span className="sr-only" id="template-workspace-search-label">
              Search templates
            </span>
            <HugeiconsIcon
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-fg"
              icon={Search01Icon}
            />
            <Input
              aria-labelledby="template-workspace-search-label"
              className="pl-9"
              id="template-workspace-search"
              onChange={(event) => {
                setSearch(event.currentTarget.value);
              }}
              placeholder="Search templates"
              value={search}
            />
          </label>
        </header>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 sm:px-4 sm:pb-5">
          {filteredTemplates.map((template) => (
            <button
              aria-current={editingId === template.id ? "true" : undefined}
              className={cn(
                "group flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                {
                  "bg-muted text-fg": editingId === template.id,
                  "text-muted-fg hover:bg-muted/55 hover:text-fg":
                    editingId !== template.id,
                }
              )}
              key={template.id}
              onClick={() => {
                selectTemplate(template);
              }}
              type="button"
            >
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-fg/30 transition-colors",
                  {
                    "bg-primary": editingId === template.id,
                    "group-hover:bg-muted-fg/60": editingId !== template.id,
                  }
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {template.name}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-fg">
                  <span>{template.scope === "team" ? "Team" : "Personal"}</span>
                </span>
              </span>
            </button>
          ))}
          {templateQueryState}
        </div>
      </WorkspaceSection>

      <form
        className={cn(workspaceSectionVariants({ layout: "cell" }), {
          flex: mobileEditorOpen,
          hidden: !mobileEditorOpen,
        })}
        onSubmit={(event) => {
          event.preventDefault();
          void templateForm.handleSubmit();
        }}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 sm:gap-5 sm:p-5">
          <div className="-mx-4 -mt-4 flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 sm:-mx-5 sm:-mt-5 sm:px-5 lg:hidden">
            <IconButtonTooltip label="Back to templates">
              <Button
                aria-label="Back to templates"
                onClick={() => {
                  setMobileEditorOpen(false);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} />
              </Button>
            </IconButtonTooltip>
            <p className="text-sm font-medium tracking-tight text-fg">
              {hasText(editingId) ? "Edit template" : "New template"}
            </p>
          </div>

          <templateForm.Field name="name">
            {(field) => (
              <Field className="w-full max-w-2xl gap-1">
                <div className="flex items-center gap-3">
                  <FieldLabel className="w-14 shrink-0 text-sm font-normal text-muted-fg">
                    Name
                  </FieldLabel>
                  <FieldControl
                    className="min-w-0 flex-1"
                    disabled={!canEditCurrentTemplate}
                    onBlur={() => {
                      field.handleBlur();
                    }}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    placeholder="Template name"
                    value={field.state.value}
                  />
                </div>
              </Field>
            )}
          </templateForm.Field>

          <templateForm.Field name="bodyHtml">
            {(field) => (
              <Field className="flex min-h-0 flex-1 flex-col gap-2">
                <FieldLabel className="font-normal text-muted-fg">
                  Message
                </FieldLabel>
                <ComposeEditor
                  disabled={!canEditCurrentTemplate}
                  html={field.state.value}
                  key={editingId ?? "new"}
                  onBlur={() => {
                    field.handleBlur();
                  }}
                  onChange={({ html }) => {
                    field.handleChange(html);
                  }}
                  onInlineImageFiles={(files) => {
                    void files;
                  }}
                  ref={templateEditorRef}
                >
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <ComposeEditorBody className="min-h-0 flex-1" />
                    <ComposeEditorToolbar
                      trailing={
                        <>
                          <IconButtonTooltip label="Insert placeholder">
                            <ToolbarButton
                              aria-label="Insert placeholder"
                              className="size-8 px-0"
                              disabled={!canEditCurrentTemplate}
                              onClick={() =>
                                templateEditorRef.current?.insertPlaceholder(
                                  "Placeholder"
                                )
                              }
                              type="button"
                            >
                              <HugeiconsIcon icon={Add01Icon} />
                            </ToolbarButton>
                          </IconButtonTooltip>
                          <templateForm.Field name="scope">
                            {(scopeField) => (
                              <>
                                <ToolbarButton
                                  aria-pressed={
                                    scopeField.state.value === "personal"
                                  }
                                  className={cn({
                                    "bg-bg-surface text-fg shadow-sm":
                                      scopeField.state.value === "personal",
                                  })}
                                  disabled={!canEditCurrentTemplate}
                                  onClick={() => {
                                    scopeField.handleChange("personal");
                                  }}
                                  type="button"
                                >
                                  Personal
                                </ToolbarButton>
                                <ToolbarButton
                                  aria-pressed={
                                    scopeField.state.value === "team"
                                  }
                                  className={cn({
                                    "bg-bg-surface text-fg shadow-sm":
                                      scopeField.state.value === "team",
                                  })}
                                  disabled={
                                    !canEditCurrentTemplate ||
                                    templatesQuery.data
                                      ?.canManageTeamTemplates !== true
                                  }
                                  onClick={() => {
                                    scopeField.handleChange("team");
                                  }}
                                  type="button"
                                >
                                  Team
                                </ToolbarButton>
                              </>
                            )}
                          </templateForm.Field>
                          {hasText(editingId) &&
                          currentTemplate?.canEdit === true ? (
                            <ToolbarButton
                              aria-label="Delete template"
                              onClick={() => {
                                setDeleteTemplate(currentTemplate);
                              }}
                              type="button"
                            >
                              <HugeiconsIcon icon={Delete02Icon} />
                              Delete
                            </ToolbarButton>
                          ) : null}
                          <ToolbarSeparator />
                          {canEditCurrentTemplate ? (
                            <ToolbarButton disabled={isSaving} type="submit">
                              {isSaving ? (
                                <HugeiconsIcon
                                  className="animate-spin"
                                  icon={Loading03Icon}
                                />
                              ) : (
                                <HugeiconsIcon icon={NoteEditIcon} />
                              )}
                              Save
                            </ToolbarButton>
                          ) : (
                            <span className="px-2 text-xs text-muted-fg">
                              Only team admins can edit
                            </span>
                          )}
                        </>
                      }
                    />
                  </div>
                </ComposeEditor>
              </Field>
            )}
          </templateForm.Field>
        </div>
      </form>

      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTemplate(null);
          }
        }}
        open={!!deleteTemplate}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{deleteTemplate?.name}”?
            </AlertDialogTitle>
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
