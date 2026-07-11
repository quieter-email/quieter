import { describe, expect, it } from "vite-plus/test";
import { getMessageLabelUpdates } from "./message-label-updates";

describe("getMessageLabelUpdates", () => {
  it("adds and removes labels only where each selected conversation needs a change", () => {
    expect(
      getMessageLabelUpdates(
        [
          { id: "thread-1", labelIds: ["shared", "first-only"] },
          { id: "thread-2", labelIds: ["shared", "second-only"] },
        ],
        { "first-only": true, "second-only": false, shared: false },
      ),
    ).toEqual([
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
        { existing: true },
      ),
    ).toEqual([{ addLabelIds: ["existing"], id: "thread-2", removeLabelIds: [] }]);
    expect(getMessageLabelUpdates([{ id: "thread-1", labelIds: ["existing"] }], {})).toEqual([]);
  });
});
