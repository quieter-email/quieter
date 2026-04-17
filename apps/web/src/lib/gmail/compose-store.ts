import { createStore } from "@tanstack/store";
import {
  createInitialComposeSessionState,
  type ComposeDraftState,
  type ComposeSessionState,
} from "./compose";

export type ComposeDialogStoreState = {
  composeSession: ComposeSessionState;
  dialogOpen: boolean;
  pendingFormSyncDraft: ComposeDraftState | null;
  showBcc: boolean;
  showCc: boolean;
  transitionBusy: boolean;
};

export const createInitialComposeDialogStoreState = (): ComposeDialogStoreState => ({
  composeSession: createInitialComposeSessionState(),
  dialogOpen: false,
  pendingFormSyncDraft: null,
  showBcc: false,
  showCc: false,
  transitionBusy: false,
});

export const createComposeDialogStore = () => createStore(createInitialComposeDialogStoreState());

export type ComposeDialogStore = ReturnType<typeof createComposeDialogStore>;
