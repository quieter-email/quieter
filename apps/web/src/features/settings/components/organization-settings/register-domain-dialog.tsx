"use client";

import {
  Add01Icon,
  Globe02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
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
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { orpc } from "#/lib/orpc";

import { getOrganizationMailDomainsQueryKey } from "./mail-domains";
import type { OrganizationMailDomain } from "./mail-domains";

type MailDomainMode = OrganizationMailDomain["mode"];

const modeOptions = [
  {
    description:
      "Authenticate the domain for transactional and API mail without routing incoming messages to Quieter.",
    label: "Send only",
    value: "send_only",
  },
  {
    description:
      "Send mail and create shared inboxes that receive messages addressed to this domain.",
    label: "Send and receive",
    value: "send_and_receive",
  },
] as const satisfies {
  description: string;
  label: string;
  value: MailDomainMode;
}[];

export const RegisterDomainDialog = ({
  children,
  fixedMode,
  onCreated,
  organizationId,
}: {
  children?: ReactNode;
  /**
   * Locks the dialog to one mail mode and hides the choice, for flows such as
   * onboarding where the intent already determines the mode.
   */
  fixedMode?: MailDomainMode;
  onCreated?: (domainId: string) => void;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createSetupMutation = useMutation({
    ...orpc.mailDomains.createSetup.mutationOptions(),
    mutationKey: ["mail-domains", organizationId, "create-setup"],
  });
  const form = useForm({
    defaultValues: {
      domain: "",
      mode: fixedMode ?? "send_only",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        const result = await createSetupMutation.mutateAsync({
          domain: value.domain,
          mode: value.mode,
          organizationId,
        });
        await queryClient.invalidateQueries({
          queryKey: getOrganizationMailDomainsQueryKey(organizationId),
        });
        setOpen(false);
        form.reset();
        onCreated?.(result.domainId);
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : "Could not register domain."
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        domain: z.string().trim().min(1, "Domain is required."),
        mode: z.enum(["send_only", "send_and_receive"]),
      }),
    },
  });

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
        size="sm"
      >
        {children ?? (
          <>
            <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
            Register
          </>
        )}
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
        <DialogContent className="w-[min(94vw,36rem)]">
          <DialogHeader>
            <DialogTitle>Register domain</DialogTitle>
            <DialogDescription>
              Choose what this domain can do. You can expand its capabilities
              later.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <form
              action={async () => {
                await form.handleSubmit();
              }}
              className="space-y-5"
            >
              <form.Field name="domain">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-label="Domain"
                      autoComplete="off"
                      name={field.name}
                      onBlur={() => {
                        field.handleBlur();
                      }}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="example.com"
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

              {fixedMode === undefined ? (
                <form.Field name="mode">
                  {(field) => (
                    <fieldset className="space-y-2">
                      <legend className="mb-2 text-body font-medium text-fg">
                        Mail mode
                      </legend>
                      {modeOptions.map((option) => {
                        const selected = field.state.value === option.value;
                        return (
                          <div
                            className={cn(
                              "squircle flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              selected
                                ? "border-fg/30 bg-muted/40"
                                : "border-border hover:bg-muted/60",
                              ""
                            )}
                            key={option.value}
                          >
                            <input
                              aria-label={option.label}
                              checked={selected}
                              className="mt-1 size-4 accent-fg"
                              id={`domain-mode-${option.value}`}
                              name={field.name}
                              onChange={() => {
                                field.handleChange(option.value);
                              }}
                              type="radio"
                              value={option.value}
                            />
                            <span>
                              <span className="block text-body font-medium text-fg">
                                {option.label}
                              </span>
                              <span className="mt-1 block text-caption/5 text-muted-fg">
                                {option.description}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </fieldset>
                  )}
                </form.Field>
              ) : null}

              {submitError !== null &&
              submitError !== undefined &&
              submitError !== "" ? (
                <p className="text-body text-destructive">{submitError}</p>
              ) : null}

              <DialogFooter className="px-0 pb-0">
                <DialogCloseButton disabled={createSetupMutation.isPending}>
                  Cancel
                </DialogCloseButton>
                <Button
                  disabled={createSetupMutation.isPending}
                  size="sm"
                  type="submit"
                >
                  {createSetupMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4"
                      icon={Globe02Icon}
                    />
                  )}
                  Register domain
                </Button>
              </DialogFooter>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
};
