import { toastError } from "@quieter/app/lib/error-toast";
import { getLabelsQueryKey } from "@quieter/app/lib/mail/labels-query";
import { rpc } from "@quieter/app/lib/orpc";
import { mailboxLabelSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import type { RouterInputs } from "@quieter/orpc";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { getLabelUpdates } from "./label-update-mutation";

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    rpc: {
      ...original.rpc,
      mail: {
        ...original.rpc.mail,
        updateLabel: vi.fn<typeof rpc.mail.updateLabel>(),
      },
    },
  };
});
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<typeof toastError>(),
}));

const label = mailboxLabelSchema.parse({
  autoLabel: {
    domains: [],
    enabled: true,
    keywordScope: "anywhere",
    keywords: ["project"],
    matchMode: "all",
    prompt: "Keep work together",
    senders: [],
  },
  color: "blue",
  description: "Work messages",
  id: "work",
  inclusionCriteria: "Project updates",
  name: "Work",
  position: 2,
  provider: "managed",
  type: "user",
  visible: true,
});

const clients: QueryClient[] = [];

const createHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  clients.push(queryClient);
  const records = new Map<string, MailboxLabel[]>();
  const requests: {
    input: RouterInputs["mail"]["updateLabel"];
    gate: ReturnType<typeof Promise.withResolvers<null>>;
  }[] = [];
  const active = new Map<string, number>();
  const activity = { maximumActive: 0 };

  vi.mocked(rpc.mail.updateLabel).mockImplementation(async (input) => {
    const gate = Promise.withResolvers<null>();
    requests.push({ gate, input });
    const count = (active.get(input.mailboxId) ?? 0) + 1;
    active.set(input.mailboxId, count);
    activity.maximumActive = Math.max(activity.maximumActive, count);
    try {
      await gate.promise;
      const labels = records.get(input.mailboxId) ?? [];
      const original = labels.find((entry) => entry.id === input.labelId);
      if (!original) {
        throw new Error("Missing test label.");
      }
      const updated = mailboxLabelSchema.parse({ ...original, ...input });
      records.set(
        input.mailboxId,
        labels.map((entry) => (entry.id === updated.id ? updated : entry))
      );
      return updated;
    } finally {
      active.set(input.mailboxId, count - 1);
    }
  });

  return {
    active,
    activity,
    mailbox: (mailboxId: string) => {
      records.set(mailboxId, [structuredClone(label)]);
      const queryKey = getLabelsQueryKey(mailboxId);
      queryClient.setQueryDefaults(queryKey, {
        queryFn: () => records.get(mailboxId),
      });
      queryClient.setQueryData(queryKey, records.get(mailboxId));
      const updates = getLabelUpdates({
        mailboxId,
        mailboxProvider: "managed",
        queryClient,
      });
      return {
        observer: new MutationObserver(queryClient, updates.options),
        queryKey,
        updates,
      };
    },
    queryClient,
    records,
    requests,
  };
};

describe("label saves", () => {
  afterEach(() => {
    for (const client of clients) {
      client.clear();
    }
    clients.length = 0;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("serializes repeated colors across remounts and allows a pending choice to be reverted", async () => {
    const harness = createHarness();
    const { observer, updates } = harness.mailbox("mailbox");
    const first = observer.mutate({
      change: { color: "red", kind: "color" },
      labelId: label.id,
    });
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(1);
    });
    const remounted = getLabelUpdates({
      mailboxId: "mailbox",
      mailboxProvider: "managed",
      queryClient: harness.queryClient,
    });
    const nextObserver = new MutationObserver(
      harness.queryClient,
      remounted.options
    );
    const second = nextObserver.mutate({
      change: { color: "blue", kind: "color" },
      labelId: label.id,
    });
    await vi.waitFor(() => {
      expect(updates.state.get().pending).toHaveLength(2);
    });
    expect(updates.project([label], updates.state.get())).toContainEqual(
      expect.objectContaining({ color: "blue" })
    );

    harness.requests[0]?.gate.resolve(null);
    await first;
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(2);
    });
    expect(remounted.project([label], remounted.state.get())).toContainEqual(
      expect.objectContaining({ color: "blue" })
    );
    harness.requests[1]?.gate.resolve(null);
    await second;
    expect(harness.activity.maximumActive).toBe(1);
    expect(harness.records.get("mailbox")).toContainEqual(
      expect.objectContaining({ color: "blue", name: "Work" })
    );
  });

  test("continues after a rejected rename without silently renaming the next color save", async () => {
    const harness = createHarness();
    const { observer, updates } = harness.mailbox("mailbox");
    const first = observer.mutate({
      change: { kind: "name", name: "Rejected" },
      labelId: label.id,
    });
    const failureResult = Promise.allSettled([first]);
    const second = observer.mutate({
      change: { color: "orange", kind: "color" },
      labelId: label.id,
    });
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(1);
    });
    const failure = new Error("Rename failed.");
    harness.requests[0]?.gate.reject(failure);
    await expect(failureResult).resolves.toContainEqual(
      expect.objectContaining({ reason: failure, status: "rejected" })
    );
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(2);
    });
    expect(
      harness.requests.find(({ input }) => input.color)?.input
    ).toMatchObject({
      color: "orange",
      name: "Work",
    });
    expect(updates.project([label], updates.state.get())).toContainEqual(
      expect.objectContaining({ color: "orange", name: "Work" })
    );
    harness.requests[1]?.gate.resolve(null);
    await second;
    expect(toastError).toHaveBeenCalledWith(failure, expect.any(Object));
    expect(harness.records.get("mailbox")).toContainEqual(
      expect.objectContaining({ color: "orange", name: "Work" })
    );
  });

  test("keeps equal label IDs in separate mailboxes independent", async () => {
    const harness = createHarness();
    const left = harness.mailbox("left");
    const right = harness.mailbox("right");
    const first = left.observer.mutate({
      change: { kind: "name", name: "Left" },
      labelId: label.id,
    });
    const second = right.observer.mutate({
      change: { color: "green", kind: "color" },
      labelId: label.id,
    });
    await vi.waitFor(() => {
      expect(harness.active.get("left")).toBe(1);
    });
    await vi.waitFor(() => {
      expect(harness.active.get("right")).toBe(1);
    });
    expect(
      right.updates.project([label], right.updates.state.get())
    ).toContainEqual(expect.objectContaining({ color: "green", name: "Work" }));
    for (const request of harness.requests) {
      request.gate.resolve(null);
    }
    await Promise.all([first, second]);
    expect(harness.records.get("left")).toContainEqual(
      expect.objectContaining({ color: "blue", name: "Left" })
    );
    expect(harness.records.get("right")).toContainEqual(
      expect.objectContaining({ color: "green", name: "Work" })
    );
  });
});
