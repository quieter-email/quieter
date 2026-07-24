"use client";

import { Loading03Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { settingsInsetFieldRowClass } from "../settings-layout";
import { type FullOrganization, getFullOrganizationQueryKey } from "./domain";

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
          (mutationError as { message?: string })?.message ?? "Could not invite member.",
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z.string().trim().email("Enter a valid email."),
      }),
    },
  });

  if (!canInviteMembers) {
    return null;
  }

  return (
    <form
      className={cn(className)}
      action={async () => {
        await form.handleSubmit();
      }}
    >
      <div className={cn(settingsInsetFieldRowClass, "gap-3")}>
        <form.Field name="email">
          {(field) => {
            const hasErrors = field.state.meta.errors.length > 0;

            return (
              <TextField className="min-w-0 flex-1">
                <TextFieldInput
                  aria-describedby={hasErrors ? emailErrorId : undefined}
                  aria-invalid={hasErrors}
                  chrome="ghost"
                  className="h-9 px-0"
                  name={field.name}
                  onBlur={() => field.handleBlur()}
                  onChange={(event) => {
                    setSubmitError(null);
                    field.handleChange(event.target.value);
                  }}
                  placeholder="member@example.com"
                  value={field.state.value}
                />
                {hasErrors && (
                  <div id={emailErrorId} role="alert">
                    {field.state.meta.errors.map((error) => (
                      <p className="text-sm text-destructive" key={error?.message}>
                        {error?.message}
                      </p>
                    ))}
                  </div>
                )}
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
            <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          ) : (
            <HugeiconsIcon aria-hidden className="size-4" icon={UserAdd01Icon} />
          )}
          Invite
        </Button>
      </div>

      {submitError && (
        <p className="px-4 pb-3 text-sm text-destructive @md:px-6" role="alert">
          {submitError}
        </p>
      )}
    </form>
  );
};
