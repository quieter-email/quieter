"use client";

import type { RouterOutputs } from "@quieter/orpc";
import {
  Add01Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Globe02Icon,
  Loading03Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
  TextFieldInput,
  cn,
  toast,
} from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { orpc } from "~/lib/orpc";
import {
  getOrganizationMailDomainsQueryKey,
  type OrganizationMailDomain,
  type OrganizationMailDomainDnsRecord,
} from "./mail-domains";

type DomainSetup = RouterOutputs["mailDomains"]["createSetup"];
type DomainCheck = RouterOutputs["mailDomains"]["checkSetup"];
type MailDomainCheck = DomainCheck["checks"][number];
type RegisterDomainStep = "input" | "records" | "success";

const steps = [
  { id: "input", label: "Domain" },
  { id: "records", label: "DNS" },
  { id: "success", label: "Done" },
] satisfies Array<{ id: RegisterDomainStep; label: string }>;

const dnsRecordPurposes = new Set([
  "dkim",
  "dmarc",
  "inbound_mx",
  "mail_from_mx",
  "mail_from_spf",
  "ownership",
]);

const copyText = async (value: string, message: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

const toDomainSetup = (domain: OrganizationMailDomain): DomainSetup => ({
  domain: domain.domain,
  domainId: domain.id,
  records: domain.requiredDnsRecords,
  status: domain.status,
});

const toDomainCheck = (domain: OrganizationMailDomain): DomainCheck | null => {
  if (!domain.lastCheckResult) {
    return null;
  }

  return {
    checks: domain.lastCheckResult.checks,
    domain: domain.domain,
    domainId: domain.id,
    status: domain.status,
    verifiedAt: domain.verifiedAt,
  };
};

const DomainRegistrationSteps = ({ activeStep }: { activeStep: RegisterDomainStep }) => {
  const activeIndex = steps.findIndex((step) => step.id === activeStep);

  return (
    <div className="grid grid-cols-3 gap-2">
      {steps.map((step, index) => {
        const isActive = step.id === activeStep;
        const isComplete = index < activeIndex;

        return (
          <div
            className={cn(
              "h-1.5 rounded-full bg-secondary",
              (isActive || isComplete) && "bg-foreground",
            )}
            key={step.id}
          >
            <span className="sr-only">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
};

const CopyableDnsValue = ({
  className,
  label,
  value,
}: {
  className?: string;
  label: "host" | "priority" | "type" | "value";
  value: string;
}) => (
  <button
    className={cn(
      "group min-w-0 cursor-copy rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
      className,
    )}
    onClick={() => {
      void copyText(value, `Copied ${label} to clipboard.`);
    }}
    type="button"
  >
    <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </span>
    <span className="mt-1 block font-mono text-xs break-all text-foreground decoration-muted-foreground/50 underline-offset-4 group-hover:underline">
      {value}
    </span>
  </button>
);

const DnsStatusIcon = ({ check }: { check?: MailDomainCheck }) => {
  if (!check) {
    return <span className="mt-0.5 size-4 rounded-full border border-border/70" />;
  }

  return check.ok ? (
    <HugeiconsIcon
      aria-hidden
      className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-300"
      icon={CheckmarkCircle01Icon}
    />
  ) : (
    <HugeiconsIcon aria-hidden className="mt-0.5 size-4 text-destructive" icon={CancelCircleIcon} />
  );
};

const DnsRecordRow = ({
  check,
  record,
}: {
  check?: MailDomainCheck;
  record: OrganizationMailDomainDnsRecord;
}) => (
  <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3 border-b border-border/70 py-3.5 last:border-b-0 sm:py-4">
    <DnsStatusIcon check={check} />

    <div className="min-w-0 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">{record.purpose.replaceAll("_", " ")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {check?.message ?? "Not checked yet."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-[0.45fr_minmax(0,1.15fr)_0.45fr_minmax(0,1.7fr)]">
        <CopyableDnsValue className="md:order-1" label="type" value={record.type} />
        <CopyableDnsValue
          className="col-span-2 md:order-2 md:col-span-1"
          label="host"
          value={record.name}
        />
        <CopyableDnsValue
          className="md:order-3"
          label="priority"
          value={record.priority?.toString() ?? "-"}
        />
        <CopyableDnsValue
          className="col-span-2 md:order-4 md:col-span-1"
          label="value"
          value={record.value}
        />
      </div>
    </div>
  </div>
);

const getDnsChecks = (lastCheck: DomainCheck | null) =>
  lastCheck?.checks.filter((check) => dnsRecordPurposes.has(check.purpose)) ?? [];

const getSetupChecks = (lastCheck: DomainCheck | null) =>
  lastCheck?.checks.filter((check) => !dnsRecordPurposes.has(check.purpose)) ?? [];

export const RegisterDomainDialog = ({
  children,
  domain,
  organizationId,
}: {
  children?: ReactNode;
  domain?: OrganizationMailDomain;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<RegisterDomainStep>("input");
  const [setup, setSetup] = useState<DomainSetup | null>(null);
  const [lastCheck, setLastCheck] = useState<DomainCheck | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createSetupMutation = useMutation({
    ...orpc.mailDomains.createSetup.mutationOptions(),
    mutationKey: ["mail-domains", organizationId, "create-setup"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrganizationMailDomainsQueryKey(organizationId),
      });
    },
  });
  const checkSetupMutation = useMutation({
    ...orpc.mailDomains.checkSetup.mutationOptions(),
    mutationKey: ["mail-domains", organizationId, "check-setup"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrganizationMailDomainsQueryKey(organizationId),
      });
    },
  });
  const form = useForm({
    defaultValues: {
      domain: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        const result = await createSetupMutation.mutateAsync({
          domain: value.domain,
          organizationId,
        });
        setSetup(result);
        setLastCheck(null);
        setStep("records");
      } catch (error) {
        setSubmitError((error as { message?: string })?.message ?? "Could not start setup.");
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        domain: z.string().trim().min(1, "Domain is required."),
      }),
    },
  });
  const verified = setup?.status === "verified";
  const passingChecks = lastCheck?.checks.filter((check) => check.ok).length ?? 0;
  const totalChecks = lastCheck?.checks.length ?? 0;
  const dnsChecks = getDnsChecks(lastCheck);
  const setupChecks = getSetupChecks(lastCheck);

  const resetDialog = () => {
    setStep(domain ? "records" : "input");
    setSetup(domain ? toDomainSetup(domain) : null);
    setLastCheck(domain ? toDomainCheck(domain) : null);
    setSubmitError(null);
    form.reset();
  };

  const verifyDomain = useCallback(
    async (manual: boolean) => {
      if (!setup || setup.status === "verified" || checkSetupMutation.isPending) {
        return;
      }

      try {
        const result = await checkSetupMutation.mutateAsync({
          domain: setup.domain,
          organizationId,
        });
        setLastCheck(result);
        setSetup((current) => (current ? { ...current, status: result.status } : current));

        if (manual) {
          if (result.status === "verified") {
            toast.success("Domain verified.");
          } else {
            const failedSetupCheck = getSetupChecks(result).find((check) => !check.ok);
            toast.error(failedSetupCheck?.message ?? "DNS records are not verified yet.");
          }
        }
      } catch (error) {
        if (manual) {
          toast.error((error as { message?: string })?.message ?? "Could not verify domain.");
        }
      }
    },
    [checkSetupMutation, organizationId, setup],
  );

  useEffect(() => {
    if (!open || step !== "records" || !setup || setup.status === "verified") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void verifyDomain(false);
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [open, setup, step, verifyDomain]);

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
        variant={domain ? "outline" : "default"}
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
          if (!nextOpen) resetDialog();
        }}
        open={open}
      >
        <DialogContent className="flex max-h-[88vh] w-[min(94vw,60rem)] flex-col">
          <DialogHeader>
            <DialogTitle>Register domain</DialogTitle>
            <DialogDescription>
              Add an organization domain for inbound and outbound mail.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="min-h-0 space-y-5 overflow-hidden">
            <DomainRegistrationSteps activeStep={step} />

            {step === "input" && (
              <form
                action={async () => {
                  await form.handleSubmit();
                }}
                className="space-y-4"
              >
                <form.Field name="domain">
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
                        placeholder="example.com"
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

                <DialogFooter className="px-0 pb-0">
                  <DialogCloseButton disabled={createSetupMutation.isPending}>
                    Cancel
                  </DialogCloseButton>
                  <Button disabled={createSetupMutation.isPending} size="sm" type="submit">
                    {createSetupMutation.isPending ? (
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4 animate-spin"
                        icon={Loading03Icon}
                      />
                    ) : (
                      <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
                    )}
                    Next
                  </Button>
                </DialogFooter>
              </form>
            )}

            {step === "records" && setup && (
              <>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{setup.domain}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {verified
                        ? "DNS is verified."
                        : "Add these records. Quieter checks again every 30 seconds."}
                    </p>
                  </div>
                </div>

                <div className="max-h-[48vh] overflow-y-auto pr-1 md:max-h-[52vh]">
                  {setup.records.map((record, index) => (
                    <DnsRecordRow
                      key={`${record.type}:${record.name}:${record.value}`}
                      check={
                        verified
                          ? { message: "Record verified.", ok: true, purpose: record.purpose }
                          : dnsChecks[index]
                      }
                      record={record}
                    />
                  ))}
                </div>

                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    verified
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border/70 bg-secondary/30 text-muted-foreground",
                  )}
                >
                  {verified ? (
                    <span className="inline-flex items-center gap-2">
                      <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle01Icon} />
                      Domain verified.
                    </span>
                  ) : totalChecks > 0 ? (
                    `${passingChecks} of ${totalChecks} checks are passing.`
                  ) : (
                    "Waiting for the first DNS check."
                  )}
                </div>

                {setupChecks.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border/70 px-3 py-2">
                    {setupChecks.map((check) => (
                      <div
                        className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-sm"
                        key={check.purpose}
                      >
                        <DnsStatusIcon check={check} />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">
                            {check.purpose.replaceAll("_", " ")}
                          </p>
                          <p className="mt-0.5 wrap-break-word text-muted-foreground">
                            {check.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <DialogFooter className="px-0 pb-0">
                  <DialogCloseButton disabled={checkSetupMutation.isPending}>
                    Cancel
                  </DialogCloseButton>
                  <Button
                    disabled={checkSetupMutation.isPending}
                    onClick={() => {
                      void verifyDomain(true);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className={cn("size-4", checkSetupMutation.isPending && "animate-spin")}
                      icon={checkSetupMutation.isPending ? Loading03Icon : Refresh01Icon}
                    />
                    Verify
                  </Button>
                  <Button disabled={!verified} onClick={() => setStep("success")} size="sm">
                    Next
                  </Button>
                </DialogFooter>
              </>
            )}

            {step === "success" && setup && (
              <>
                <div className="py-8 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    <HugeiconsIcon aria-hidden className="size-6" icon={CheckmarkCircle01Icon} />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-foreground">
                    {setup.domain} is verified
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The domain was added to this organization.
                  </p>
                </div>

                <DialogFooter className="px-0 pb-0">
                  <Button
                    onClick={() => {
                      setOpen(false);
                      resetDialog();
                    }}
                    size="sm"
                  >
                    Finish setup
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
};
