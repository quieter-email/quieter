"use client";

import {
  Delete02Icon,
  Loading03Icon,
  PlusSignIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc, rpc } from "~/lib/orpc";
import type { FullOrganization, OrganizationMember } from "./domain";
import { SettingsBackButton } from "../settings-layout";

const getOrganizationDivisionsQueryKey = (organizationId: string) =>
  ["organization", organizationId, "divisions"] as const;

const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

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
  const queryClient = useQueryClient();
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const [newDivisionName, setNewDivisionName] = useState("");
  const [newDivisionDescription, setNewDivisionDescription] = useState("");
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
  const selectedDivision =
    divisions.find((division) => division.id === selectedDivisionId) ?? divisions[0] ?? null;
  const invalidateDivisions = async () => {
    await queryClient.invalidateQueries({
      queryKey: getOrganizationDivisionsQueryKey(organization.id),
    });
  };
  const createDivisionMutation = useMutation({
    ...orpc.organization.createDivision.mutationOptions(),
    onSuccess: async (result) => {
      setNewDivisionName("");
      setNewDivisionDescription("");
      setSelectedDivisionId(result.divisionId);
      await invalidateDivisions();
    },
  });
  const updateDivisionMutation = useMutation({
    ...orpc.organization.updateDivision.mutationOptions(),
    onSuccess: invalidateDivisions,
  });
  const deleteDivisionMutation = useMutation({
    ...orpc.organization.deleteDivision.mutationOptions(),
    onSuccess: async () => {
      setSelectedDivisionId(null);
      await invalidateDivisions();
    },
  });
  const setMembersMutation = useMutation({
    ...orpc.organization.setDivisionMembers.mutationOptions(),
    onSuccess: invalidateDivisions,
  });
  const selectedMemberIds = new Set(selectedDivision?.members.map((member) => member.memberId));

  return (
    <section className="space-y-6">
      <SettingsBackButton onClick={onBack}>{organization.name}</SettingsBackButton>

      <h1 className="text-base font-semibold text-foreground">Divisions</h1>

      {isDivisionsError && (
        <p className="text-sm text-destructive">
          {divisionsError?.message ?? "Could not load divisions."}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <div className="space-y-3">
          {canManageDivisions && (
            <form
              action={() => {
                createDivisionMutation.mutate(
                  {
                    description: newDivisionDescription,
                    name: newDivisionName,
                    organizationId: organization.id,
                  },
                  {
                    onError: (error) =>
                      toast.error(getMutationErrorMessage(error, "Could not create division.")),
                  },
                );
              }}
              className="space-y-2 rounded-lg border border-border/70 bg-muted/10 p-3 squircle"
            >
              <TextFieldInput
                aria-label="Division name"
                onChange={(event) => setNewDivisionName(event.currentTarget.value)}
                placeholder="Engineering"
                size="sm"
                value={newDivisionName}
              />
              <TextFieldInput
                aria-label="Division description"
                onChange={(event) => setNewDivisionDescription(event.currentTarget.value)}
                placeholder="Optional description"
                size="sm"
                value={newDivisionDescription}
              />
              <Button
                className="w-full"
                disabled={!newDivisionName.trim() || createDivisionMutation.isPending}
                size="sm"
                type="submit"
              >
                <HugeiconsIcon
                  aria-hidden
                  className={cn("size-4", { "animate-spin": createDivisionMutation.isPending })}
                  icon={createDivisionMutation.isPending ? Loading03Icon : PlusSignIcon}
                />
                Add division
              </Button>
            </form>
          )}

          <div className="overflow-hidden rounded-lg border border-border/70 squircle">
            {isDivisionsPending ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                Loading divisions...
              </div>
            ) : divisions.length > 0 ? (
              divisions.map((division) => {
                const isSelected = selectedDivision?.id === division.id;
                return (
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border/60 p-3 text-left last:border-b-0",
                      {
                        "bg-muted/50": isSelected,
                        "hover:bg-muted/30": !isSelected,
                      },
                    )}
                    key={division.id}
                    onClick={() => setSelectedDivisionId(division.id)}
                    type="button"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                      icon={UserGroupIcon}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {division.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {division.members.length} Members / {division.mailboxCount} Mailboxes
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="p-3 text-sm text-muted-foreground">No divisions yet.</p>
            )}
          </div>
        </div>

        {selectedDivision ? (
          <div className="space-y-4">
            <form
              action={(formData) => {
                updateDivisionMutation.mutate(
                  {
                    description: String(formData.get("description") ?? ""),
                    divisionId: selectedDivision.id,
                    name: String(formData.get("name") ?? ""),
                  },
                  {
                    onError: (error) =>
                      toast.error(getMutationErrorMessage(error, "Could not update division.")),
                  },
                );
              }}
              className="rounded-lg border border-border/70 bg-muted/10 p-4 squircle"
              key={selectedDivision.id}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextFieldInput
                  aria-label="Division name"
                  defaultValue={selectedDivision.name}
                  disabled={!canManageDivisions}
                  name="name"
                />
                <TextFieldInput
                  aria-label="Division description"
                  defaultValue={selectedDivision.description ?? ""}
                  disabled={!canManageDivisions}
                  name="description"
                  placeholder="Description"
                />
              </div>
              {canManageDivisions && (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button disabled={updateDivisionMutation.isPending} size="sm" type="submit">
                    Save
                  </Button>
                  <Button
                    className="text-destructive hover:text-destructive"
                    disabled={deleteDivisionMutation.isPending}
                    onClick={() =>
                      deleteDivisionMutation.mutate(
                        { divisionId: selectedDivision.id },
                        {
                          onError: (error) =>
                            toast.error(
                              getMutationErrorMessage(error, "Could not delete division."),
                            ),
                        },
                      )
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                    Delete
                  </Button>
                </div>
              )}
            </form>

            <div className="overflow-hidden rounded-lg border border-border/70 squircle">
              <div className="border-b border-border/60 px-4 py-3">
                <h2 className="text-sm font-medium text-foreground">Members</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Members inherit mailbox roles granted to this division.
                </p>
              </div>
              <div className="divide-y divide-border/60">
                {members.map((memberRecord) => {
                  const checked = selectedMemberIds.has(memberRecord.id);
                  return (
                    <label
                      className="flex cursor-pointer items-center gap-3 px-4 py-3"
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
                              divisionId: selectedDivision.id,
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
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground squircle">
            Select or create a division.
          </div>
        )}
      </div>
    </section>
  );
};
