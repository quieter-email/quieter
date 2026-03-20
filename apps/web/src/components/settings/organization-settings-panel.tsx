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
} from "@quietr/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import { getErrorMessage, unwrapResultError } from "~/lib/errors";

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

type SettingsRowProps = {
  action: ReactNode;
  label: string;
  value: ReactNode;
};

const organizationRoleOptions = ["owner", "admin", "member"] as const;

type OrganizationRoleOption = (typeof organizationRoleOptions)[number];

const formatCount = (count: number, singular: string, plural = `${singular}s`) => {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
};

const formatRoleLabel = (value: string) => {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(", ");
};

const organizationRoleSelectItems = organizationRoleOptions.map((role) => ({
  label: formatRoleLabel(role),
  value: role,
}));

const normalizeOrganizationRole = (value: string): OrganizationRoleOption => {
  const primaryRole = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .find((part): part is OrganizationRoleOption =>
      organizationRoleOptions.includes(part as OrganizationRoleOption),
    );

  return primaryRole ?? "member";
};

const slugifyOrganizationName = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const hasOrganizationPermission = (
  role: OrganizationPermissionCheck["role"] | null,
  permissions: OrganizationPermissions,
) => {
  return role ? authClient.organization.checkRolePermission({ permissions, role }) : false;
};

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
  icon,
  label,
  reason,
}: {
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
        className="pointer-events-none border-border/60 bg-transparent text-muted-foreground opacity-100 hover:bg-transparent hover:text-muted-foreground"
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
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const createOrganizationMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) =>
      unwrapResultError(
        await authClient.organization.create(input),
        "Could not create organization.",
      ),
    mutationKey: ["auth", "organization", "create"],
  });

  const openDialog = () => {
    setError(null);
    setName("");
    setSlug("");
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setName("");
      setSlug("");
    }
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const nextSlug = slugifyOrganizationName(slug.trim() || trimmedName);

    if (trimmedName.length === 0) {
      setError("Name cannot be empty.");
      return;
    }

    if (nextSlug.length === 0) {
      setError("Slug cannot be empty.");
      return;
    }

    try {
      await createOrganizationMutation.mutateAsync({
        name: trimmedName,
        slug: nextSlug,
      });
      handleOpenChange(false);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not create organization."));
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
            <DialogTitle>Create organization</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreate}>
            <DialogBody className="space-y-3">
              <TextField>
                <TextFieldInput
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Organization name"
                  value={name}
                />
              </TextField>

              <TextField>
                <TextFieldInput
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="organization-slug"
                  value={slug}
                />
              </TextField>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
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

const SwitchOrganizationDialog = ({
  activeOrganizationId,
  organizations,
}: {
  activeOrganizationId: string | null;
  organizations: OrganizationSummary[];
}) => {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    activeOrganizationId ?? organizations[0]?.id ?? "",
  );
  const organizationSelectItems = organizations.map((organization) => ({
    label: organization.name,
    value: organization.id,
  }));
  const setActiveOrganizationMutation = useMutation({
    mutationFn: async (organizationId: string) =>
      unwrapResultError(
        await authClient.organization.setActive({ organizationId }),
        "Could not switch organization.",
      ),
    mutationKey: ["auth", "organization", "set-active"],
  });

  const openDialog = () => {
    setError(null);
    setSelectedOrganizationId(activeOrganizationId ?? organizations[0]?.id ?? "");
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setSelectedOrganizationId(activeOrganizationId ?? organizations[0]?.id ?? "");
    }
  };

  const handleSave = async () => {
    setError(null);

    if (!selectedOrganizationId) {
      setError("Choose an organization.");
      return;
    }

    if (selectedOrganizationId === activeOrganizationId) {
      handleOpenChange(false);
      return;
    }

    try {
      await setActiveOrganizationMutation.mutateAsync(selectedOrganizationId);
      handleOpenChange(false);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not switch organization."));
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={UserGroupIcon} />
        Switch
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Active organization</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <Select
              items={organizationSelectItems}
              modal={false}
              onValueChange={(value) => {
                if (value) {
                  setSelectedOrganizationId(value);
                }
              }}
              value={selectedOrganizationId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose organization" />
              </SelectTrigger>
              <SelectContent positionerClassName="z-[60]">
                <SelectList>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectList>
              </SelectContent>
            </Select>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton disabled={setActiveOrganizationMutation.isPending}>
              Cancel
            </DialogCloseButton>
            <Button
              disabled={setActiveOrganizationMutation.isPending || !selectedOrganizationId}
              onClick={() => void handleSave()}
              size="sm"
            >
              {setActiveOrganizationMutation.isPending ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={UserGroupIcon} />
              )}
              Save
            </Button>
          </DialogFooter>
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
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(activeOrganization.name);
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(activeOrganization.slug);
  const updateOrganizationMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) =>
      unwrapResultError(
        await authClient.organization.update({
          data: input,
          organizationId: activeOrganization.id,
        }),
        "Could not update organization.",
      ),
    mutationKey: ["auth", "organization", "update"],
  });

  const openDialog = () => {
    setError(null);
    setName(activeOrganization.name);
    setSlug(activeOrganization.slug);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setName(activeOrganization.name);
      setSlug(activeOrganization.slug);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const nextSlug = slugifyOrganizationName(slug.trim() || trimmedName);

    if (trimmedName.length === 0) {
      setError("Name cannot be empty.");
      return;
    }

    if (nextSlug.length === 0) {
      setError("Slug cannot be empty.");
      return;
    }

    try {
      await updateOrganizationMutation.mutateAsync({
        name: trimmedName,
        slug: nextSlug,
      });
      handleOpenChange(false);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not update organization."));
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
            <DialogTitle>Edit organization</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave}>
            <DialogBody className="space-y-3">
              <TextField>
                <TextFieldInput
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </TextField>

              <TextField>
                <TextFieldInput onChange={(event) => setSlug(event.target.value)} value={slug} />
              </TextField>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [draftRoles, setDraftRoles] = useState<Record<string, OrganizationRoleOption>>({});
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrganizationRoleOption>("member");
  const [open, setOpen] = useState(false);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const inviteMemberMutation = useMutation({
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
  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) =>
      unwrapResultError(
        await authClient.organization.cancelInvitation({ invitationId }),
        "Could not cancel invitation.",
      ),
    mutationKey: ["auth", "organization", "cancel-invitation"],
  });
  const removeMemberMutation = useMutation({
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
  const updateMemberRoleMutation = useMutation({
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
    setDraftRoles({});
    setError(null);
    setInviteEmail("");
    setInviteRole("member");
    setPendingInvitationId(null);
    setPendingMemberId(null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setDraftRoles({});
      setError(null);
      setInviteEmail("");
      setInviteRole("member");
      setPendingInvitationId(null);
      setPendingMemberId(null);
    }
  };

  const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const email = inviteEmail.trim().toLowerCase();

    if (email.length === 0) {
      setError("Email is required.");
      return;
    }

    try {
      await inviteMemberMutation.mutateAsync({
        email,
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteRole("member");
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not invite member."));
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

  const handleRoleChange = async (member: OrganizationMember) => {
    const nextRole = draftRoles[member.id];
    const currentRole = normalizeOrganizationRole(member.role);

    if (!nextRole || nextRole === currentRole) {
      return;
    }

    setError(null);

    try {
      setPendingMemberId(member.id);
      await updateMemberRoleMutation.mutateAsync({
        memberId: member.id,
        role: nextRole,
      });
      setDraftRoles((currentRoles) => {
        const nextRoles = { ...currentRoles };
        delete nextRoles[member.id];
        return nextRoles;
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
              <form className="space-y-3" onSubmit={handleInvite}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-end">
                  <TextField>
                    <TextFieldInput
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="name@example.com"
                      type="email"
                      value={inviteEmail}
                    />
                  </TextField>

                  <Select
                    items={organizationRoleSelectItems}
                    modal={false}
                    onValueChange={(value) => {
                      if (value) {
                        setInviteRole(normalizeOrganizationRole(value));
                      }
                    }}
                    value={inviteRole}
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

            <div className="space-y-3">
              <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                Members
              </p>

              <div className="divide-y divide-border/70">
                {members.map((member) => {
                  const currentRole = normalizeOrganizationRole(member.role);
                  const draftRole = draftRoles[member.id] ?? currentRole;
                  const isActiveMember = member.userId === activeMember?.userId;
                  const isSavingRole =
                    pendingMemberId === member.id && updateMemberRoleMutation.isPending;
                  const isRemovingMember =
                    pendingMemberId === member.id && removeMemberMutation.isPending;

                  return (
                    <div
                      className="flex flex-col gap-3 py-3 md:flex-row md:items-center"
                      key={member.id}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{member.user.name}</p>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {member.user.email}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canUpdateMemberRole && !isActiveMember ? (
                          <>
                            <Select
                              items={organizationRoleSelectItems}
                              modal={false}
                              onValueChange={(value) => {
                                if (value) {
                                  setDraftRoles((currentRoles) => ({
                                    ...currentRoles,
                                    [member.id]: normalizeOrganizationRole(value),
                                  }));
                                }
                              }}
                              value={draftRole}
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

                            <Button
                              disabled={
                                draftRole === currentRole || isSavingRole || isRemovingMember
                              }
                              onClick={() => void handleRoleChange(member)}
                              size="sm"
                              variant="outline"
                            >
                              {isSavingRole ? (
                                <HugeiconsIcon
                                  aria-hidden
                                  className="size-4 animate-spin"
                                  icon={Loading03Icon}
                                />
                              ) : (
                                <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                              )}
                              Save
                            </Button>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {formatRoleLabel(member.role)}
                            {isActiveMember ? " / You" : ""}
                          </p>
                        )}

                        {canRemoveMembers && !isActiveMember ? (
                          <Button
                            disabled={isSavingRole || isRemovingMember}
                            onClick={() => void handleRemoveMember(member.id)}
                            size="sm"
                            variant="outline"
                          >
                            {isRemovingMember ? (
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
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {pendingInvitations.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  Pending
                </p>

                <div className="divide-y divide-border/70">
                  {pendingInvitations.map((invitation) => {
                    const isCancelingInvitation =
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

                        {canCancelInvitations ? (
                          <Button
                            disabled={isCancelingInvitation}
                            onClick={() => void handleCancelInvitation(invitation.id)}
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
            ) : null}

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
}: {
  activeOrganization: ActiveOrganization;
}) => {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const leaveOrganizationMutation = useMutation({
    mutationFn: async () =>
      unwrapResultError(
        await authClient.organization.leave({
          organizationId: activeOrganization.id,
        }),
        "Could not leave organization.",
      ),
    mutationKey: ["auth", "organization", "leave"],
  });

  const openDialog = () => {
    setConfirmation("");
    setError(null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmation("");
      setError(null);
    }
  };

  const handleLeave = async () => {
    if (confirmation.trim().toLowerCase() !== "leave organization") {
      setError('Type "leave organization".');
      return;
    }

    setError(null);

    try {
      await leaveOrganizationMutation.mutateAsync();
      handleOpenChange(false);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not leave organization."));
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
            <DialogTitle>Leave organization</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">leave organization</span>
            </p>
            <TextField>
              <TextFieldInput
                autoFocus
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="leave organization"
                value={confirmation}
              />
            </TextField>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton disabled={leaveOrganizationMutation.isPending}>
              Cancel
            </DialogCloseButton>
            <Button
              disabled={leaveOrganizationMutation.isPending}
              onClick={() => void handleLeave()}
              size="sm"
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
        </DialogContent>
      </Dialog>
    </>
  );
};

const DeleteOrganizationDialog = ({
  activeOrganization,
}: {
  activeOrganization: ActiveOrganization;
}) => {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const deleteOrganizationMutation = useMutation({
    mutationFn: async () =>
      unwrapResultError(
        await authClient.organization.delete({
          organizationId: activeOrganization.id,
        }),
        "Could not delete organization.",
      ),
    mutationKey: ["auth", "organization", "delete"],
  });

  const openDialog = () => {
    setConfirmation("");
    setError(null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmation("");
      setError(null);
    }
  };

  const handleDelete = async () => {
    if (confirmation.trim().toLowerCase() !== "delete organization") {
      setError('Type "delete organization".');
      return;
    }

    setError(null);

    try {
      await deleteOrganizationMutation.mutateAsync();
      handleOpenChange(false);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not delete organization."));
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
            <DialogTitle>Delete organization</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">delete organization</span>
            </p>
            <TextField>
              <TextFieldInput
                autoFocus
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="delete organization"
                value={confirmation}
              />
            </TextField>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton disabled={deleteOrganizationMutation.isPending}>
              Cancel
            </DialogCloseButton>
            <Button
              disabled={deleteOrganizationMutation.isPending}
              onClick={() => void handleDelete()}
              size="sm"
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
        </DialogContent>
      </Dialog>
    </>
  );
};

export const OrganizationSettingsPanel = () => {
  const activeMemberState = authClient.useActiveMember();
  const activeOrganizationState = authClient.useActiveOrganization();
  const organizationsState = authClient.useListOrganizations();
  const activeMember = activeMemberState.data;
  const activeOrganization = activeOrganizationState.data;
  const organizations = organizationsState.data ?? [];
  const activeRole = activeMember ? normalizeOrganizationRole(activeMember.role) : null;
  const currentUserId = activeMember?.userId ?? null;
  const pendingInvitations =
    activeOrganization?.invitations.filter((invitation) => invitation.status === "pending") ?? [];
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
  const isCurrentUsersPersonalOrganization =
    activeOrganization?.personalOwnerUserId === currentUserId;
  const isProtectedPersonalOrganization = Boolean(activeOrganization?.personalOwnerUserId);
  const updateOrganizationReason =
    activeOrganization && !canUpdateOrganization
      ? "Only admins and owners can edit organization details."
      : null;
  const leaveOrganizationReason = activeOrganization
    ? isCurrentUsersPersonalOrganization
      ? "You can't leave your personal organization."
      : organizations.length <= 1
        ? "You can't leave your last organization."
        : null
    : null;
  const deleteOrganizationReason = activeOrganization
    ? isProtectedPersonalOrganization
      ? "Personal organizations can't be deleted."
      : !canDeleteOrganization
        ? "Only owners can delete organizations."
        : organizations.length <= 1
          ? "You can't delete your last organization."
          : null
    : null;

  const organizationSummary = organizationsState.isPending
    ? "Loading..."
    : formatCount(organizations.length, "organization");
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
  const subtitle = activeOrganization
    ? [activeOrganization.slug, activeRole ? formatRoleLabel(activeRole) : null]
        .filter(Boolean)
        .join(" / ")
    : organizationsState.isPending
      ? "Loading..."
      : organizations.length > 0
        ? formatCount(organizations.length, "organization")
        : "No organization";

  return (
    <TooltipProvider>
      <div>
        <div className="pb-8">
          <h1 className="text-2xl font-medium tracking-tight text-foreground">
            {activeOrganization?.name ?? "Organization"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <div>
          {organizations.length > 1 || !activeOrganization ? (
            <SettingsRow
              action={
                <SwitchOrganizationDialog
                  activeOrganizationId={activeOrganization?.id ?? null}
                  organizations={organizations}
                />
              }
              label="Active organization"
              value={activeOrganization?.name ?? "None"}
            />
          ) : null}

          <SettingsRow
            action={<CreateOrganizationDialog />}
            label="Create organization"
            value={organizationSummary}
          />

          {activeOrganization ? (
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
              label="Name"
              value={activeOrganization.name}
            />
          ) : null}

          {activeOrganization ? (
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
          ) : null}

          {activeOrganization ? (
            <SettingsRow
              action={
                leaveOrganizationReason ? (
                  <MutedActionButton
                    icon={<HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />}
                    label="Leave"
                    reason={leaveOrganizationReason}
                  />
                ) : (
                  <LeaveOrganizationDialog activeOrganization={activeOrganization} />
                )
              }
              label="Leave organization"
              value={activeRole ? formatRoleLabel(activeRole) : "Current organization"}
            />
          ) : null}

          {activeOrganization ? (
            <SettingsRow
              action={
                deleteOrganizationReason ? (
                  <MutedActionButton
                    icon={<HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />}
                    label="Delete"
                    reason={deleteOrganizationReason}
                  />
                ) : (
                  <DeleteOrganizationDialog activeOrganization={activeOrganization} />
                )
              }
              label="Delete organization"
              value="Permanent"
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
};
