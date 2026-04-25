"use client";

import type { ReactNode } from "react";
import {
  Delete02Icon,
  Edit01Icon,
  Loading03Icon,
  Logout03Icon,
  Mail01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toWorkspaceId } from "@quieter/auth/workspace";
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
  TextField,
  TextFieldInput,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { getErrorMessage, getFieldErrorMessage, unwrapResultError } from "~/lib/errors";

type ActiveOrganization = NonNullable<ReturnType<typeof authClient.useActiveOrganization>["data"]>;
type ActiveMember = NonNullable<ReturnType<typeof authClient.useActiveMember>["data"]>;
type OrganizationPermissionCheck = Parameters<
  typeof authClient.organization.checkRolePermission
>[0];
type OrganizationPermissions = OrganizationPermissionCheck["permissions"];
type OrganizationSummary = NonNullable<
  ReturnType<typeof authClient.useListOrganizations>["data"]
>[number];
type OrganizationMember = ActiveOrganization["members"][number];
type UserInvitation = {
  createdAt: Date | string;
  email: string;
  expiresAt: Date | string;
  id: string;
  inviterId: string;
  organizationId: string;
  organizationName: string;
  role: string;
  status: string;
  teamId?: string | null;
};

const organizationRoleOptions = ["owner", "admin", "member"] as const;
const getUserInvitationsQueryKey = (userId: string) =>
  ["auth", userId, "organization", "list-user-invitations"] as const;

type SettingsRowProps = {
  action: ReactNode;
  label: string;
  value: ReactNode;
};

type OrganizationRoleOption = (typeof organizationRoleOptions)[number];

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? `1 ${singular}` : `${count} ${plural}`;

const splitOrganizationRoles = (value: string) =>
  value.split(",").flatMap((part) => {
    const role = part.trim().toLowerCase();
    return role ? [role] : [];
  });

const formatRoleLabel = (value: string) =>
  splitOrganizationRoles(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(", ");

const hasOrganizationRole = (value: string, role: OrganizationRoleOption) =>
  splitOrganizationRoles(value).includes(role);

const organizationRoleSelectItems = organizationRoleOptions.map((role) => ({
  label: formatRoleLabel(role),
  value: role,
}));

const normalizeOrganizationRole = (value: string): OrganizationRoleOption => {
  const primaryRole = splitOrganizationRoles(value).find((part): part is OrganizationRoleOption =>
    organizationRoleOptions.includes(part as OrganizationRoleOption),
  );

  return primaryRole ?? "member";
};

const slugifyOrganizationName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const formatDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
};

const hasOrganizationPermission = (
  role: OrganizationPermissionCheck["role"] | null,
  permissions: OrganizationPermissions,
) => (role ? authClient.organization.checkRolePermission({ permissions, role }) : false);

const isUserInvitation = (value: unknown): value is UserInvitation =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "organizationName" in value &&
  typeof value.organizationName === "string" &&
  "role" in value &&
  typeof value.role === "string" &&
  "expiresAt" in value;

const normalizeUserInvitations = (value: unknown): UserInvitation[] => {
  if (Array.isArray(value)) {
    return value.filter(isUserInvitation);
  }

  if (typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)) {
    return value.data.filter(isUserInvitation);
  }

  return [];
};

const loadUserInvitations = async (): Promise<UserInvitation[]> =>
  normalizeUserInvitations(
    unwrapResultError(
      await authClient.organization.listUserInvitations(),
      "Could not load invitations.",
    ),
  );

const userInvitationsQueryOptions = (userId: string, enabled = true) =>
  queryOptions({
    enabled,
    queryFn: loadUserInvitations,
    queryKey: getUserInvitationsQueryKey(userId),
  });

const SettingsRow = ({ action, label, value }: SettingsRowProps) => (
  <div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 py-5 last:border-b-0 md:flex-row md:items-center">
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 text-sm text-muted-foreground">{value}</div>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);

const MutedActionButton = ({
  buttonClassName,
  icon,
  label,
  reason,
}: {
  buttonClassName?: string;
  icon: ReactNode;
  label: string;
  reason: string;
}) => (
  <Tooltip>
    <TooltipTrigger
      className="inline-flex focus-visible:outline-none"
      render={<span tabIndex={0} />}
    >
      <Button
        className={
          buttonClassName ??
          "pointer-events-none border-border/60 bg-transparent text-muted-foreground opacity-100 hover:bg-transparent hover:text-muted-foreground"
        }
        disabled
        size="sm"
        variant="outline"
      >
        {icon}
        {label}
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      {reason}
      <TooltipArrow />
    </TooltipContent>
  </Tooltip>
);

const CreateOrganizationDialog = () => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const createOrganizationMutationOptions = mutationOptions({
    mutationFn: async (input: { name: string; slug: string }) =>
      unwrapResultError(await authClient.organization.create(input), "Could not create team."),
    mutationKey: ["auth", "organization", "create"],
  });
  const createOrganizationMutation = useMutation(createOrganizationMutationOptions);
  const form = useForm({
    defaultValues: {
      name: "",
      slug: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      const nextSlug = slugifyOrganizationName(value.slug || value.name);
      if (nextSlug.length === 0) {
        setSubmitError("Slug cannot be empty.");
        return;
      }

      try {
        await createOrganizationMutation.mutateAsync({
          name: value.name.trim(),
          slug: nextSlug,
        });
        handleOpenChange(false);
      } catch (mutationError) {
        setSubmitError(getErrorMessage(mutationError, "Could not create team."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        name: z.string().trim().min(1, "Name cannot be empty."),
        slug: z
          .string()
          .trim()
          .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens."),
      }),
    },
  });

  const openDialog = () => {
    setSubmitError(null);
    form.reset({
      name: "",
      slug: "",
    });
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSubmitError(null);
      form.reset({
        name: "",
        slug: "",
      });
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Create
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <form.Field name="name">
                {(field) => {
                  const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                  return (
                    <TextField>
                      <TextFieldInput
                        aria-invalid={fieldError ? true : undefined}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="Team name"
                        value={field.state.value}
                      />
                      {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
                    </TextField>
                  );
                }}
              </form.Field>

              <form.Field name="slug">
                {(field) => {
                  const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                  return (
                    <TextField>
                      <TextFieldInput
                        aria-invalid={fieldError ? true : undefined}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="team-slug"
                        value={field.state.value}
                      />
                      {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
                    </TextField>
                  );
                }}
              </form.Field>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={createOrganizationMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button disabled={createOrganizationMutation.isPending} size="sm" type="submit">
                {createOrganizationMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                )}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const EditOrganizationDialog = ({
  activeOrganization,
}: {
  activeOrganization: ActiveOrganization;
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const updateOrganizationMutationOptions = mutationOptions({
    mutationFn: async (input: { name: string; slug: string }) =>
      unwrapResultError(
        await authClient.organization.update({
          data: input,
          organizationId: activeOrganization.id,
        }),
        "Could not update team.",
      ),
    mutationKey: ["auth", "organization", "update"],
  });
  const updateOrganizationMutation = useMutation(updateOrganizationMutationOptions);
  const form = useForm({
    defaultValues: {
      name: activeOrganization.name,
      slug: activeOrganization.slug,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      const nextSlug = slugifyOrganizationName(value.slug || value.name);
      if (nextSlug.length === 0) {
        setSubmitError("Slug cannot be empty.");
        return;
      }

      try {
        await updateOrganizationMutation.mutateAsync({
          name: value.name.trim(),
          slug: nextSlug,
        });
        handleOpenChange(false);
      } catch (mutationError) {
        setSubmitError(getErrorMessage(mutationError, "Could not update team."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        name: z.string().trim().min(1, "Name cannot be empty."),
        slug: z
          .string()
          .trim()
          .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens."),
      }),
    },
  });

  const openDialog = () => {
    setSubmitError(null);
    form.reset({
      name: activeOrganization.name,
      slug: activeOrganization.slug,
    });
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSubmitError(null);
      form.reset({
        name: activeOrganization.name,
        slug: activeOrganization.slug,
      });
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Edit
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit team</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <form.Field name="name">
                {(field) => {
                  const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                  return (
                    <TextField>
                      <TextFieldInput
                        aria-invalid={fieldError ? true : undefined}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        value={field.state.value}
                      />
                      {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
                    </TextField>
                  );
                }}
              </form.Field>

              <form.Field name="slug">
                {(field) => {
                  const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                  return (
                    <TextField>
                      <TextFieldInput
                        aria-invalid={fieldError ? true : undefined}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        value={field.state.value}
                      />
                      {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
                    </TextField>
                  );
                }}
              </form.Field>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={updateOrganizationMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button disabled={updateOrganizationMutation.isPending} size="sm" type="submit">
                {updateOrganizationMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ManagePeopleMemberRoleForm = ({
  activeMember,
  canRemoveMembers,
  canUpdateMemberRole,
  member,
  onRemoveMember,
  onUpdateRole,
  pendingMemberId,
  removeMemberPending,
  updateMemberRolePending,
}: {
  activeMember: ActiveMember | null;
  canRemoveMembers: boolean;
  canUpdateMemberRole: boolean;
  member: OrganizationMember;
  onRemoveMember: (memberId: string) => Promise<void>;
  onUpdateRole: (memberId: string, role: OrganizationRoleOption) => Promise<void>;
  pendingMemberId: string | null;
  removeMemberPending: boolean;
  updateMemberRolePending: boolean;
}) => {
  const currentRole = normalizeOrganizationRole(member.role);
  const isActiveMember = member.userId === activeMember?.userId;
  const isSavingRole = pendingMemberId === member.id && updateMemberRolePending;
  const isRemovingMember = pendingMemberId === member.id && removeMemberPending;
  const form = useForm({
    defaultValues: {
      role: currentRole,
    },
    onSubmit: async ({ value }) => {
      await onUpdateRole(member.id, value.role);
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        role: z.enum(organizationRoleOptions),
      }),
    },
  });

  return (
    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{member.user.name}</p>
        <p className="mt-1 truncate text-sm text-muted-foreground">{member.user.email}</p>
      </div>

      {canUpdateMemberRole && !isActiveMember ? (
        <form
          className="flex flex-wrap items-center justify-end gap-2"
          action={async () => {
            await form.handleSubmit();
          }}
        >
          <form.Field name="role">
            {(field) => (
              <Select
                items={organizationRoleSelectItems}
                modal={false}
                onValueChange={(value) => {
                  if (value) {
                    field.handleChange(normalizeOrganizationRole(value));
                    field.handleBlur();
                  }
                }}
                value={field.state.value}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent positionerClassName="z-[60]">
                  <SelectList>
                    {organizationRoleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {formatRoleLabel(role)}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            )}
          </form.Field>

          <form.Subscribe<OrganizationRoleOption> selector={(state) => state.values.role}>
            {(role) => (
              <Button
                disabled={role === currentRole || isSavingRole || isRemovingMember}
                size="sm"
                type="submit"
                variant="outline"
              >
                {isSavingRole ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                )}
                Save
              </Button>
            )}
          </form.Subscribe>

          {canRemoveMembers ? (
            <Button
              disabled={isSavingRole || isRemovingMember}
              onClick={() => void onRemoveMember(member.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              {isRemovingMember ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
              )}
              Remove
            </Button>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="text-sm text-muted-foreground">
            {formatRoleLabel(member.role)}
            {isActiveMember ? " / You" : ""}
          </p>

          {canRemoveMembers && !isActiveMember ? (
            <Button
              disabled={isRemovingMember}
              onClick={() => void onRemoveMember(member.id)}
              size="sm"
              variant="outline"
            >
              {isRemovingMember ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
              )}
              Remove
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
};

const ManagePeoplePendingInvitations = ({
  canCancelInvitations,
  isCancelInvitationPending,
  onCancelInvitation,
  pendingInvitationId,
  pendingInvitations,
}: {
  canCancelInvitations: boolean;
  isCancelInvitationPending: boolean;
  onCancelInvitation: (invitationId: string) => Promise<void>;
  pendingInvitationId: string | null;
  pendingInvitations: ActiveOrganization["invitations"];
}) => {
  if (pendingInvitations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
        Pending
      </p>

      <div className="divide-y divide-border/70">
        {pendingInvitations.map((invitation) => {
          const isCancelingInvitation =
            pendingInvitationId === invitation.id && isCancelInvitationPending;

          return (
            <div
              className="flex flex-col gap-3 py-3 md:flex-row md:items-center"
              key={invitation.id}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{invitation.email}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatRoleLabel(invitation.role)}
                </p>
              </div>

              {canCancelInvitations ? (
                <Button
                  disabled={isCancelingInvitation}
                  onClick={() => void onCancelInvitation(invitation.id)}
                  size="sm"
                  variant="outline"
                >
                  {isCancelingInvitation ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                  )}
                  Cancel
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ManagePeopleMembersSection = ({
  activeMember,
  canRemoveMembers,
  canUpdateMemberRole,
  members,
  onRemoveMember,
  onUpdateRole,
  pendingMemberId,
  removeMemberPending,
  updateMemberRolePending,
}: {
  activeMember: ActiveMember | null;
  canRemoveMembers: boolean;
  canUpdateMemberRole: boolean;
  members: OrganizationMember[];
  onRemoveMember: (memberId: string) => Promise<void>;
  onUpdateRole: (memberId: string, role: OrganizationRoleOption) => Promise<void>;
  pendingMemberId: string | null;
  removeMemberPending: boolean;
  updateMemberRolePending: boolean;
}) => (
  <div className="space-y-3">
    <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">Members</p>

    <div className="divide-y divide-border/70">
      {members.map((member) => (
        <ManagePeopleMemberRoleForm
          activeMember={activeMember}
          canRemoveMembers={canRemoveMembers}
          canUpdateMemberRole={canUpdateMemberRole}
          key={`${member.id}:${member.role}`}
          member={member}
          onRemoveMember={onRemoveMember}
          onUpdateRole={onUpdateRole}
          pendingMemberId={pendingMemberId}
          removeMemberPending={removeMemberPending}
          updateMemberRolePending={updateMemberRolePending}
        />
      ))}
    </div>
  </div>
);

const ManagePeopleDialog = ({
  activeMember,
  activeOrganization,
  canCancelInvitations,
  canInviteMembers,
  canRemoveMembers,
  canUpdateMemberRole,
}: {
  activeMember: ActiveMember | null;
  activeOrganization: ActiveOrganization;
  canCancelInvitations: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canUpdateMemberRole: boolean;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const inviteMemberMutationOptions = mutationOptions({
    mutationFn: async (input: { email: string; role: OrganizationRoleOption }) =>
      unwrapResultError(
        await authClient.organization.inviteMember({
          email: input.email,
          organizationId: activeOrganization.id,
          role: input.role,
        }),
        "Could not invite member.",
      ),
    mutationKey: ["auth", "organization", "invite-member"],
  });
  const inviteMemberMutation = useMutation(inviteMemberMutationOptions);
  const cancelInvitationMutationOptions = mutationOptions({
    mutationFn: async (invitationId: string) =>
      unwrapResultError(
        await authClient.organization.cancelInvitation({ invitationId }),
        "Could not cancel invitation.",
      ),
    mutationKey: ["auth", "organization", "cancel-invitation"],
  });
  const cancelInvitationMutation = useMutation(cancelInvitationMutationOptions);
  const removeMemberMutationOptions = mutationOptions({
    mutationFn: async (memberId: string) =>
      unwrapResultError(
        await authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId: activeOrganization.id,
        }),
        "Could not remove member.",
      ),
    mutationKey: ["auth", "organization", "remove-member"],
  });
  const removeMemberMutation = useMutation(removeMemberMutationOptions);
  const updateMemberRoleMutationOptions = mutationOptions({
    mutationFn: async (input: { memberId: string; role: OrganizationRoleOption }) =>
      unwrapResultError(
        await authClient.organization.updateMemberRole({
          memberId: input.memberId,
          organizationId: activeOrganization.id,
          role: input.role,
        }),
        "Could not update member role.",
      ),
    mutationKey: ["auth", "organization", "update-member-role"],
  });
  const updateMemberRoleMutation = useMutation(updateMemberRoleMutationOptions);
  const inviteForm = useForm({
    defaultValues: {
      email: "",
      role: "member" as OrganizationRoleOption,
    },
    onSubmit: async ({ value }) => {
      setError(null);

      try {
        await inviteMemberMutation.mutateAsync({
          email: value.email.trim().toLowerCase(),
          role: value.role,
        });
        inviteForm.reset({
          email: "",
          role: "member",
        });
      } catch (mutationError) {
        setError(getErrorMessage(mutationError, "Could not invite member."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z.string().trim().min(1, "Email is required.").email("Enter a valid email."),
        role: z.enum(organizationRoleOptions),
      }),
    },
  });

  const members = [...activeOrganization.members].sort((left, right) => {
    const isLeftActiveMember = left.userId === activeMember?.userId;
    const isRightActiveMember = right.userId === activeMember?.userId;

    if (isLeftActiveMember && !isRightActiveMember) return -1;
    if (!isLeftActiveMember && isRightActiveMember) return 1;

    return left.user.name.localeCompare(right.user.name);
  });
  const pendingInvitations = [...activeOrganization.invitations]
    .filter((invitation) => invitation.status === "pending")
    .sort((left, right) => left.email.localeCompare(right.email));

  const openDialog = () => {
    setError(null);
    setPendingInvitationId(null);
    setPendingMemberId(null);
    inviteForm.reset({
      email: "",
      role: "member",
    });
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setPendingInvitationId(null);
      setPendingMemberId(null);
      inviteForm.reset({
        email: "",
        role: "member",
      });
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    setError(null);
    try {
      setPendingInvitationId(invitationId);
      await cancelInvitationMutation.mutateAsync(invitationId);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not cancel invitation."));
    } finally {
      setPendingInvitationId(null);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setError(null);
    try {
      setPendingMemberId(memberId);
      await removeMemberMutation.mutateAsync(memberId);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not remove member."));
    } finally {
      setPendingMemberId(null);
    }
  };

  const handleRoleChange = async (memberId: string, role: OrganizationRoleOption) => {
    setError(null);

    try {
      setPendingMemberId(memberId);
      await updateMemberRoleMutation.mutateAsync({
        memberId,
        role,
      });
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not update member role."));
    } finally {
      setPendingMemberId(null);
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={UserGroupIcon} />
        Manage
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent className="w-[min(92vw,42rem)]">
          <DialogHeader>
            <DialogTitle>People</DialogTitle>
          </DialogHeader>

          <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
            {canInviteMembers ? (
              <form
                className="space-y-3"
                action={async () => {
                  await inviteForm.handleSubmit();
                }}
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-start">
                  <inviteForm.Field name="email">
                    {(field) => {
                      const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                      return (
                        <div className="space-y-2">
                          <TextField>
                            <TextFieldInput
                              aria-invalid={fieldError ? true : undefined}
                              name={field.name}
                              onBlur={() => field.handleBlur()}
                              onChange={(event) => {
                                setError(null);
                                field.handleChange(event.target.value);
                              }}
                              placeholder="name@example.com"
                              type="email"
                              value={field.state.value}
                            />
                          </TextField>
                          {fieldError ? (
                            <p className="text-sm text-destructive">{fieldError}</p>
                          ) : null}
                        </div>
                      );
                    }}
                  </inviteForm.Field>

                  <inviteForm.Field name="role">
                    {(field) => (
                      <Select
                        items={organizationRoleSelectItems}
                        modal={false}
                        onValueChange={(value) => {
                          if (value) {
                            setError(null);
                            field.handleChange(normalizeOrganizationRole(value));
                            field.handleBlur();
                          }
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent positionerClassName="z-[60]">
                          <SelectList>
                            {organizationRoleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {formatRoleLabel(role)}
                              </SelectItem>
                            ))}
                          </SelectList>
                        </SelectContent>
                      </Select>
                    )}
                  </inviteForm.Field>

                  <Button disabled={inviteMemberMutation.isPending} size="sm" type="submit">
                    {inviteMemberMutation.isPending ? (
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4 animate-spin"
                        icon={Loading03Icon}
                      />
                    ) : (
                      <HugeiconsIcon aria-hidden className="size-4" icon={Mail01Icon} />
                    )}
                    Invite
                  </Button>
                </div>
              </form>
            ) : null}

            <ManagePeopleMembersSection
              activeMember={activeMember}
              canRemoveMembers={canRemoveMembers}
              canUpdateMemberRole={canUpdateMemberRole}
              members={members}
              onRemoveMember={handleRemoveMember}
              onUpdateRole={handleRoleChange}
              pendingMemberId={pendingMemberId}
              removeMemberPending={removeMemberMutation.isPending}
              updateMemberRolePending={updateMemberRoleMutation.isPending}
            />

            <ManagePeoplePendingInvitations
              canCancelInvitations={canCancelInvitations}
              isCancelInvitationPending={cancelInvitationMutation.isPending}
              onCancelInvitation={handleCancelInvitation}
              pendingInvitationId={pendingInvitationId}
              pendingInvitations={pendingInvitations}
            />

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton>Close</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const LeaveOrganizationDialog = ({
  activeOrganization,
  nextOrganizationId,
}: {
  activeOrganization: ActiveOrganization;
  nextOrganizationId: string | null;
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const leaveOrganizationMutationOptions = mutationOptions({
    mutationFn: async () => {
      await unwrapResultError(
        await authClient.organization.leave({
          organizationId: activeOrganization.id,
        }),
        "Could not leave team.",
      );

      if (nextOrganizationId) {
        await unwrapResultError(
          await authClient.organization.setActive({ organizationId: nextOrganizationId }),
          "Could not switch team.",
        );
      }
    },
    mutationKey: ["auth", "organization", "leave"],
  });
  const leaveOrganizationMutation = useMutation(leaveOrganizationMutationOptions);
  const form = useForm({
    defaultValues: {
      confirmation: "",
    },
    onSubmit: async () => {
      setSubmitError(null);

      try {
        await leaveOrganizationMutation.mutateAsync();
        handleOpenChange(false);
      } catch (mutationError) {
        setSubmitError(getErrorMessage(mutationError, "Could not leave team."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        confirmation: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^leave team$/, 'Type "leave team".'),
      }),
    },
  });

  const openDialog = () => {
    setSubmitError(null);
    form.reset({ confirmation: "" });
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSubmitError(null);
      form.reset({ confirmation: "" });
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />
        Leave
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave team</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-medium text-foreground">leave team</span>
              </p>

              <form.Field name="confirmation">
                {(field) => {
                  const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                  return (
                    <TextField>
                      <TextFieldInput
                        aria-invalid={fieldError ? true : undefined}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="leave team"
                        value={field.state.value}
                      />
                      {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
                    </TextField>
                  );
                }}
              </form.Field>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={leaveOrganizationMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={leaveOrganizationMutation.isPending}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {leaveOrganizationMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />
                )}
                Leave
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const DeleteOrganizationDialog = ({
  activeOrganization,
  nextOrganizationId,
}: {
  activeOrganization: ActiveOrganization;
  nextOrganizationId: string | null;
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const deleteOrganizationMutationOptions = mutationOptions({
    mutationFn: async () => {
      await unwrapResultError(
        await authClient.organization.delete({
          organizationId: activeOrganization.id,
        }),
        "Could not delete team.",
      );

      if (nextOrganizationId) {
        await unwrapResultError(
          await authClient.organization.setActive({ organizationId: nextOrganizationId }),
          "Could not switch team.",
        );
      }
    },
    mutationKey: ["auth", "organization", "delete"],
  });
  const deleteOrganizationMutation = useMutation(deleteOrganizationMutationOptions);
  const form = useForm({
    defaultValues: {
      confirmation: "",
    },
    onSubmit: async () => {
      setSubmitError(null);

      try {
        await deleteOrganizationMutation.mutateAsync();
        handleOpenChange(false);
      } catch (mutationError) {
        setSubmitError(getErrorMessage(mutationError, "Could not delete team."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        confirmation: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^delete team$/, 'Type "delete team".'),
      }),
    },
  });

  const openDialog = () => {
    setSubmitError(null);
    form.reset({ confirmation: "" });
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSubmitError(null);
      form.reset({ confirmation: "" });
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="destructive">
        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
        Delete
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete team</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-medium text-foreground">delete team</span>
              </p>

              <form.Field name="confirmation">
                {(field) => {
                  const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                  return (
                    <TextField>
                      <TextFieldInput
                        aria-invalid={fieldError ? true : undefined}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="delete team"
                        value={field.state.value}
                      />
                      {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
                    </TextField>
                  );
                }}
              </form.Field>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={deleteOrganizationMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={deleteOrganizationMutation.isPending}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {deleteOrganizationMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                )}
                Delete
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const PendingInvitationsSection = () => {
  const sessionState = authClient.useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const userId = sessionState.data?.user.id ?? "";
  const userInvitationsQuery = useQuery(
    userInvitationsQueryOptions(userId, Boolean(sessionState.data?.user.email)),
  );

  const acceptInvitationMutationOptions = mutationOptions({
    mutationFn: async (invitationId: string) =>
      unwrapResultError(
        await authClient.organization.acceptInvitation({ invitationId }),
        "Could not accept invitation.",
      ),
    mutationKey: ["auth", "organization", "accept-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getUserInvitationsQueryKey(userId) });
    },
  });
  const acceptInvitationMutation = useMutation(acceptInvitationMutationOptions);
  const rejectInvitationMutationOptions = mutationOptions({
    mutationFn: async (invitationId: string) =>
      unwrapResultError(
        await authClient.organization.rejectInvitation({ invitationId }),
        "Could not reject invitation.",
      ),
    mutationKey: ["auth", "organization", "reject-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getUserInvitationsQueryKey(userId) });
    },
  });
  const rejectInvitationMutation = useMutation(rejectInvitationMutationOptions);

  const invitations = [...(userInvitationsQuery.data ?? [])].sort((left, right) =>
    left.organizationName.localeCompare(right.organizationName),
  );

  const handleInvitationAction = async (
    invitation: UserInvitation,
    action: "accept" | "reject",
  ) => {
    setError(null);

    try {
      setPendingInvitationId(invitation.id);

      if (action === "accept") {
        await acceptInvitationMutation.mutateAsync(invitation.id);
        return;
      }

      await rejectInvitationMutation.mutateAsync(invitation.id);
    } catch (mutationError) {
      setError(
        getErrorMessage(
          mutationError,
          action === "accept" ? "Could not accept invitation." : "Could not reject invitation.",
        ),
      );
    } finally {
      setPendingInvitationId(null);
    }
  };

  if (userInvitationsQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading invitations...</p>;
  }

  if (userInvitationsQuery.error) {
    return (
      <p className="text-sm text-destructive">
        {getErrorMessage(userInvitationsQuery.error, "Could not load invitations.")}
      </p>
    );
  }

  if (invitations.length === 0) {
    return null;
  }

  return (
    <div>
      {invitations.map((invitation) => {
        const isPendingAction =
          pendingInvitationId === invitation.id &&
          (acceptInvitationMutation.isPending || rejectInvitationMutation.isPending);

        return (
          <SettingsRow
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={isPendingAction}
                  onClick={() => void handleInvitationAction(invitation, "accept")}
                  size="sm"
                >
                  {isPendingAction && acceptInvitationMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : null}
                  Accept
                </Button>

                <Button
                  disabled={isPendingAction}
                  onClick={() => void handleInvitationAction(invitation, "reject")}
                  size="sm"
                  variant="outline"
                >
                  {isPendingAction && rejectInvitationMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : null}
                  Decline
                </Button>
              </div>
            }
            key={invitation.id}
            label={invitation.organizationName}
            value={`${formatRoleLabel(invitation.role)} role / expires ${formatDate(invitation.expiresAt)}`}
          />
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
};

const OrganizationList = ({
  activeWorkspaceId,
  activeRole,
  organizations,
}: {
  activeWorkspaceId: string;
  activeRole: OrganizationRoleOption | null;
  organizations: OrganizationSummary[];
}) => {
  const [error, setError] = useState<string | null>(null);
  const [pendingOrganizationId, setPendingOrganizationId] = useState<string | null>(null);
  const setActiveOrganizationMutationOptions = mutationOptions({
    mutationFn: async (organizationId: string) =>
      unwrapResultError(
        await authClient.organization.setActive({ organizationId }),
        "Could not switch team.",
      ),
    mutationKey: ["auth", "organization", "set-active"],
  });
  const setActiveOrganizationMutation = useMutation(setActiveOrganizationMutationOptions);

  const handleSetActiveOrganization = async (organizationId: string) => {
    if (organizationId === activeWorkspaceId) {
      return;
    }

    setError(null);

    try {
      setPendingOrganizationId(organizationId);
      await setActiveOrganizationMutation.mutateAsync(organizationId);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not switch team."));
    } finally {
      setPendingOrganizationId(null);
    }
  };

  return (
    <div>
      {organizations.map((organization) => {
        const isActive = organization.id === activeWorkspaceId;
        const isPending =
          pendingOrganizationId === organization.id && setActiveOrganizationMutation.isPending;

        return (
          <SettingsRow
            action={
              isActive ? (
                <span className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs font-medium text-foreground">
                  Active
                </span>
              ) : (
                <Button
                  disabled={isPending}
                  onClick={() => void handleSetActiveOrganization(organization.id)}
                  size="sm"
                  variant="outline"
                >
                  {isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon aria-hidden className="size-4" icon={UserGroupIcon} />
                  )}
                  Open team
                </Button>
              )
            }
            key={organization.id}
            label={organization.name}
            value={[
              organization.slug,
              isActive && activeRole ? `${formatRoleLabel(activeRole)} role` : null,
            ]
              .filter(Boolean)
              .join(" / ")}
          />
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
};

export const OrganizationSettingsPanel = () => {
  const activeMemberState = authClient.useActiveMember();
  const activeOrganizationState = authClient.useActiveOrganization();
  const organizationsState = authClient.useListOrganizations();
  const activeMember = activeMemberState.data ?? null;
  const activeOrganization = activeOrganizationState.data ?? null;
  const activeWorkspaceId = toWorkspaceId(activeOrganization?.id);
  const organizations = organizationsState.data ?? [];
  const activeRole = activeMember ? normalizeOrganizationRole(activeMember.role) : null;
  const pendingInvitations =
    activeOrganization?.invitations.filter((invitation) => invitation.status === "pending") ?? [];
  const ownerCount =
    activeOrganization?.members.filter((member) => hasOrganizationRole(member.role, "owner"))
      .length ?? 0;
  const nextOrganizationId =
    organizations.find((organization) => organization.id !== activeOrganization?.id)?.id ?? null;
  const canCancelInvitations = hasOrganizationPermission(activeRole, {
    invitation: ["cancel"],
  });
  const canDeleteOrganization = hasOrganizationPermission(activeRole, {
    organization: ["delete"],
  });
  const canInviteMembers = hasOrganizationPermission(activeRole, {
    invitation: ["create"],
  });
  const canRemoveMembers = hasOrganizationPermission(activeRole, {
    member: ["delete"],
  });
  const canUpdateMemberRole = hasOrganizationPermission(activeRole, {
    member: ["update"],
  });
  const canUpdateOrganization = hasOrganizationPermission(activeRole, {
    organization: ["update"],
  });
  const updateOrganizationReason =
    activeOrganization && !canUpdateOrganization
      ? "Only admins and owners can edit team details."
      : null;
  const leaveOrganizationReason =
    activeOrganization && activeRole === "owner" && ownerCount <= 1
      ? "Assign another owner before leaving."
      : null;
  const deleteOrganizationReason =
    activeOrganization && !canDeleteOrganization ? "Only owners can delete teams." : null;
  const peopleSummary = activeOrganization
    ? [
        formatCount(activeOrganization.members.length, "member"),
        pendingInvitations.length > 0
          ? formatCount(pendingInvitations.length, "pending invitation")
          : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex justify-end">
          <CreateOrganizationDialog />
        </div>

        <PendingInvitationsSection />

        {organizationsState.isPending ? (
          <p className="text-sm text-muted-foreground">Loading teams...</p>
        ) : organizations.length > 0 ? (
          <OrganizationList
            activeWorkspaceId={activeWorkspaceId}
            activeRole={activeRole}
            organizations={organizations}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        )}

        {activeOrganization ? (
          <div>
            <SettingsRow
              action={
                updateOrganizationReason ? (
                  <MutedActionButton
                    icon={<HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />}
                    label="Edit"
                    reason={updateOrganizationReason}
                  />
                ) : (
                  <EditOrganizationDialog activeOrganization={activeOrganization} />
                )
              }
              label="Team"
              value={[activeOrganization.name, activeOrganization.slug].filter(Boolean).join(" / ")}
            />

            <SettingsRow
              action={
                <ManagePeopleDialog
                  activeMember={activeMember}
                  activeOrganization={activeOrganization}
                  canCancelInvitations={canCancelInvitations}
                  canInviteMembers={canInviteMembers}
                  canRemoveMembers={canRemoveMembers}
                  canUpdateMemberRole={canUpdateMemberRole}
                />
              }
              label="People"
              value={peopleSummary ?? formatCount(activeOrganization.members.length, "member")}
            />

            <SettingsRow
              action={
                leaveOrganizationReason ? (
                  <MutedActionButton
                    icon={<HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />}
                    label="Leave"
                    reason={leaveOrganizationReason}
                  />
                ) : (
                  <LeaveOrganizationDialog
                    activeOrganization={activeOrganization}
                    nextOrganizationId={nextOrganizationId}
                  />
                )
              }
              label="Membership"
              value={activeRole ? formatRoleLabel(activeRole) : "Current team"}
            />

            <SettingsRow
              action={
                deleteOrganizationReason ? (
                  <MutedActionButton
                    buttonClassName="pointer-events-none border-destructive/25 bg-destructive/10 text-destructive/80 opacity-100 hover:bg-destructive/10 hover:text-destructive/80"
                    icon={<HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />}
                    label="Delete"
                    reason={deleteOrganizationReason}
                  />
                ) : (
                  <DeleteOrganizationDialog
                    activeOrganization={activeOrganization}
                    nextOrganizationId={nextOrganizationId}
                  />
                )
              }
              label="Delete team"
              value="Permanent"
            />
          </div>
        ) : organizations.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Personal is selected. Team management applies to teams.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Personal is selected. Create a team to manage members and managed mailboxes.
          </p>
        )}
      </div>
    </TooltipProvider>
  );
};
