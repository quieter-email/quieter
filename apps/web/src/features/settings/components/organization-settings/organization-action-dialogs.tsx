"use client";

import {
  Delete02Icon,
  Loading03Icon,
  Logout03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { authClient } from "#/lib/auth";

import { getFullOrganizationQueryKey } from "./domain";
import type { FullOrganization } from "./domain";

export const LeaveOrganizationDialog = ({
  onLeft,
  organization,
}: {
  onLeft?: () => void;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const organizationsState = authClient.useListOrganizations();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const leaveOrganizationMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.organization.leave({
        organizationId: organization.id,
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not leave team.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", organization.id, "leave"],
    onSuccess: async () => {
      queryClient.removeQueries({
        queryKey: getFullOrganizationQueryKey(organization.id),
      });
      await organizationsState.refetch();
      onLeft?.();
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
        setSubmitError(null);
        form.reset({ confirmation: "" });
      } catch (mutationError) {
        setSubmitError(
          mutationError instanceof Error
            ? mutationError.message
            : "Could not leave team."
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        confirmation: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^leave team$/u, 'Type "leave team".'),
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
          if (!nextOpen) {
            resetDialog();
          }
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
              <p className="text-body text-muted-fg">
                Type <span className="font-medium text-fg">leave team</span>
              </p>

              <form.Field name="confirmation">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      name={field.name}
                      onBlur={() => {
                        field.handleBlur();
                      }}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="leave team"
                      value={field.state.value}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p
                        className="text-body text-destructive"
                        key={error?.message}
                      >
                        {error?.message}
                      </p>
                    ))}
                  </TextField>
                )}
              </form.Field>

              {submitError !== null &&
              submitError !== undefined &&
              submitError !== "" ? (
                <p className="text-body text-destructive">{submitError}</p>
              ) : null}
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
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4 animate-spin"
                    icon={Loading03Icon}
                  />
                ) : (
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Logout03Icon}
                  />
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

export const DeleteOrganizationDialog = ({
  onDeleted,
  organization,
}: {
  onDeleted?: () => void;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const organizationsState = authClient.useListOrganizations();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const deleteOrganizationMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.organization.delete({
        organizationId: organization.id,
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not delete team.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", organization.id, "delete"],
    onSuccess: async () => {
      queryClient.removeQueries({
        queryKey: getFullOrganizationQueryKey(organization.id),
      });
      await organizationsState.refetch();
      onDeleted?.();
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
        setSubmitError(null);
        form.reset({ confirmation: "" });
      } catch (mutationError) {
        setSubmitError(
          mutationError instanceof Error
            ? mutationError.message
            : "Could not delete team."
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        confirmation: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^delete team$/u, 'Type "delete team".'),
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
          if (!nextOpen) {
            resetDialog();
          }
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
              <p className="text-body text-muted-fg">
                Type <span className="font-medium text-fg">delete team</span>
              </p>

              <form.Field name="confirmation">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      name={field.name}
                      onBlur={() => {
                        field.handleBlur();
                      }}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="delete team"
                      value={field.state.value}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p
                        className="text-body text-destructive"
                        key={error?.message}
                      >
                        {error?.message}
                      </p>
                    ))}
                  </TextField>
                )}
              </form.Field>

              {submitError !== null &&
              submitError !== undefined &&
              submitError !== "" ? (
                <p className="text-body text-destructive">{submitError}</p>
              ) : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton
                disabled={deleteOrganizationMutation.isPending}
              >
                Cancel
              </DialogCloseButton>
              <Button
                disabled={deleteOrganizationMutation.isPending}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {deleteOrganizationMutation.isPending ? (
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4 animate-spin"
                    icon={Loading03Icon}
                  />
                ) : (
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Delete02Icon}
                  />
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
