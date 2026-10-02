"use client";

import { Button } from "@quieter/ui/button";
import { TextFieldInput } from "@quieter/ui/text-field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authClient } from "#/lib/auth";
import { toastError } from "#/lib/error-toast";

import { SettingsRow, SettingsRows } from "../settings-layout";
import { getFullOrganizationQueryKey } from "./domain";
import type { OrganizationSummary } from "./domain";

export const OrganizationGeneralSettings = ({
  organization,
  canManage,
}: {
  organization: OrganizationSummary;
  canManage: boolean;
}) => {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? organization.name;
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const slug = slugDraft ?? organization.slug;
  const organizations = authClient.useListOrganizations();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await authClient.organization.update({
        data: { name: name.trim(), slug: slug.trim() },
        organizationId: organization.id,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not update team.");
      }
    },
    onError: (error) => {
      toastError(error, {
        boundary: "team-settings",
        fallback: "Could not update team.",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        organizations.refetch(),
        queryClient.invalidateQueries({
          queryKey: getFullOrganizationQueryKey(organization.id),
        }),
      ]);
      setNameDraft(null);
      setSlugDraft(null);
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <SettingsRows>
        <SettingsRow
          title="Team name"
          action={
            <TextFieldInput
              aria-label="Team name"
              required
              disabled={!canManage || mutation.isPending}
              value={name}
              onChange={(event) => {
                setNameDraft(event.target.value);
              }}
            />
          }
        />
        <SettingsRow
          title="Team address"
          action={
            <TextFieldInput
              aria-label="Team address"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              disabled={!canManage || mutation.isPending}
              value={slug}
              onChange={(event) => {
                setSlugDraft(event.target.value);
              }}
            />
          }
        >
          Lowercase letters, numbers, and hyphens.
        </SettingsRow>
      </SettingsRows>
      {canManage && (
        <Button
          type="submit"
          size="sm"
          disabled={
            mutation.isPending ||
            (name === organization.name && slug === organization.slug)
          }
        >
          Save changes
        </Button>
      )}
    </form>
  );
};
