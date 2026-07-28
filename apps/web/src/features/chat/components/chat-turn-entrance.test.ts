import { describe, expect, it } from "vite-plus/test";
import { createChatTurnEntranceState, trackChatTurnEntrances } from "./chat-turn-entrance";

describe("chat turn entrances", () => {
  it("seeds hydrated turns without animating them", () => {
    const state = createChatTurnEntranceState();

    expect(trackChatTurnEntrances(state, [], false)).toEqual(new Set());
    expect(trackChatTurnEntrances(state, ["existing-user"], true)).toEqual(new Set());
    expect(state.newTurnIds).toEqual(new Set());
  });

  it("enters each post-hydration turn once", () => {
    const state = createChatTurnEntranceState();
    trackChatTurnEntrances(state, ["existing-user"], true);

    expect(trackChatTurnEntrances(state, ["existing-user", "new-user"], true)).toEqual(
      new Set(["new-user"]),
    );
    expect(trackChatTurnEntrances(state, ["existing-user", "new-user"], true)).toEqual(new Set());
    expect(state.newTurnIds).toEqual(new Set(["new-user"]));
  });
});
