"use client";

import { Edit01Icon, Loading03Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
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
  TextField,
  TextFieldInput,
} from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import {
  type OrganizationSummary,
  getFullOrganizationQueryKey,
  slugifyOrganizationName,
} from "./domain";

export const OrganizationFormDialog = ({
  organization,
}: {
  organization?: OrganizationSummary;
}) => {
  const queryClient = useQueryClient();
  const organizationsState = authClient.useListOrganizations();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const isEditing = !!organization;
  const defaultValues = {
    name: organization?.name ?? "",
    slug: organization?.slug ?? "",
  };
  const organizationMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) => {
      const response = organization
        ? await authClient.organization.update({
            data: input,
            organizationId: organization.id,
          })
        : await authClient.organization.create({
            ...input,
            keepCurrentActiveOrganization: true,
          });
      if (response.error) {
        throw new Error(
          response.error.message ??
            (organization ? "Could not update team." : "Could not create team."),
        );
      }
      return response;
    },
    mutationKey: ["auth", "organization", isEditing ? "update" : "create"],
    onSuccess: async () => {
      await organizationsState.refetch();
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
        setSubmitError(
          (mutationError as { message?: string })?.message ??
            (organization ? "Could not update team." : "Could not create team."),
        );
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
