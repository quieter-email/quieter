import { ORPCError } from "@orpc/server";
import {
  getOutlookDeltaPage,
  getOutlookMessage,
  getOutlookSystemFolders,
  listOutlookMailFolders,
  OutlookGraphError,
  outlookMessageSchema,
} from "@quieter/outlook/graph";
import type { OutlookMessagePatch } from "@quieter/outlook/graph";

import { createOutlookProjection, outlookProjectionSchema } from "./projection";
import type { OutlookProjection } from "./projection";

export type OutlookSyncSliceResult =
  | { kind: "idle" }
  | { folders: number; kind: "discovery" }
  | {
      changes: number;
      complete: boolean;
      folders: number;
      kind: "messages";
    }
  | {
      folders: number;
      kind: "reconcile";
      reason: "concurrent" | "cursor_expired";
    };

export const mergeOutlookDeltaProjection = (input: {
  patch: OutlookMessagePatch;
  previous: OutlookProjection | null;
}): OutlookProjection | null => {
  const { patch, previous } = input;
  if (previous !== null && previous.message.id !== patch.id) {
    throw new OutlookGraphError("invalid_response");
  }
  if (
    patch.changeKey === undefined ||
    (previous !== null && previous.message.changeKey !== patch.changeKey)
  ) {
    return null;
  }
  const merged = outlookMessageSchema.safeParse({
    ...previous?.message,
    ...patch,
    body: previous?.message.body,
    internetMessageHeaders: previous?.message.internetMessageHeaders,
  });
  if (!merged.success) {
    return null;
  }
  if (previous !== null && previous.message.changeKey === patch.changeKey) {
    return outlookProjectionSchema.parse({ ...previous, message: merged.data });
  }
  return createOutlookProjection({ kind: "metadata", message: merged.data });
};

export const syncOutlookMailbox = async (input: {
  mailboxId: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<OutlookSyncSliceResult> => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  const { runAuthorizedOutlookMailbox } = await import("./auth");
  const storage = await import("./storage");
  return await runAuthorizedOutlookMailbox(
    { ...input, signal },
    async (context, identity) => {
      const scope = {
        generation: identity.generation,
        mailboxId: input.mailboxId,
        userId: input.userId,
      };
      const state = await storage.readOutlookSyncState(scope);
      const systemFolders =
        state?.systemFolders ?? (await getOutlookSystemFolders(context));
      const discovery = await storage.claimOutlookDiscovery({
        scope,
        systemFolders,
      });
      let folders = 0;
      if (discovery !== null) {
        try {
          const page = await listOutlookMailFolders(context, {
            pageUrl: discovery.cursor ?? undefined,
            parentFolderId: discovery.activeParentFolderId ?? undefined,
          });
          signal.throwIfAborted();
          await storage.commitOutlookDiscovery({ lease: discovery, page });
          folders = page.values.length;
        } catch (error) {
          const resetCursor =
            error instanceof OutlookGraphError &&
            error.code === "invalid_cursor";
          await storage.releaseOutlookDiscovery({
            lease: discovery,
            resetCursor,
          });
          if (resetCursor) {
            return { folders, kind: "reconcile", reason: "cursor_expired" };
          }
          if (error instanceof ORPCError && error.code === "CONFLICT") {
            return { folders, kind: "reconcile", reason: "concurrent" };
          }
          throw error;
        }
      }
      signal.throwIfAborted();
      const lease = await storage.claimOutlookMessageSlice({ scope });
      if (lease === null) {
        return discovery === null
          ? { kind: "idle" }
          : { folders, kind: "discovery" };
      }
      try {
        const page = await getOutlookDeltaPage(context, {
          cursor: lease.cursor ?? undefined,
          folderId: lease.folderId,
        });
        if (page.changes.length > 50) {
          throw new OutlookGraphError("invalid_response");
        }
        const changes: Parameters<
          typeof storage.commitOutlookMessagePage
        >[0]["changes"] = [];
        const occurrences = new Map<string, number>();
        for (const change of page.changes) {
          const messageId =
            change.kind === "removed" ? change.id : change.message.id;
          occurrences.set(messageId, (occurrences.get(messageId) ?? 0) + 1);
        }
        const staged = new Set<string>();
        for (const change of page.changes) {
          signal.throwIfAborted();
          const messageId =
            change.kind === "removed" ? change.id : change.message.id;
          const repeated = (occurrences.get(messageId) ?? 0) > 1;
          if (staged.has(messageId)) {
            continue;
          }
          const previous = await storage.getOutlookCachedMessage(
            scope,
            messageId
          );
          let projection =
            change.kind === "removed" || repeated
              ? null
              : mergeOutlookDeltaProjection({
                  patch: change.message,
                  previous,
                });
          if (projection === null) {
            try {
              const message = await getOutlookMessage(context, { messageId });
              projection =
                previous?.message.changeKey === message.changeKey
                  ? mergeOutlookDeltaProjection({ patch: message, previous })
                  : createOutlookProjection({ kind: "metadata", message });
              if (projection === null) {
                throw new OutlookGraphError("invalid_response");
              }
            } catch (error) {
              if (
                !(error instanceof OutlookGraphError) ||
                error.code !== "not_found"
              ) {
                throw error;
              }
              staged.add(messageId);
              changes.push({ kind: "removed", messageId });
              continue;
            }
          }
          staged.add(messageId);
          if (projection.message.parentFolderId === lease.folderId) {
            changes.push({ kind: "message", projection });
          } else {
            changes.push({ kind: "removed", messageId });
          }
        }
        signal.throwIfAborted();
        await storage.commitOutlookMessagePage({
          changes,
          continuation: page.continuation,
          lease,
        });
        return {
          changes: changes.length,
          complete: page.continuation.kind === "delta",
          folders,
          kind: "messages",
        };
      } catch (error) {
        const resetCursor =
          error instanceof OutlookGraphError && error.code === "invalid_cursor";
        await storage.releaseOutlookMessageSlice({ lease, resetCursor });
        if (resetCursor) {
          return { folders, kind: "reconcile", reason: "cursor_expired" };
        }
        if (error instanceof ORPCError && error.code === "CONFLICT") {
          return { folders, kind: "reconcile", reason: "concurrent" };
        }
        throw error;
      }
    }
  );
};
