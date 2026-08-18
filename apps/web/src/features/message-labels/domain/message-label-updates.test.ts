import { describe, expect, it } from "vite-plus/test";

import {
  getMessageLabelSelection,
  getMessageLabelUpdates,
} from "./message-label-updates";

describe(getMessageLabelSelection, () => {
  it("reports how many of the selected conversations already carry a label", () => {
    const targets = [
      { id: "thread-1", labelIds: ["shared", "first-only"] },
      { id: "thread-2", labelIds: ["shared"] },
    ];

    expect(getMessageLabelSelection(targets, "shared")).toBe("all");
    expect(getMessageLabelSelection(targets, "first-only")).toBe("some");
    expect(getMessageLabelSelection(targets, "unused")).toBe("none");
  });

  it("reports no selection when nothing is targeted", () => {
    expect(getMessageLabelSelection([], "shared")).toBe("none");
  });
});

describe(getMessageLabelUpdates, () => {
  it("adds and removes labels only where each selected conversation needs a change", () => {
    expect(
      getMessageLabelUpdates(
        [
          { id: "thread-1", labelIds: ["shared", "first-only"] },
          { id: "thread-2", labelIds: ["shared", "second-only"] },
        ],
        { "first-only": true, "second-only": false, shared: false }
      )
    ).toStrictEqual([
      {
        addLabelIds: [],
        id: "thread-1",
        removeLabelIds: ["shared"],
      },
      {
        addLabelIds: ["first-only"],
        id: "thread-2",
        removeLabelIds: ["second-only", "shared"],
      },
    ]);
  });

  it("does not emit updates for untouched or already matching labels", () => {
    expect(
      getMessageLabelUpdates(
        [
          { id: "thread-1", labelIds: ["existing"] },
          { id: "thread-2", labelIds: [] },
        ],
        { existing: true }
      )
    ).toStrictEqual([
      { addLabelIds: ["existing"], id: "thread-2", removeLabelIds: [] },
    ]);
    expect(
      getMessageLabelUpdates([{ id: "thread-1", labelIds: ["existing"] }], {})
    ).toStrictEqual([]);
  });
});
