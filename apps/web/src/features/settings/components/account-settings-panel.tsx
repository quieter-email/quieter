"use client";

import type { Passkey as AuthPasskey } from "@better-auth/passkey";
import type { ReactNode } from "react";
import {
  Delete02Icon,
  Edit01Icon,
  Key02Icon,
  Loading03Icon,
  Logout03Icon,
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
  TextField,
  TextFieldInput,
} from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { orpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";

type SettingsUser = {
  email: string;
  name: string;
};

type AccountSettingsPanelProps = {
  initialUser: SettingsUser;
};

const SettingsRow = ({
  action,
  label,
  value,
}: {
  action: ReactNode;
  label: string;
  value: ReactNode;
}) => (
  <div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 py-5 last:border-b-0 md:flex-row md:items-center">
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 text-sm text-muted-foreground">{value}</div>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);

const passkeyDateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

const formatPasskeyDate = (value: AuthPasskey["createdAt"]) => {
  if (!value) return "Recently added";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently added";

  return passkeyDateFormatter.format(date);
};

const EditNameDialog = ({
  currentName,
  onSessionRefresh,
}: {
  currentName: string;
  onSessionRefresh: () => Promise<unknown>;
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const updateUserMutation = useMutation({
    mutationFn: async (input: { name: string }) => {
      const response = await authClient.updateUser(input);
      if (response.error) {
        throw new Error(response.error.message ?? "Could not update name.");
      }
      return response;
    },
    mutationKey: ["auth", "update-user"],
    onSuccess: async () => {
      await onSessionRefresh();
      await queryClient.invalidateQueries();
    },
  });
  const form = useForm({
    defaultValues: {
      name: currentName,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        await updateUserMutation.mutateAsync({ name: value.name.trim() });
        setOpen(false);
        resetDialog();
      } catch (mutationError) {
        setSubmitError(
          (mutationError as { message?: string })?.message ?? "Could not update name.",
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        name: z.string().trim().min(1, "Name cannot be empty."),
      }),
    },
  });
  const resetDialog = () => {
    setSubmitError(null);
    form.reset({ name: currentName });
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
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Edit name
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
            <DialogTitle>Edit name</DialogTitle>
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
              <DialogCloseButton disabled={updateUserMutation.isPending}>Cancel</DialogCloseButton>
              <Button disabled={updateUserMutation.isPending} size="sm" type="submit">
                {updateUserMutation.isPending ? (
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

const EditEmailDialog = ({ currentEmail }: { currentEmail: string }) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const changeEmailMutation = useMutation({
    mutationFn: async (input: { callbackURL: string; newEmail: string }) => {
      const status = await queryClient.fetchQuery(
        orpc.auth.getUserStatus.queryOptions({
          input: { email: input.newEmail },
          staleTime: 0,
        }),
      );

      if (status.exists) {
        throw new Error("That email already has an account.");
      }

      const response = await authClient.changeEmail(input);
      if (response.error) {
        throw new Error(response.error.message ?? "Could not start email change.");
      }
      return response;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const form = useForm({
    defaultValues: {
      email: currentEmail,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        await changeEmailMutation.mutateAsync({
          callbackURL: "/settings?tab=account",
          newEmail: value.email.trim().toLowerCase(),
        });
      } catch (mutationError) {
        setSubmitError(
          (mutationError as { message?: string })?.message ?? "Could not start email change.",
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z
          .string()
          .trim()
          .min(1, "Email is required.")
          .email("Enter a valid email.")
          .regex(
            new RegExp(
              `^(?!${currentEmail.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$).+$`,
              "i",
            ),
            "Enter a different email.",
          ),
      }),
    },
  });
  const resetDialog = () => {
    setSubmitError(null);
    form.reset({ email: currentEmail });
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
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Edit mail
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
            <DialogTitle>Edit mail</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <form.Field name="email">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={field.state.meta.errors.length > 0}
                      autoCapitalize="none"
                      autoCorrect="off"
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      type="email"
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
              <DialogCloseButton disabled={changeEmailMutation.isPending}>Cancel</DialogCloseButton>
              <Button disabled={changeEmailMutation.isPending} size="sm" type="submit">
                {changeEmailMutation.isPending ? (
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

const PasskeysDialog = ({
  isPasskeysPending,
  passkeys,
}: {
  isPasskeysPending: boolean;
  passkeys: AuthPasskey[];
}) => {
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const addPasskeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      });
      if (response?.error) {
        throw new Error(response.error.message ?? "Could not create a passkey.");
      }
      return response;
    },
    mutationKey: ["auth", "passkeys", "add"],
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const deletePasskeyMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      const response = (await authClient.$fetch("/passkey/delete-passkey", {
        body: input,
        method: "POST",
        throw: false,
      })) as { error?: { message?: string } };

      if (response.error) {
        throw new Error(response.error.message ?? "Could not remove the passkey.");
      }
      return response;
    },
    mutationKey: ["auth", "passkeys", "delete"],
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const supportsPasskeys =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof window.isSecureContext !== "undefined" &&
    window.isSecureContext;
  const form = useForm({
    defaultValues: {
      label: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      if (!supportsPasskeys) {
        setSubmitError("Passkeys are not supported in this browser.");
        return;
      }

      try {
        await addPasskeyMutation.mutateAsync(value.label);
        form.reset({ label: "" });
      } catch (mutationError) {
        setSubmitError(
          (mutationError as { message?: string })?.message ?? "Could not create a passkey.",
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        label: z.string(),
      }),
    },
  });
  const resetDialog = () => {
    setSubmitError(null);
    setRemovingPasskeyId(null);
    form.reset({ label: "" });
  };

  const handlePasskeyDelete = async (passkeyId: string) => {
    setSubmitError(null);
    try {
      setRemovingPasskeyId(passkeyId);
      await deletePasskeyMutation.mutateAsync({ id: passkeyId });
      setRemovingPasskeyId(null);
    } catch (mutationError) {
      setSubmitError(
        (mutationError as { message?: string })?.message ?? "Could not remove the passkey.",
      );
      setRemovingPasskeyId(null);
    }
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
        <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
        Edit passkeys
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
            <DialogTitle>Edit passkeys</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <form
              className="space-y-3"
              action={async () => {
                await form.handleSubmit();
              }}
            >
              <form.Field name="label">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="Passkey label"
                      value={field.state.value}
                    />
                  </TextField>
                )}
              </form.Field>

              <Button
                disabled={addPasskeyMutation.isPending || !supportsPasskeys}
                size="sm"
                type="submit"
              >
                {addPasskeyMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
                )}
                Add passkey
              </Button>
            </form>

            <div className="space-y-3">
              {isPasskeysPending ? (
                <p className="text-sm text-muted-foreground">Loading passkeys…</p>
              ) : passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No passkeys.</p>
              ) : (
                passkeys.map((passkey) => (
                  <div className="flex items-center justify-between gap-4" key={passkey.id}>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {passkey.name?.trim() || passkey.deviceType}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatPasskeyDate(passkey.createdAt)}
                      </p>
                    </div>

                    <Button
                      disabled={removingPasskeyId === passkey.id}
                      onClick={() => void handlePasskeyDelete(passkey.id)}
                      size="sm"
                      variant="outline"
                    >
                      {removingPasskeyId === passkey.id ? (
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
                  </div>
                ))
              )}
            </div>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton>Close</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const DeleteAccountDialog = () => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.deleteUser({
        callbackURL: "/home",
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not delete the account.");
      }
      return response;
    },
    mutationKey: ["auth", "delete-user"],
    onSuccess: async () => {
      queryClient.clear();
      await queryPersister.removeQueries();
      await navigate({
        to: "/home",
      });
    },
  });
  const form = useForm({
    defaultValues: {
      confirmation: "",
    },
    onSubmit: async () => {
      setSubmitError(null);

      try {
        await deleteAccountMutation.mutateAsync();
      } catch (mutationError) {
        setSubmitError(
          (mutationError as { message?: string })?.message ?? "Could not delete the account.",
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
          .regex(/^delete my account$/, 'Type "delete my account".'),
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
        Delete account
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
            <DialogTitle>Delete account</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-medium text-foreground">delete my account</span>
              </p>

              <form.Field name="confirmation">
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
                      placeholder="delete my account"
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
              <DialogCloseButton disabled={deleteAccountMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={deleteAccountMutation.isPending}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {deleteAccountMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
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

export const AccountSettingsPanel = ({ initialUser }: AccountSettingsPanelProps) => {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sessionState = authClient.useSession();
  const passkeysState = authClient.useListPasskeys();
  const sessionUser = sessionState.data?.user;
  const user = {
    email: sessionUser?.email ?? initialUser.email,
    name: sessionUser?.name ?? initialUser.name,
  };
  const passkeys = passkeysState.data ?? [];
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signOut();
      if (response.error) {
        throw new Error(response.error.message ?? "Could not sign out.");
      }
      return response;
    },
    mutationKey: ["auth", "sign-out"],
    onSuccess: async () => {
      queryClient.clear();
      await queryPersister.removeQueries();
      await navigate({
        to: "/home",
      });
    },
  });

  const handleSignOut = async () => {
    setSessionError(null);
    try {
      await signOutMutation.mutateAsync();
    } catch (mutationError) {
      setSessionError((mutationError as { message?: string })?.message ?? "Could not sign out.");
    }
  };

  return (
    <div>
      <div className="pb-8">
        <h1 className="text-2xl font-medium tracking-tight text-foreground">{user.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
        {sessionError && <p className="mt-4 text-sm text-destructive">{sessionError}</p>}
      </div>

      <div>
        <SettingsRow
          action={
            <EditNameDialog currentName={user.name} onSessionRefresh={sessionState.refetch} />
          }
          label="Name"
          value={user.name}
        />

        <SettingsRow
          action={<EditEmailDialog currentEmail={user.email} />}
          label="Mail"
          value={user.email}
        />

        <SettingsRow
          action={
            <PasskeysDialog isPasskeysPending={passkeysState.isPending} passkeys={passkeys} />
          }
          label="Passkeys"
          value={passkeys.length === 1 ? "1 passkey" : `${passkeys.length} passkeys`}
        />

        <SettingsRow
          action={
            <Button
              disabled={signOutMutation.isPending}
              onClick={() => void handleSignOut()}
              size="sm"
              variant="outline"
            >
              {signOutMutation.isPending ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />
              )}
              Sign out
            </Button>
          }
          label="Session"
          value="Current browser session"
        />

        <SettingsRow action={<DeleteAccountDialog />} label="Delete account" value="Permanent" />
      </div>
    </div>
  );
};
