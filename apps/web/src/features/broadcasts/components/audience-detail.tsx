import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  AudienceContact,
  AudienceMembershipStatus,
  AudienceSegmentCriteria,
} from "@quieter/mail/audiences";
import { Button, LinkButton } from "@quieter/ui/button";
import { ContentSection } from "@quieter/ui/content-section";
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
import { Pill } from "@quieter/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Textarea } from "@quieter/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDeferredValue, useState } from "react";

import {
  SettingsCard,
  SettingsErrorState,
  SettingsLoadingState,
  SettingsPageHeader,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import { AudienceContactDialog } from "./audience-contact-dialog";
import { AudienceImportDialog } from "./audience-import-dialog";
import { useBroadcastWorkspace } from "./broadcast-workspace";

type Segment = { id: string; name: string; criteria: AudienceSegmentCriteria };

const SegmentDialog = ({
  audienceId,
  segment,
  onClose,
}: {
  audienceId: string;
  segment?: Segment;
  onClose: () => void;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState(segment?.name ?? "");
  const [allTags, setAllTags] = useState(
    segment?.criteria.allTags.join(", ") ?? ""
  );
  const [anyTags, setAnyTags] = useState(
    segment?.criteria.anyTags.join(", ") ?? ""
  );
  const [excludeTags, setExcludeTags] = useState(
    segment?.criteria.excludeTags.join(", ") ?? ""
  );
  const [deleting, setDeleting] = useState(false);
  const mutation = useMutation({
    mutationFn: async (remove: boolean) => {
      if (remove && segment) {
        return await rpc.audiences.deleteSegment({
          audienceId,
          organizationId,
          segmentId: segment.id,
        });
      }
      const input = {
        audienceId,
        criteria: {
          allTags: allTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          anyTags: anyTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          excludeTags: excludeTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
        name,
        organizationId,
      };
      return segment
        ? await rpc.audiences.updateSegment({ ...input, segmentId: segment.id })
        : await rpc.audiences.createSegment(input);
    },
    onError: (error) => {
      toastError(error, {
        boundary: "audience-segments",
        fallback: "Could not update segment. Please try again.",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["audiences", organizationId],
      });
      onClose();
    },
  });
  let segmentDeleteContent: ReactNode;
  if (deleting) {
    segmentDeleteContent = (
      <div className="space-y-2">
        <p className="text-body text-fg">
          Delete this segment? Contacts stay in the audience.
        </p>
        <Button
          disabled={mutation.isPending}
          onClick={() => {
            mutation.mutate(true);
          }}
          size="sm"
          variant="destructive"
        >
          Confirm delete
        </Button>
      </div>
    );
  } else {
    segmentDeleteContent = segment ? (
      <Button
        onClick={() => {
          setDeleting(true);
        }}
        size="sm"
        variant="ghost"
      >
        Delete segment
      </Button>
    ) : null;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {segment ? "Edit segment" : "Create segment"}
            </DialogTitle>
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
            <p className="text-caption/5 text-muted-fg">
              Separate tags with commas. Contacts must match every rule you fill
              in. Empty rules include everyone.
            </p>
            <Field>
              <FieldLabel>Has all tags</FieldLabel>
              <Input
                onChange={(event) => {
                  setAllTags(event.target.value);
                }}
                value={allTags}
              />
            </Field>
            <Field>
              <FieldLabel>Has any tag</FieldLabel>
              <Input
                onChange={(event) => {
                  setAnyTags(event.target.value);
                }}
                value={anyTags}
              />
            </Field>
            <Field>
              <FieldLabel>Has none of these tags</FieldLabel>
              <Input
                onChange={(event) => {
                  setExcludeTags(event.target.value);
                }}
                value={excludeTags}
              />
            </Field>
            {segmentDeleteContent}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton disabled={mutation.isPending}>
              Cancel
            </DialogCloseButton>
            <Button
              disabled={mutation.isPending || !name.trim()}
              size="sm"
              type="submit"
            >
              Save segment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const EditAudienceDialog = ({
  audienceId,
  initialName,
  initialDescription,
  onClose,
}: {
  audienceId: string;
  initialName: string;
  initialDescription: string;
  onClose: () => void;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const mutation = useMutation({
    mutationFn: async () =>
      await rpc.audiences.update({
        audienceId,
        description,
        name,
        organizationId,
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "audiences",
        fallback: "Could not save audience. Please try again.",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["audiences", organizationId],
      });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit audience</DialogTitle>
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
            <DialogCloseButton disabled={mutation.isPending}>
              Cancel
            </DialogCloseButton>
            <Button
              disabled={mutation.isPending || !name.trim()}
              size="sm"
              type="submit"
            >
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const AudienceDetail = ({ audienceId }: { audienceId: string }) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const [search, setSearch] = useState("");
  const querySearch = useDeferredValue(search);
  const [status, setStatus] = useState<AudienceMembershipStatus | "all">("all");
  const [suppression, setSuppression] = useState<
    "all" | "suppressed" | "clear"
  >("all");
  const [segmentId, setSegmentId] = useState("");
  const [tag, setTag] = useState("");
  const queryTag = useDeferredValue(tag);
  const [cursor, setCursor] = useState<string>();
  const [contactDialog, setContactDialog] = useState<AudienceContact | "new">();
  const [segmentDialog, setSegmentDialog] = useState<Segment | "new">();
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const audience = useQuery({
    queryFn: async () =>
      await rpc.audiences.get({ audienceId, organizationId }),
    queryKey: ["audiences", organizationId, audienceId, "detail"],
  });
  const segments = useQuery({
    queryFn: async () =>
      await rpc.audiences.listSegments({ audienceId, organizationId }),
    queryKey: ["audiences", organizationId, audienceId, "segments"],
  });
  const contacts = useQuery({
    queryFn: async () =>
      await rpc.audiences.listContacts({
        audienceId,
        cursor,
        limit: 50,
        organizationId,
        search: querySearch,
        segmentId: segmentId || undefined,
        status: status === "all" ? undefined : status,
        suppression,
        tag: queryTag || undefined,
      }),
    queryKey: [
      "audiences",
      organizationId,
      audienceId,
      "contacts",
      querySearch,
      status,
      suppression,
      segmentId,
      queryTag,
      cursor,
    ],
  });
  if (audience.isPending) {
    return <SettingsLoadingState label="Loading audience" />;
  }
  if (audience.isError) {
    return (
      <SettingsErrorState
        message="Could not load audience."
        onRetry={() => void audience.refetch()}
      />
    );
  }
  let contactsContent: ReactNode;
  if (contacts.isPending) {
    contactsContent = <SettingsLoadingState label="Loading contacts" />;
  } else {
    contactsContent = contacts.isError ? (
      <SettingsErrorState
        message="Could not load contacts."
        onRetry={() => void contacts.refetch()}
      />
    ) : (
      <SettingsCard>
        <ul className="divide-y divide-border">
          {contacts.data.items.length === 0 ? (
            <li className="px-6 py-10 text-center text-body text-muted-fg">
              No contacts match these filters.
            </li>
          ) : (
            contacts.data.items.map((contact) => (
              <li key={contact.id}>
                <button
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-ring sm:px-6"
                  onClick={() => {
                    setContactDialog(contact);
                  }}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm text-fg">
                      {contact.name || contact.email}
                    </span>
                    {contact.name ? (
                      <span className="block truncate text-caption text-muted-fg">
                        {contact.email}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {contact.tags.map((item) => (
                        <Pill key={item} size="xs">
                          {item}
                        </Pill>
                      ))}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Pill
                      size="xs"
                      tone={contact.status === "subscribed" ? "green" : "gray"}
                    >
                      {contact.status}
                    </Pill>
                    {contact.suppression ? (
                      <Pill size="xs" tone="red">
                        Blocked
                      </Pill>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </SettingsCard>
    );
  }
  return (
    <div className="space-y-8">
      <LinkButton
        search={{ organizationId }}
        size="sm"
        to="/audiences"
        variant="ghost"
      >
        All audiences
      </LinkButton>
      <SettingsPageHeader
        title={audience.data.name}
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setImportOpen(true);
                }}
                size="sm"
                variant="outline"
              >
                Import contacts
              </Button>
              <Button
                onClick={() => {
                  setContactDialog("new");
                }}
                size="sm"
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Add01Icon}
                />
                Add contact
              </Button>
            </div>
          ) : undefined
        }
      >
        {audience.data.description ? <p>{audience.data.description}</p> : null}
        <p>
          {audience.data.subscribedCount.toLocaleString()} subscribed,{" "}
          {audience.data.contactCount.toLocaleString()} contacts
        </p>
      </SettingsPageHeader>
      {canManage ? (
        <Button
          onClick={() => {
            setEditOpen(true);
          }}
          size="sm"
          variant="ghost"
        >
          Edit audience details
        </Button>
      ) : null}
      <ContentSection title="Contacts">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            aria-label="Search contacts"
            onChange={(event) => {
              setSearch(event.target.value);
              setCursor(undefined);
            }}
            placeholder="Search name or email"
            value={search}
          />
          <Select
            items={[
              { label: "All subscriptions", value: "all" },
              { label: "Subscribed", value: "subscribed" },
              { label: "Unsubscribed", value: "unsubscribed" },
              { label: "Removed", value: "removed" },
            ]}
            onValueChange={(value) => {
              if (
                value === "all" ||
                value === "subscribed" ||
                value === "unsubscribed" ||
                value === "removed"
              ) {
                setStatus(value);
                setCursor(undefined);
              }
            }}
            value={status}
          >
            <SelectTrigger aria-label="Subscription status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectList>
                <SelectItem value="all">All subscriptions</SelectItem>
                <SelectItem value="subscribed">Subscribed</SelectItem>
                <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                <SelectItem value="removed">Removed</SelectItem>
              </SelectList>
            </SelectContent>
          </Select>
          <Select
            items={[
              { label: "All safety states", value: "all" },
              { label: "Blocked", value: "suppressed" },
              { label: "No safety block", value: "clear" },
            ]}
            onValueChange={(value) => {
              if (
                value === "all" ||
                value === "suppressed" ||
                value === "clear"
              ) {
                setSuppression(value);
                setCursor(undefined);
              }
            }}
            value={suppression}
          >
            <SelectTrigger aria-label="Safety block">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectList>
                <SelectItem value="all">All safety states</SelectItem>
                <SelectItem value="suppressed">Blocked</SelectItem>
                <SelectItem value="clear">No safety block</SelectItem>
              </SelectList>
            </SelectContent>
          </Select>
          <Input
            aria-label="Filter by tag"
            onChange={(event) => {
              setTag(event.target.value);
              setCursor(undefined);
            }}
            placeholder="Filter by tag"
            value={tag}
          />
          <Select
            items={[
              { label: "All segments", value: "" },
              ...(segments.data?.map((segment) => ({
                label: segment.name,
                value: segment.id,
              })) ?? []),
            ]}
            onValueChange={(value) => {
              setSegmentId(value ?? "");
              setCursor(undefined);
            }}
            value={segmentId}
          >
            <SelectTrigger aria-label="Filter by segment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectList>
                <SelectItem value="">All segments</SelectItem>
                {segments.data?.map((segment) => (
                  <SelectItem key={segment.id} value={segment.id}>
                    {segment.name}
                  </SelectItem>
                ))}
              </SelectList>
            </SelectContent>
          </Select>
        </div>
        {contactsContent}
        {cursor || contacts.data?.nextCursor ? (
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
              disabled={!contacts.data?.nextCursor}
              onClick={() => {
                setCursor(contacts.data?.nextCursor ?? undefined);
              }}
              size="sm"
              variant="outline"
            >
              Next page
            </Button>
          </div>
        ) : null}
      </ContentSection>
      <ContentSection
        title="Segments"
        description="Saved tag rules keep each campaign's audience easy to review."
      >
        {segments.isError ? (
          <SettingsErrorState
            message="Could not load segments."
            onRetry={() => void segments.refetch()}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {segments.data?.map((segment) => (
              <Button
                key={segment.id}
                onClick={() => {
                  if (canManage) {
                    setSegmentDialog(segment);
                  } else {
                    setSegmentId(segment.id);
                    setCursor(undefined);
                  }
                }}
                size="sm"
                variant="outline"
              >
                {segment.name}
              </Button>
            ))}
            {canManage ? (
              <Button
                onClick={() => {
                  setSegmentDialog("new");
                }}
                size="sm"
                variant="ghost"
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Add01Icon}
                />
                Create segment
              </Button>
            ) : null}
            {segments.data?.length === 0 && !canManage ? (
              <p className="text-body text-muted-fg">No saved segments.</p>
            ) : null}
          </div>
        )}
      </ContentSection>
      {contactDialog === undefined ? null : (
        <AudienceContactDialog
          audienceId={audienceId}
          contact={contactDialog === "new" ? undefined : contactDialog}
          onClose={() => {
            setContactDialog(undefined);
          }}
        />
      )}
      {segmentDialog === undefined ? null : (
        <SegmentDialog
          audienceId={audienceId}
          segment={segmentDialog === "new" ? undefined : segmentDialog}
          onClose={() => {
            setSegmentDialog(undefined);
          }}
        />
      )}
      {importOpen ? (
        <AudienceImportDialog
          audienceId={audienceId}
          open
          onOpenChange={setImportOpen}
        />
      ) : null}
      {editOpen ? (
        <EditAudienceDialog
          audienceId={audienceId}
          initialName={audience.data.name}
          initialDescription={audience.data.description ?? ""}
          onClose={() => {
            setEditOpen(false);
          }}
        />
      ) : null}
    </div>
  );
};
