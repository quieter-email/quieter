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
} from "@quietr/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import { getErrorMessage, unwrapResultError } from "~/lib/errors";
import { useTRPC } from "~/lib/trpc";

type SettingsUser = {
  email: string;
  name: string;
};

type PlaceholderPreview = {
  createdAt: number;
  email: string;
  token: string;
  type: "magic-link" | "verification";
  url: string;
};

type AccountSettingsPanelProps = {
  initialUser: SettingsUser;
};

type SettingsRowProps = {
  action: ReactNode;
  label: string;
  value: ReactNode;
};

const formatPasskeyDate = (value: AuthPasskey["createdAt"]) => {
  if (!value) return "Recently added";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently added";

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
};

const SettingsRow = ({ action, label, value }: SettingsRowProps) => (
  <div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 py-5 last:border-b-0 md:flex-row md:items-center">
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 text-sm text-muted-foreground">{value}</div>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);

const EditNameDialog = ({
  currentName,
  onSessionRefresh,
}: {
  currentName: string;
  onSessionRefresh: () => Promise<unknown>;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(currentName);
  const [open, setOpen] = useState(false);
  const updateUserMutation = useMutation({
    mutationFn: async (input: { name: string }) =>
      unwrapResultError(await authClient.updateUser(input), "Could not update name."),
    mutationKey: ["auth", "update-user"],
  });

  const openDialog = () => {
    setError(null);
    setName(currentName);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setName(currentName);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Name cannot be empty.");
      return;
    }

    try {
      await updateUserMutation.mutateAsync({ name: trimmedName });
      await onSessionRefresh();
      handleOpenChange(false);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not update name."));
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Edit name
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit name</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave}>
            <DialogBody className="space-y-3">
              <TextField>
                <TextFieldInput
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </TextField>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PlaceholderPreview | null>(null);
  const [value, setValue] = useState(currentEmail);
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const changeEmailMutation = useMutation({
    mutationFn: async (input: { callbackURL: string; newEmail: string }) => {
      const status = await queryClient.fetchQuery(
        trpc.auth.getUserStatus.queryOptions(
          { email: input.newEmail },
          {
            staleTime: 0,
          },
        ),
      );

      if (status.exists) {
        throw new Error("That email already has an account.");
      }

      unwrapResultError(await authClient.changeEmail(input), "Could not start email change.");

      return await queryClient.fetchQuery(
        trpc.auth.getEmailPreview.queryOptions(
          { email: input.newEmail },
          {
            staleTime: 0,
          },
        ),
      );
    },
  });

  const openDialog = () => {
    setError(null);
    setPreview(null);
    setValue(currentEmail);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setPreview(null);
      setValue(currentEmail);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPreview(null);

    const nextEmail = value.trim().toLowerCase();
    if (nextEmail.length === 0) {
      setError("Email is required.");
      return;
    }

    if (nextEmail === currentEmail.toLowerCase()) {
      setError("Enter a different email.");
      return;
    }

    try {
      const nextPreview = await changeEmailMutation.mutateAsync({
        callbackURL: "/settings?tab=account",
        newEmail: nextEmail,
      });
      setPreview(nextPreview);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not start email change."));
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
        Edit mail
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit mail</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave}>
            <DialogBody className="space-y-3">
              <TextField>
                <TextFieldInput
                  autoFocus
                  onChange={(event) => setValue(event.target.value)}
                  type="email"
                  value={value}
                />
              </TextField>
              {preview ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">Placeholder verification link</p>
                  <a className="break-all underline" href={preview.url}>
                    {preview.url}
                  </a>
                </div>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const addPasskeyMutation = useMutation({
    mutationFn: async (name: string) =>
      unwrapResultError(
        await authClient.passkey.addPasskey({
          name: name.trim() || undefined,
        }),
        "Could not create a passkey.",
      ),
    mutationKey: ["auth", "passkeys", "add"],
  });
  const deletePasskeyMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      const response = await authClient.$fetch("/passkey/delete-passkey", {
        body: input,
        method: "POST",
        throw: false,
      });

      return unwrapResultError(response, "Could not remove the passkey.");
    },
    mutationKey: ["auth", "passkeys", "delete"],
  });

  const supportsPasskeys =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof window.isSecureContext !== "undefined" &&
    window.isSecureContext;

  const openDialog = () => {
    setError(null);
    setLabel("");
    setRemovingPasskeyId(null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setLabel("");
      setRemovingPasskeyId(null);
    }
  };

  const handlePasskeyCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!supportsPasskeys) {
      setError("Passkeys are not supported in this browser.");
      return;
    }

    try {
      await addPasskeyMutation.mutateAsync(label);
      setLabel("");
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not create a passkey."));
    }
  };

  const handlePasskeyDelete = async (passkeyId: string) => {
    setError(null);
    try {
      setRemovingPasskeyId(passkeyId);
      await deletePasskeyMutation.mutateAsync({ id: passkeyId });
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not remove the passkey."));
    } finally {
      setRemovingPasskeyId(null);
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
        Edit passkeys
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit passkeys</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <form className="space-y-3" onSubmit={handlePasskeyCreate}>
              <TextField>
                <TextFieldInput
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Passkey label"
                  value={label}
                />
              </TextField>

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
                <p className="text-sm text-muted-foreground">Loading passkeys...</p>
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

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const deleteAccountMutation = useMutation({
    mutationFn: async () =>
      unwrapResultError(
        await authClient.deleteUser({
          callbackURL: "/home",
        }),
        "Could not delete the account.",
      ),
    mutationKey: ["auth", "delete-user"],
    onSuccess: () => {
      queryClient.clear();
      router.push("/home");
    },
  });

  const openDialog = () => {
    setConfirmation("");
    setError(null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmation("");
      setError(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmation.trim().toLowerCase() !== "delete my account") {
      setError('Type "delete my account".');
      return;
    }

    setError(null);

    try {
      await deleteAccountMutation.mutateAsync();
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, "Could not delete the account."));
    }
  };

  return (
    <>
      <Button onClick={openDialog} size="sm" variant="destructive">
        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
        Delete account
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">delete my account</span>
            </p>
            <TextField>
              <TextFieldInput
                autoFocus
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="delete my account"
                value={confirmation}
              />
            </TextField>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton disabled={deleteAccountMutation.isPending}>Cancel</DialogCloseButton>
            <Button
              disabled={deleteAccountMutation.isPending}
              onClick={() => void handleDeleteAccount()}
              size="sm"
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
        </DialogContent>
      </Dialog>
    </>
  );
};

export const AccountSettingsPanel = ({ initialUser }: AccountSettingsPanelProps) => {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const sessionState = authClient.useSession();
  const passkeysState = authClient.useListPasskeys();
  const sessionUser = sessionState.data?.user;
  const user = {
    email: sessionUser?.email ?? initialUser.email,
    name: sessionUser?.name ?? initialUser.name,
  };
  const passkeys = passkeysState.data ?? [];
  const signOutMutation = useMutation({
    mutationFn: async () => unwrapResultError(await authClient.signOut(), "Could not sign out."),
    mutationKey: ["auth", "sign-out"],
    onSuccess: () => {
      queryClient.clear();
      router.push("/home");
    },
  });

  const handleSignOut = async () => {
    setSessionError(null);
    try {
      await signOutMutation.mutateAsync();
    } catch (mutationError) {
      setSessionError(getErrorMessage(mutationError, "Could not sign out."));
    }
  };

  return (
    <div>
      <div className="pb-8">
        <h1 className="text-2xl font-medium tracking-tight text-foreground">{user.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
        {sessionError ? <p className="mt-4 text-sm text-destructive">{sessionError}</p> : null}
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
