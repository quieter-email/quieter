import { describe, expect, it } from "vite-plus/test";

import { visibleSyncChanges } from "../src/protocol";
import type { SyncChange } from "../src/protocol";

describe("mailbox stream audiences", () => {
  it("filters private records while preserving public changes and tombstones", () => {
    const personal: SyncChange = {
      data: {
        kind: "saved-view",
        value: {
          color: null,
          createdAt: "2026-09-09T00:00:00Z",
          disabledReason: null,
          icon: null,
          id: "view",
          name: "Personal",
          normalizedName: "personal",
          ownerUserId: "owner",
          position: 0,
          search: { filters: [], text: "" },
          sort: "newest",
          updatedAt: "2026-09-09T00:00:00Z",
        },
      },
      id: "view",
      kind: "saved-view",
      version: "1",
    };
    const publicChange: SyncChange = {
      data: { kind: "label", value: { id: "label", name: "Work" } },
      id: "label",
      kind: "label",
      version: "1",
    };
    const deletion: SyncChange = {
      data: null,
      id: "old",
      kind: "saved-view",
      version: "1",
    };
    expect(
      visibleSyncChanges([personal, publicChange, deletion], "reader")
    ).toStrictEqual([publicChange, deletion]);
    expect(visibleSyncChanges([personal], "owner")).toStrictEqual([personal]);
  });
});
