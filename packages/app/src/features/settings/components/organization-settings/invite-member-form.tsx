"use client";

import { Loading03Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getFullOrganizationQueryKey } from "@quieter/app/features/settings/components/organization-settings/domain";
import type { FullOrganization } from "@quieter/app/features/settings/components/organization-settings/domain";
import { settingsSurfaceVariants } from "@quieter/app/features/settings/components/settings-layout";
import { authClient } from "@quieter/app/lib/auth";
import { getErrorMessage } from "@quieter/app/lib/orpc-errors";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Text } from "@quieter/ui/text";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";

export const InviteMemberForm = ({
  className,
  canInviteMembers,
  organization,
}: {
  className?: string;
  canInviteMembers: boolean;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const emailErrorId = useId();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inviteMemberMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await authClient.organization.inviteMember({
        email,
        organizationId: organization.id,
        role: "member",
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not invite member.");
      }
      return response;
    },
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
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        await inviteMemberMutation.mutateAsync(value.email.trim());
        form.reset();
      } catch (mutationError) {
        setSubmitError(
          getErrorMessage(mutationError, "Could not invite member.")
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z.email("Enter a valid email.").trim(),
      }),
    },
  });

  if (!canInviteMembers) {
    return null;
  }

  return (
    <form
      className={cn(
        settingsSurfaceVariants({ variant: "form" }),
        settingsSurfaceVariants({ variant: "padding" }),
        className
      )}
      action={async () => {
        await form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => {
          const hasErrors = field.state.meta.errors.length > 0;

          return (
            <TextField className="min-w-0">
              <TextFieldInput
                aria-describedby={emailErrorId}
                aria-invalid={hasErrors}
                aria-label="Email address"
                autoComplete="email"
                className="min-w-0"
                name={field.name}
                onBlur={() => {
                  field.handleBlur();
                }}
                onChange={(event) => {
                  setSubmitError(null);
                  field.handleChange(event.target.value);
                }}
                placeholder="member@example.com"
                value={field.state.value}
              />
              <div
                aria-live="polite"
                className="min-h-lh text-body"
                id={emailErrorId}
              >
                {hasErrors
                  ? field.state.meta.errors.map((error) => (
                      <Text key={error?.message} tone="destructive">
                        {error?.message}
                      </Text>
                    ))
                  : submitError && (
                      <Text tone="destructive">{submitError}</Text>
                    )}
              </div>
            </TextField>
          );
        }}
      </form.Field>
      <Button
        className="shrink-0 @md:w-24"
        disabled={inviteMemberMutation.isPending}
        type="submit"
      >
        {inviteMemberMutation.isPending ? (
          <HugeiconsIcon
            aria-hidden
            className="size-4 animate-spin"
            icon={Loading03Icon}
          />
        ) : (
          <HugeiconsIcon aria-hidden className="size-4" icon={UserAdd01Icon} />
        )}
        Invite
      </Button>
    </form>
  );
};
