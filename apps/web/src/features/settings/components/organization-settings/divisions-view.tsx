"use client";

import {
  Add01Icon,
  Delete02Icon,
  Edit01Icon,
  Loading03Icon,
  UserGroupIcon,
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
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
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
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { orpc, rpc } from "~/lib/orpc";
import {
  SettingsBackButton,
  SettingsCard,
  SettingsInsetRows,
  SettingsNavigationRow,
  SettingsRows,
  SettingsSection,
  settingsInsetRowClass,
  settingsRowPaddingClass,
} from "../settings-layout";
import { formatCount, type FullOrganization, type OrganizationMember } from "./domain";
import { SettingsRow } from "./settings-row";

const getOrganizationDivisionsQueryKey = (organizationId: string) =>
  ["organization", organizationId, "divisions"] as const;

const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

type OrganizationDivision = {
  description: string | null;
  id: string;
  mailboxCount: number;
  members: Array<{ memberId: string }>;
  name: string;
};

const CreateDivisionDialog = ({
  onCreated,
  organizationId,
}: {
  onCreated: (divisionId: string) => void;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createMutation = useMutation({
    ...orpc.organization.createDivision.mutationOptions(),
  });
  const form = useForm({
    defaultValues: {
      description: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        const result = await createMutation.mutateAsync({
          description: value.description,
          name: value.name,
          organizationId,
        });
        await queryClient.invalidateQueries({
          queryKey: getOrganizationDivisionsQueryKey(organizationId),
        });
        setOpen(false);
        form.reset();
        onCreated(result.divisionId);
      } catch (error) {
        setSubmitError(getMutationErrorMessage(error, "Could not create division."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        description: z.string(),
        name: z.string().trim().min(1, "Name is required."),
      }),
    },
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
        Add
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSubmitError(null);
            form.reset();
          }
        }}
        open={open}
      >
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Add division</DialogTitle>
            <DialogDescription>
              Group members who should share the same mailbox access.
            </DialogDescription>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-4">
              <form.Field name="name">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-label="Division name"
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="Engineering"
                      value={field.state.value}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p className="text-sm text-destructive" key={error?.message}>
                        {error?.message}
                      </p>
                    ))}
                  </TextField>
                )}
              </form.Field>

              <form.Field name="description">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-label="Division description"
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="Optional description"
                      value={field.state.value}
                    />
                  </TextField>
                )}
              </form.Field>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={createMutation.isPending}>Cancel</DialogCloseButton>
              <Button disabled={createMutation.isPending} size="sm" type="submit">
                {createMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
                )}
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const EditDivisionFieldDialog = ({
  division,
  field,
  organizationId,
}: {
  division: OrganizationDivision;
  field: "name" | "description";
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const label = field === "name" ? "Name" : "Description";
  const currentValue = field === "name" ? division.name : (division.description ?? "");
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const updateMutation = useMutation({
    ...orpc.organization.updateDivision.mutationOptions(),
  });
  const form = useForm({
    defaultValues: { value: currentValue },
    onSubmit: async ({ value: next }) => {
      setSubmitError(null);
      try {
        await updateMutation.mutateAsync(
          field === "name"
            ? { divisionId: division.id, name: next.value }
            : { description: next.value, divisionId: division.id },
        );
        await queryClient.invalidateQueries({
          queryKey: getOrganizationDivisionsQueryKey(organizationId),
        });
        setOpen(false);
      } catch (error) {
        setSubmitError(getMutationErrorMessage(error, "Could not update division."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        value: field === "name" ? z.string().trim().min(1, "Name is required.") : z.string(),
      }),
    },
  });

  return (
    <>
      <Button
        onClick={() => {
          setSubmitError(null);
          form.reset({ value: currentValue });
          setOpen(true);
        }}
        size="sm"
        variant="outline"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Edit
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSubmitError(null);
            form.reset({ value: currentValue });
          }
        }}
        open={open}
      >
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Edit {label.toLowerCase()}</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-4">
              <form.Field name="value">
                {(formField) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={formField.state.meta.errors.length > 0}
                      aria-label={label}
                      name={formField.name}
                      onBlur={() => formField.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        formField.handleChange(event.target.value);
                      }}
                      placeholder={field === "description" ? "Optional description" : undefined}
                      value={formField.state.value}
                    />
                    {formField.state.meta.errors.map((error) => (
                      <p className="text-sm text-destructive" key={error?.message}>
                        {error?.message}
                      </p>
                    ))}
                  </TextField>
                )}
              </form.Field>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={updateMutation.isPending}>Cancel</DialogCloseButton>
              <Button disabled={updateMutation.isPending} size="sm" type="submit">
                {updateMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const DeleteDivisionDialog = ({
  division,
  onDeleted,
  organizationId,
}: {
  division: OrganizationDivision;
  onDeleted: () => void;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const deleteMutation = useMutation({
    ...orpc.organization.deleteDivision.mutationOptions(),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getOrganizationDivisionsQueryKey(organizationId),
      });
      toast.success("Division removed.");
      onDeleted();
    },
    onError: (error) => {
      toast.error(getMutationErrorMessage(error, "Could not delete division."));
    },
  });

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
        Delete
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete division</AlertDialogTitle>
          <AlertDialogDescription>
            Removes {division.name} and its member assignments. Mailbox access granted through this
            division will no longer apply.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogBody>
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
        </AlertDialogBody>

        <AlertDialogFooter>
          <AlertDialogCloseButton disabled={deleteMutation.isPending}>
            Cancel
          </AlertDialogCloseButton>
          <Button
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ divisionId: division.id })}
            size="sm"
            variant="destructive"
          >
            {deleteMutation.isPending ? (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            ) : (
              <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
            )}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const DivisionDetailView = ({
  canManageDivisions,
  division,
  members,
  onBack,
  organization,
}: {
  canManageDivisions: boolean;
  division: OrganizationDivision;
  members: OrganizationMember[];
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const setMembersMutation = useMutation({
    ...orpc.organization.setDivisionMembers.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrganizationDivisionsQueryKey(organization.id),
      });
    },
  });
  const selectedMemberIds = new Set(division.members.map((member) => member.memberId));

  return (
    <div className="space-y-6">
      <SettingsBackButton onClick={onBack}>Divisions</SettingsBackButton>

      <div>
        <h1 className="text-base font-semibold text-foreground">{division.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCount(division.members.length, "Member")},{" "}
          {formatCount(division.mailboxCount, "Mailbox", "Mailboxes")}
        </p>
      </div>

      <SettingsSection>
        <SettingsCard>
          <SettingsRow
            action={
              canManageDivisions ? (
                <EditDivisionFieldDialog
                  division={division}
                  field="name"
                  organizationId={organization.id}
                />
              ) : null
            }
            label="Name"
            value={division.name}
          />
          <SettingsRow
            action={
              canManageDivisions ? (
                <EditDivisionFieldDialog
                  division={division}
                  field="description"
                  organizationId={organization.id}
                />
              ) : null
            }
            label="Description"
            value={division.description?.trim() || "None"}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        description="Members inherit mailbox roles granted to this division."
        title="Members"
      >
        <SettingsCard>
          {members.length > 0 ? (
            <SettingsInsetRows>
              {members.map((memberRecord) => {
                const checked = selectedMemberIds.has(memberRecord.id);
                return (
                  <label
                    className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}
                    key={memberRecord.id}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!canManageDivisions || setMembersMutation.isPending}
                      onCheckedChange={(nextChecked) => {
                        const nextMemberIds = new Set(selectedMemberIds);
                        if (nextChecked === true) {
                          nextMemberIds.add(memberRecord.id);
                        } else {
                          nextMemberIds.delete(memberRecord.id);
                        }
                        setMembersMutation.mutate(
                          {
                            divisionId: division.id,
                            memberIds: [...nextMemberIds],
                          },
                          {
                            onError: (error) =>
                              toast.error(
                                getMutationErrorMessage(error, "Could not update members."),
                              ),
                          },
                        );
                      }}
                    >
                      <CheckboxIndicator />
                    </Checkbox>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {memberRecord.user.name || memberRecord.user.email}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {memberRecord.user.email}
                      </span>
                    </span>
                  </label>
                );
              })}
            </SettingsInsetRows>
          ) : (
            <p className={cn("text-sm text-muted-foreground", settingsRowPaddingClass)}>
              No team members yet.
            </p>
          )}
        </SettingsCard>
      </SettingsSection>

      {canManageDivisions ? (
        <SettingsSection>
          <SettingsCard>
            <SettingsRow
              action={
                <DeleteDivisionDialog
                  division={division}
                  onDeleted={onBack}
                  organizationId={organization.id}
                />
              }
              label="Delete division"
              value="Permanent"
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </div>
  );
};

export const DivisionsView = ({
  canManageDivisions,
  members,
  onBack,
  organization,
}: {
  canManageDivisions: boolean;
  members: OrganizationMember[];
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const {
    data: divisionsData,
    error: divisionsError,
    isError: isDivisionsError,
    isPending: isDivisionsPending,
  } = useQuery({
    queryKey: getOrganizationDivisionsQueryKey(organization.id),
    queryFn: ({ signal }) =>
      rpc.organization.listDivisions({ organizationId: organization.id }, { signal }),
  });
  const divisions = divisionsData?.divisions ?? [];
  const selectedDivision = divisions.find((division) => division.id === selectedDivisionId) ?? null;

  if (selectedDivision) {
    return (
      <DivisionDetailView
        canManageDivisions={canManageDivisions}
        division={selectedDivision}
        key={selectedDivision.id}
        members={members}
        onBack={() => setSelectedDivisionId(null)}
        organization={organization}
      />
    );
  }

  return (
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>{organization.name}</SettingsBackButton>

      <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Divisions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCount(divisions.length, "Division")}
          </p>
        </div>

        {canManageDivisions ? (
          <CreateDivisionDialog
            onCreated={(divisionId) => setSelectedDivisionId(divisionId)}
            organizationId={organization.id}
          />
        ) : null}
      </div>

      {isDivisionsPending ? (
        <div
          className={cn(
            "flex items-center gap-2 text-sm text-muted-foreground",
            settingsRowPaddingClass,
          )}
        >
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading divisions…
        </div>
      ) : isDivisionsError ? (
        <p className={cn("text-sm text-destructive", settingsRowPaddingClass)}>
          {divisionsError?.message ?? "Could not load divisions."}
        </p>
      ) : divisions.length > 0 ? (
        <SettingsRows>
          {divisions.map((division) => (
            <SettingsNavigationRow
              description={`${formatCount(division.members.length, "Member")}, ${formatCount(division.mailboxCount, "Mailbox", "Mailboxes")}`}
              icon={<HugeiconsIcon aria-hidden icon={UserGroupIcon} />}
              key={division.id}
              onClick={() => setSelectedDivisionId(division.id)}
              title={division.name}
            />
          ))}
        </SettingsRows>
      ) : (
        <p className={cn("text-center text-sm text-muted-foreground", settingsRowPaddingClass)}>
          No divisions yet.
        </p>
      )}
    </div>
  );
};
