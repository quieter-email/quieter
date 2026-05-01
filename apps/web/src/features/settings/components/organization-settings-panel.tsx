"use client";

import type { ReactNode } from "react";
import {
  Delete02Icon,
  Edit01Icon,
  Loading03Icon,
  Logout03Icon,
  UserAdd01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  TooltipGroup,
  TooltipTrigger,
} from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { getErrorMessage, unwrapResultError } from "~/lib/errors";

type OrganizationSummary = NonNullable<
  ReturnType<typeof authClient.useListOrganizations>["data"]
>[number];
type OrganizationMember = {
  id: string;
  role: string;
  user: {
    email: string;
    name: string;
  };
  userId: string;
};
type OrganizationInvitation = {
  email: string;
  id: string;
  role: string;
  status: string;
};
type FullOrganization = OrganizationSummary & {
  invitations: OrganizationInvitation[];
  members: OrganizationMember[];
};
type OrganizationPermissionCheck = Parameters<
  typeof authClient.organization.checkRolePermission
>[0];
type OrganizationPermissions = OrganizationPermissionCheck["permissions"];
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
const getFullOrganizationQueryKey = (organizationId: string) =>
  ["auth", "organization", organizationId, "full"] as const;

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
const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

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

  return dateFormatter.format(date);
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

const loadFullOrganization = async (organizationId: string): Promise<FullOrganization | null> => {
  const result = unwrapResultError(
    await authClient.organization.getFullOrganization({
      query: {
        membersLimit: 100,
        organizationId,
      },
    }),
    "Could not load team.",
  );

  return (result.data as FullOrganization | null) ?? null;
};

const fullOrganizationQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: () => loadFullOrganization(organizationId),
    queryKey: getFullOrganizationQueryKey(organizationId),
  });

const SettingsRow = ({
  action,
  label,
  value,
}: {
  action: ReactNode;
  label: string;
  value: ReactNode;
}) => (
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

const OrganizationFormDialog = ({ organization }: { organization?: OrganizationSummary }) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const isEditing = !!organization;
  const defaultValues = {
    name: organization?.name ?? "",
    slug: organization?.slug ?? "",
  };
  const errorMessage = isEditing ? "Could not update team." : "Could not create team.";
  const organizationMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) =>
      organization
        ? unwrapResultError(
            await authClient.organization.update({
              data: input,
              organizationId: organization.id,
            }),
            errorMessage,
          )
        : unwrapResultError(
            await authClient.organization.create({
              ...input,
              keepCurrentActiveOrganization: true,
            }),
            errorMessage,
          ),
    mutationKey: ["auth", "organization", isEditing ? "update" : "create"],
    onSuccess: async () => {
      if (organization) {
        await queryClient.invalidateQueries({
          queryKey: getFullOrganizationQueryKey(organization.id),
        });
      }
    },
  });
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      const nextSlug = slugifyOrganizationName(value.slug || value.name);
      if (nextSlug.length === 0) {
        setSubmitError("Slug cannot be empty.");
        return;
      }

      try {
        await organizationMutation.mutateAsync({
          name: value.name.trim(),
          slug: nextSlug,
        });
        setOpen(false);
        resetDialog();
      } catch (mutationError) {
        setSubmitError(getErrorMessage(mutationError, errorMessage));
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
  const resetDialog = () => {
    setSubmitError(null);
    form.reset(defaultValues);
  };
  const title = isEditing ? "Edit team" : "Create team";
  const submitLabel = isEditing ? "Save" : "Create";

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
        variant={isEditing ? "outline" : "default"}
      >
        <HugeiconsIcon
          aria-hidden
          className="size-4"
          icon={isEditing ? Edit01Icon : UserGroupIcon}
        />
        {isEditing ? "Edit" : "Create"}
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetDialog();
        }}
        open={open}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <form.Field name="name">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="Team name"
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

              <form.Field name="slug">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="team-slug"
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

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={organizationMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button disabled={organizationMutation.isPending} size="sm" type="submit">
                {organizationMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                )}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const InviteMemberForm = ({
  canInviteMembers,
  organization,
}: {
  canInviteMembers: boolean;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inviteMemberMutation = useMutation({
    mutationFn: async (input: { email: string; role: OrganizationRoleOption }) =>
      unwrapResultError(
        await authClient.organization.inviteMember({
          email: input.email,
          organizationId: organization.id,
          role: input.role,
        }),
        "Could not invite member.",
      ),
    mutationKey: ["auth", "organization", organization.id, "invite-member"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organization.id),
      });
    },
  });
  const form = useForm({
    defaultValues: {
      email: "",
      role: "member" as OrganizationRoleOption,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        await inviteMemberMutation.mutateAsync({
          email: value.email.trim(),
          role: value.role,
        });
        form.reset();
      } catch (mutationError) {
        setSubmitError(getErrorMessage(mutationError, "Could not invite member."));
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z.string().trim().email("Enter a valid email."),
        role: z.enum(organizationRoleOptions),
      }),
    },
  });

  if (!canInviteMembers) {
    return null;
  }

  return (
    <form
      className="flex flex-col gap-2 md:flex-row"
      action={async () => {
        await form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => (
          <TextField className="min-w-0 flex-1">
            <TextFieldInput
              aria-invalid={field.state.meta.errors.length > 0}
              name={field.name}
              onBlur={() => field.handleBlur()}
              onChange={(event) => {
                setSubmitError(null);
                field.handleChange(event.target.value);
              }}
              placeholder="member@example.com"
              value={field.state.value}
            />
          </TextField>
        )}
      </form.Field>

      <form.Field name="role">
        {(field) => (
          <Select
            items={organizationRoleSelectItems}
            modal={false}
            onValueChange={(value) => {
              if (value) {
                field.handleChange(normalizeOrganizationRole(value));
              }
            }}
            value={field.state.value}
          >
            <SelectTrigger className="w-32">
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

      <Button disabled={inviteMemberMutation.isPending} size="sm" type="submit">
        {inviteMemberMutation.isPending ? (
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        ) : (
          <HugeiconsIcon aria-hidden className="size-4" icon={UserAdd01Icon} />
        )}
        Invite
      </Button>

      {submitError && <p className="text-sm text-destructive md:basis-full">{submitError}</p>}
    </form>
  );
};

const TeamMembers = ({
  activeMember,
  canRemoveMembers,
  canUpdateMemberRole,
  members,
  organizationId,
}: {
  activeMember: OrganizationMember | null;
  canRemoveMembers: boolean;
  canUpdateMemberRole: boolean;
  members: OrganizationMember[];
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) =>
      unwrapResultError(
        await authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId,
        }),
        "Could not remove member.",
      ),
    mutationKey: ["auth", "organization", organizationId, "remove-member"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organizationId),
      });
    },
  });
  const updateMemberRoleMutation = useMutation({
    mutationFn: async (input: { memberId: string; role: OrganizationRoleOption }) =>
      unwrapResultError(
        await authClient.organization.updateMemberRole({
          memberId: input.memberId,
          organizationId,
          role: input.role,
        }),
        "Could not update role.",
      ),
    mutationKey: ["auth", "organization", organizationId, "update-member-role"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organizationId),
      });
    },
  });

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

  const handleUpdateRole = async (memberId: string, role: OrganizationRoleOption) => {
    setError(null);

    try {
      setPendingMemberId(memberId);
      await updateMemberRoleMutation.mutateAsync({ memberId, role });
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not update role."));
    } finally {
      setPendingMemberId(null);
    }
  };

  return (
    <div className="divide-y divide-border/70">
      {[...members]
        .sort((left, right) => {
          const isLeftActive = left.userId === activeMember?.userId;
          const isRightActive = right.userId === activeMember?.userId;
          if (isLeftActive) return -1;
          if (isRightActive) return 1;
          return left.user.email.localeCompare(right.user.email);
        })
        .map((member) => {
          const currentRole = normalizeOrganizationRole(member.role);
          const isActiveMember = member.userId === activeMember?.userId;
          const isPending =
            pendingMemberId === member.id &&
            (removeMemberMutation.isPending || updateMemberRoleMutation.isPending);

          return (
            <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center" key={member.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{member.user.name}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{member.user.email}</p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {canUpdateMemberRole && !isActiveMember ? (
                  <Select
                    items={organizationRoleSelectItems}
                    modal={false}
                    onValueChange={(value) => {
                      if (value) {
                        void handleUpdateRole(member.id, normalizeOrganizationRole(value));
                      }
                    }}
                    value={currentRole}
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
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {formatRoleLabel(member.role)}
                    {isActiveMember ? " / You" : ""}
                  </p>
                )}

                {canRemoveMembers && !isActiveMember && (
                  <Button
                    disabled={isPending}
                    onClick={() => void handleRemoveMember(member.id)}
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
                      <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                    )}
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}

      {error && <p className="py-3 text-sm text-destructive">{error}</p>}
    </div>
  );
};

const PendingTeamInvitations = ({
  canCancelInvitations,
  invitations,
  organizationId,
}: {
  canCancelInvitations: boolean;
  invitations: FullOrganization["invitations"];
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) =>
      unwrapResultError(
        await authClient.organization.cancelInvitation({ invitationId }),
        "Could not cancel invitation.",
      ),
    mutationKey: ["auth", "organization", organizationId, "cancel-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organizationId),
      });
    },
  });
  const pendingInvitations = invitations
    .filter((invitation) => invitation.status === "pending")
    .sort((left, right) => left.email.localeCompare(right.email));

  if (pendingInvitations.length === 0) {
    return null;
  }

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

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
        Pending
      </p>

      <div className="divide-y divide-border/70">
        {pendingInvitations.map((invitation) => {
          const isPending =
            pendingInvitationId === invitation.id && cancelInvitationMutation.isPending;

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

              {canCancelInvitations && (
                <Button
                  disabled={isPending}
                  onClick={() => void handleCancelInvitation(invitation.id)}
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
                    <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                  )}
                  Cancel
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};

const ManagePeopleDialog = ({
  activeMember,
  canCancelInvitations,
  canInviteMembers,
  canRemoveMembers,
  canUpdateMemberRole,
  organization,
}: {
  activeMember: OrganizationMember | null;
  canCancelInvitations: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canUpdateMemberRole: boolean;
  organization: FullOrganization;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={UserGroupIcon} />
        Manage
      </Button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>People</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-6">
            <InviteMemberForm canInviteMembers={canInviteMembers} organization={organization} />

            <TeamMembers
              activeMember={activeMember}
              canRemoveMembers={canRemoveMembers}
              canUpdateMemberRole={canUpdateMemberRole}
              members={organization.members}
              organizationId={organization.id}
            />

            <PendingTeamInvitations
              canCancelInvitations={canCancelInvitations}
              invitations={organization.invitations}
              organizationId={organization.id}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
};

const LeaveOrganizationDialog = ({ organization }: { organization: FullOrganization }) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const leaveOrganizationMutation = useMutation({
    mutationFn: async () =>
      unwrapResultError(
        await authClient.organization.leave({
          organizationId: organization.id,
        }),
        "Could not leave team.",
      ),
    mutationKey: ["auth", "organization", organization.id, "leave"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organization.id),
      });
    },
  });
  const form = useForm({
    defaultValues: {
      confirmation: "",
    },
    onSubmit: async () => {
      setSubmitError(null);

      try {
        await leaveOrganizationMutation.mutateAsync();
        setOpen(false);
        resetDialog();
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
  const resetDialog = () => {
    setSubmitError(null);
    form.reset({ confirmation: "" });
  };

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
        variant="outline"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />
        Leave
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetDialog();
        }}
        open={open}
      >
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
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="leave team"
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

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
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

const DeleteOrganizationDialog = ({ organization }: { organization: FullOrganization }) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const deleteOrganizationMutation = useMutation({
    mutationFn: async () =>
      unwrapResultError(
        await authClient.organization.delete({
          organizationId: organization.id,
        }),
        "Could not delete team.",
      ),
    mutationKey: ["auth", "organization", organization.id, "delete"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organization.id),
      });
    },
  });
  const form = useForm({
    defaultValues: {
      confirmation: "",
    },
    onSubmit: async () => {
      setSubmitError(null);

      try {
        await deleteOrganizationMutation.mutateAsync();
        setOpen(false);
        resetDialog();
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
  const resetDialog = () => {
    setSubmitError(null);
    form.reset({ confirmation: "" });
  };

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
        variant="destructive"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
        Delete
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetDialog();
        }}
        open={open}
      >
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
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="delete team"
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

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
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
    userInvitationsQueryOptions(userId, !!sessionState.data?.user.email),
  );
  const acceptInvitationMutation = useMutation({
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
  const rejectInvitationMutation = useMutation({
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
        const isPending =
          pendingInvitationId === invitation.id &&
          (acceptInvitationMutation.isPending || rejectInvitationMutation.isPending);

        return (
          <SettingsRow
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={isPending}
                  onClick={() => void handleInvitationAction(invitation, "accept")}
                  size="sm"
                >
                  {isPending && acceptInvitationMutation.isPending && (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  )}
                  Accept
                </Button>

                <Button
                  disabled={isPending}
                  onClick={() => void handleInvitationAction(invitation, "reject")}
                  size="sm"
                  variant="outline"
                >
                  {isPending && rejectInvitationMutation.isPending && (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  )}
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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};

const TeamSection = ({
  organization,
  userId,
}: {
  organization: OrganizationSummary;
  userId: string;
}) => {
  const fullOrganizationQuery = useQuery(fullOrganizationQueryOptions(organization.id));
  const fullOrganization = fullOrganizationQuery.data;
  const activeMember = fullOrganization?.members.find((member) => member.userId === userId) ?? null;
  const activeRole = activeMember && normalizeOrganizationRole(activeMember.role);
  const pendingInvitations =
    fullOrganization?.invitations.filter((invitation) => invitation.status === "pending") ?? [];
  const ownerCount =
    fullOrganization?.members.filter((member) => hasOrganizationRole(member.role, "owner"))
      .length ?? 0;
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
    (fullOrganization &&
      !canUpdateOrganization &&
      "Only admins and owners can edit team details.") ||
    null;
  const leaveOrganizationReason =
    (fullOrganization &&
      activeRole === "owner" &&
      ownerCount <= 1 &&
      "Assign another owner before leaving.") ||
    null;
  const deleteOrganizationReason =
    (fullOrganization && !canDeleteOrganization && "Only owners can delete teams.") || null;
  const peopleSummary =
    fullOrganization &&
    [
      formatCount(fullOrganization.members.length, "member"),
      pendingInvitations.length > 0 && formatCount(pendingInvitations.length, "pending invitation"),
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <section className="border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{organization.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{organization.slug}</p>
        </div>

        {updateOrganizationReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />}
            label="Edit"
            reason={updateOrganizationReason}
          />
        ) : (
          <OrganizationFormDialog organization={organization} />
        )}
      </div>

      {fullOrganizationQuery.isPending ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading team...
        </div>
      ) : fullOrganizationQuery.isError ? (
        <p className="mt-4 text-sm text-destructive">
          {getErrorMessage(fullOrganizationQuery.error, "Could not load team.")}
        </p>
      ) : fullOrganization ? (
        <div className="mt-2">
          <SettingsRow
            action={
              <ManagePeopleDialog
                activeMember={activeMember}
                canCancelInvitations={canCancelInvitations}
                canInviteMembers={canInviteMembers}
                canRemoveMembers={canRemoveMembers}
                canUpdateMemberRole={canUpdateMemberRole}
                organization={fullOrganization}
              />
            }
            label="People"
            value={peopleSummary ?? formatCount(fullOrganization.members.length, "member")}
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
                <LeaveOrganizationDialog organization={fullOrganization} />
              )
            }
            label="Membership"
            value={activeRole ? formatRoleLabel(activeRole) : "Team member"}
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
                <DeleteOrganizationDialog organization={fullOrganization} />
              )
            }
            label="Delete team"
            value="Permanent"
          />
        </div>
      ) : null}
    </section>
  );
};

export const OrganizationSettingsPanel = () => {
  const sessionState = authClient.useSession();
  const organizationsState = authClient.useListOrganizations();
  const organizations = organizationsState.data ?? [];
  const userId = sessionState.data?.user.id ?? "";

  return (
    <TooltipGroup>
      <div className="space-y-6">
        <div className="flex justify-end">
          <OrganizationFormDialog />
        </div>

        <PendingInvitationsSection />

        {organizationsState.isPending || sessionState.isPending ? (
          <p className="text-sm text-muted-foreground">Loading teams...</p>
        ) : organizations.length > 0 ? (
          <div className="space-y-6">
            {organizations.map((organization) => (
              <TeamSection key={organization.id} organization={organization} userId={userId} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        )}
      </div>
    </TooltipGroup>
  );
};
