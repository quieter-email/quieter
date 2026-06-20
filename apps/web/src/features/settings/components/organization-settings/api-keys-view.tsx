"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  Calendar03Icon,
  Delete02Icon,
  Key02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectScrollDownArrow,
  SelectScrollUpArrow,
  SelectTrigger,
  SelectValue,
  TextField,
  TextFieldInput,
  toast,
} from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { getOrganizationApiKeysQueryKey, organizationApiKeysQueryOptions } from "./api-keys";
import { formatCount, type FullOrganization } from "./domain";
import { MutedActionButton } from "./settings-row";

type OrganizationApiKey = {
  createdAt: Date;
  enabled: boolean;
  expiresAt: Date | null;
  id: string;
  lastRequest: Date | null;
  name: string | null;
  prefix: string | null;
  start: string | null;
};

const expirationOptions = [
  { label: "1 week", value: "one_week", seconds: 60 * 60 * 24 * 7 },
  { label: "1 month", value: "one_month", seconds: 60 * 60 * 24 * 30 },
  { label: "3 months", value: "three_months", seconds: 60 * 60 * 24 * 90 },
  { label: "6 months", value: "six_months", seconds: 60 * 60 * 24 * 180 },
  { label: "1 year", value: "one_year", seconds: 60 * 60 * 24 * 365 },
  { label: "3 years", value: "three_years", seconds: 60 * 60 * 24 * 365 * 3 },
  { label: "Never", value: "never", seconds: null },
] as const;

type ExpirationValue = (typeof expirationOptions)[number]["value"];

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

const formatApiKeyDate = (value: Date | string | null) => {
  if (!value) return "Never";

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied API key to clipboard.");
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

const CreateApiKeyDialog = ({ organizationId }: { organizationId: string }) => {
  const [open, setOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: async (input: {
      expiresIn: number | null;
      name: string;
      organizationId: string;
      prefix: string;
    }) => {
      const response = await authClient.apiKey.create({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        expiresIn: input.expiresIn,
        name: input.name,
        organizationId: input.organizationId,
        prefix: input.prefix,
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Could not create API key.");
      }

      if (!response.data?.key) {
        throw new Error("Could not read the created API key.");
      }

      return response.data;
    },
    mutationKey: ["organization-api-keys", organizationId, "create"],
    onSuccess: async (data) => {
      setCreatedKey(data.key);
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
    },
  });
  const form = useForm({
    defaultValues: {
      expiration: "one_month" as ExpirationValue,
      name: "",
      prefix: "quieter_",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const expiration = expirationOptions.find((option) => option.value === value.expiration);

      try {
        await createMutation.mutateAsync({
          expiresIn: expiration?.seconds ?? null,
          name: value.name.trim(),
          organizationId,
          prefix: value.prefix.trim(),
        });
      } catch (mutationError) {
        setSubmitError(
          (mutationError as { message?: string })?.message ?? "Could not create API key.",
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        expiration: z.enum(expirationOptions.map((option) => option.value)),
        name: z.string().trim().min(1, "Name is required.").max(64, "Name is too long."),
        prefix: z
          .string()
          .trim()
          .min(1, "Prefix is required.")
          .max(32, "Prefix is too long.")
          .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, underscores, or hyphens."),
      }),
    },
  });
  const resetDialog = () => {
    setCreatedKey(null);
    setSubmitError(null);
    form.reset({
      expiration: "one_month",
      name: "",
      prefix: "quieter_",
    });
  };

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
        Create
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetDialog();
        }}
        open={open}
      >
        <DialogContent className="w-[min(92vw,34rem)]">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The full key is shown once. Store it before closing this dialog.
            </DialogDescription>
          </DialogHeader>

          {createdKey ? (
            <>
              <DialogBody className="space-y-3">
                <button
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-xs break-all text-foreground outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => void copyText(createdKey)}
                  type="button"
                >
                  {createdKey}
                </button>
                <p className="text-sm text-muted-foreground">Click the key to copy it.</p>
              </DialogBody>

              <DialogFooter>
                <DialogCloseButton>Close</DialogCloseButton>
              </DialogFooter>
            </>
          ) : (
            <form
              action={async () => {
                await form.handleSubmit();
              }}
            >
              <DialogBody className="space-y-4">
                <form.Field name="name">
                  {(field) => (
                    <TextField>
                      <FieldLabel>Name</FieldLabel>
                      <TextFieldInput
                        aria-invalid={field.state.meta.errors.length > 0}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="Production"
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

                <form.Field name="prefix">
                  {(field) => (
                    <TextField>
                      <FieldLabel>Prefix</FieldLabel>
                      <TextFieldInput
                        aria-invalid={field.state.meta.errors.length > 0}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="quieter_"
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

                <form.Field name="expiration">
                  {(field) => (
                    <TextField>
                      <FieldLabel>Expiration</FieldLabel>
                      <Select
                        items={expirationOptions.map(({ label, value }) => ({ label, value }))}
                        name={field.name}
                        onValueChange={(next) => {
                          setSubmitError(null);
                          field.handleChange(next as ExpirationValue);
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger
                          aria-invalid={field.state.meta.errors.length > 0}
                          onBlur={() => field.handleBlur()}
                        >
                          <SelectValue className="text-left" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectScrollUpArrow />
                          <SelectList>
                            {expirationOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectList>
                          <SelectScrollDownArrow />
                        </SelectContent>
                      </Select>
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
                <DialogCloseButton disabled={createMutation.isPending}>Cancel</DialogCloseButton>
                <Button disabled={createMutation.isPending} size="sm" type="submit">
                  {createMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
                  )}
                  Create
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const DeleteApiKeyDialog = ({
  apiKey,
  organizationId,
}: {
  apiKey: OrganizationApiKey;
  organizationId: string;
}) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.apiKey.delete({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        keyId: apiKey.id,
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Could not remove API key.");
      }

      return response.data;
    },
    mutationKey: ["organization-api-keys", organizationId, apiKey.id, "delete"],
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
      toast.success("API key removed.");
    },
    onError: (error) => {
      toast.error((error as { message?: string })?.message ?? "Could not remove API key.");
    },
  });

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        {deleteMutation.isPending ? (
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        ) : (
          <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
        )}
        Remove
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove API key</AlertDialogTitle>
          <AlertDialogDescription>
            This immediately disables access for {apiKey.name ?? apiKey.start ?? "this key"}.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogBody>
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
        </AlertDialogBody>

        <AlertDialogFooter>
          <AlertDialogCloseButton disabled={deleteMutation.isPending}>
            Cancel
          </AlertDialogCloseButton>
          <Button
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            size="sm"
            variant="destructive"
          >
            {deleteMutation.isPending ? (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            ) : (
              <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
            )}
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const ApiKeyRow = ({
  apiKey,
  canManageApiKeys,
  organizationId,
}: {
  apiKey: OrganizationApiKey;
  canManageApiKeys: boolean;
  organizationId: string;
}) => (
  <div className="flex flex-col gap-3 border-b border-border/70 py-4 last:border-b-0 md:flex-row md:items-center md:justify-between">
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          icon={Key02Icon}
        />
        <p className="truncate text-sm font-medium text-foreground">{apiKey.name ?? "API key"}</p>
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {apiKey.start ?? `${apiKey.prefix ?? "quieter_"}...`}
      </p>
    </div>

    <div className="flex flex-col gap-2 text-sm text-muted-foreground md:items-end">
      <span className="inline-flex items-center gap-1.5">
        <HugeiconsIcon aria-hidden className="size-4" icon={Calendar03Icon} />
        Expires {formatApiKeyDate(apiKey.expiresAt)}
      </span>
      <span>Last used {formatApiKeyDate(apiKey.lastRequest)}</span>
    </div>

    {canManageApiKeys && (
      <div className="shrink-0">
        <DeleteApiKeyDialog apiKey={apiKey} organizationId={organizationId} />
      </div>
    )}
  </div>
);

export const ApiKeysView = ({
  billingAccessUnknown,
  canManageApiKeys,
  canUseOrganizationApiKeys,
  onBack,
  organization,
}: {
  billingAccessUnknown: boolean;
  canManageApiKeys: boolean;
  canUseOrganizationApiKeys: boolean;
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const apiKeysQuery = useQuery(organizationApiKeysQueryOptions(organization.id));
  const apiKeys = (apiKeysQuery.data?.apiKeys ?? []) as OrganizationApiKey[];
  const manageApiKeysReason =
    (billingAccessUnknown && "Could not load billing access.") ||
    (!canUseOrganizationApiKeys &&
      `Creating API keys requires ${BILLING_FEATURES.organizationApiKeys.requirementLabel} billing.`) ||
    (!canManageApiKeys && "Only admins and owners can create API keys.") ||
    null;

  return (
    <div className="space-y-6">
      <Button
        className="w-fit text-muted-foreground hover:text-foreground"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={ArrowLeft01Icon} />
        {organization.name}
      </Button>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">API keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatCount(apiKeys.length, "key")}</p>
        </div>

        {manageApiKeysReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />}
            label="Create"
            reason={manageApiKeysReason}
          />
        ) : (
          <CreateApiKeyDialog organizationId={organization.id} />
        )}
      </div>

      <div>
        {apiKeysQuery.isPending ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            Loading API keys…
          </div>
        ) : apiKeysQuery.isError ? (
          <p className="py-6 text-sm text-destructive">
            {apiKeysQuery.error.message ?? "Could not load API keys."}
          </p>
        ) : apiKeys.length > 0 ? (
          apiKeys.map((apiKey) => (
            <ApiKeyRow
              apiKey={apiKey}
              canManageApiKeys={canManageApiKeys}
              key={apiKey.id}
              organizationId={organization.id}
            />
          ))
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No API keys.</p>
        )}
      </div>
    </div>
  );
};
