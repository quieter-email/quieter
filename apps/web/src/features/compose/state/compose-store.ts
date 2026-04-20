import { createStore } from "@tanstack/store";
import { createInitialComposeSessionState, type ComposeSessionState } from "../domain/draft";

export type ComposeDialogStoreState = {
  composeSession: ComposeSessionState;
  dialogOpen: boolean;
  showBcc: boolean;
  showCc: boolean;
  transitionBusy: boolean;
};

export const createInitialComposeDialogStoreState = (): ComposeDialogStoreState => ({
  composeSession: createInitialComposeSessionState(),
  dialogOpen: false,
  showBcc: false,
  showCc: false,
  transitionBusy: false,
});

export const createComposeDialogStore = () => createStore(createInitialComposeDialogStoreState());

export type ComposeDialogStore = ReturnType<typeof createComposeDialogStore>;
