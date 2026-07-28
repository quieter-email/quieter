export type ChatTurnEntranceState = {
  hydrated: boolean;
  newTurnIds: Set<string>;
  seenTurnIds: Set<string>;
};

export const createChatTurnEntranceState = (): ChatTurnEntranceState => ({
  hydrated: false,
  newTurnIds: new Set(),
  seenTurnIds: new Set(),
});

export const trackChatTurnEntrances = (
  state: ChatTurnEntranceState,
  turnIds: string[],
  hydrated: boolean,
) => {
  const enteringTurnIds = new Set<string>();

  if (!state.hydrated) {
    for (const turnId of turnIds) {
      state.seenTurnIds.add(turnId);
    }
    state.hydrated = hydrated;
    return enteringTurnIds;
  }

  for (const turnId of turnIds) {
    if (!state.seenTurnIds.has(turnId)) {
      enteringTurnIds.add(turnId);
      state.newTurnIds.add(turnId);
      state.seenTurnIds.add(turnId);
    }
  }

  return enteringTurnIds;
};
