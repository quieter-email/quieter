import { Add01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
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
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useDeferredValue, useState } from "react";

import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import { useBroadcastWorkspace } from "./broadcast-workspace";

export const AudiencesList = () => {
  const { canManage, organizationId } = useBroadcastWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const querySearch = useDeferredValue(search);
  const [cursor, setCursor] = useState<string>();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const audiences = useQuery({
    queryFn: async () =>
      await rpc.audiences.list({
        cursor,
        limit: 50,
        organizationId,
        search: querySearch,
      }),
    queryKey: ["audiences", organizationId, "list", querySearch, cursor],
  });
  const create = useMutation({
    mutationFn: async () =>
      await rpc.audiences.create({
        description,
        idempotencyKey,
        name,
        organizationId,
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "audiences",
        fallback: "Could not create audience. Please try again.",
      });
    },
    onSuccess: async (audience) => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["audiences", organizationId],
      });
      void navigate({
        params: { audienceId: audience.id },
        search: { organizationId },
        to: "/audiences/$audienceId",
      });
    },
  });
  let audiencesContent: ReactNode;
  if (audiences.isPending) {
    audiencesContent = <SettingsLoadingState label="Loading audiences" />;
  } else if (audiences.isError) {
    audiencesContent = (
      <SettingsErrorState
        message="Could not load audiences."
        onRetry={() => void audiences.refetch()}
      />
    );
  } else if (audiences.data.items.length === 0) {
    audiencesContent = (
      <div className="rounded-lg border border-border px-6 py-14 text-center">
        <HugeiconsIcon
          aria-hidden
          className="mx-auto mb-3 size-6 text-muted-fg"
          icon={UserGroupIcon}
        />
        <p className="text-body text-fg">
          {search ? "No matching audiences" : "Your first audience starts here"}
        </p>
        <p className="mt-1 text-body text-muted-fg">
          {search
            ? "Try a different search."
            : "Create an audience, then add contacts or import a list."}
        </p>
      </div>
    );
  } else {
    audiencesContent = (
      <SettingsRows>
        {audiences.data.items.map((audience) => (
          <SettingsNavigationRow
            key={audience.id}
            title={audience.name}
            description={
              audience.description ||
              `${audience.contactCount.toLocaleString()} contacts`
            }
            meta={`${audience.subscribedCount.toLocaleString()} subscribed`}
            onClick={() =>
              void navigate({
                params: { audienceId: audience.id },
                search: { organizationId },
                to: "/audiences/$audienceId",
              })
            }
          />
        ))}
      </SettingsRows>
    );
  }
  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Audiences"
        action={
          canManage ? (
            <Button
              onClick={() => {
                setName("");
                setDescription("");
                setIdempotencyKey(crypto.randomUUID());
                setOpen(true);
              }}
              size="sm"
            >
              <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
              Create audience
            </Button>
          ) : undefined
        }
      >
        The people who have agreed to hear from your team.
      </SettingsPageHeader>
      <Input
        aria-label="Search audiences"
        onChange={(event) => {
          setSearch(event.target.value);
          setCursor(undefined);
        }}
        placeholder="Search audiences"
        value={search}
      />
      {audiencesContent}
      {cursor || audiences.data?.nextCursor ? (
        <div className="flex justify-end gap-2">
          <Button
            disabled={!cursor}
            onClick={() => {
              setCursor(undefined);
            }}
            size="sm"
            variant="ghost"
          >
            First page
          </Button>
          <Button
            disabled={!audiences.data?.nextCursor}
            onClick={() => {
              setCursor(audiences.data?.nextCursor ?? undefined);
            }}
            size="sm"
            variant="outline"
          >
            Next page
          </Button>
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create audience</DialogTitle>
            </DialogHeader>
            <DialogBody spacing="4">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  maxLength={100}
                  required
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  value={name}
                />
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  maxLength={1000}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                  value={description}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton disabled={create.isPending}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={create.isPending || !name.trim()}
                size="sm"
                type="submit"
              >
                {create.isPending ? "Creating…" : "Create audience"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
