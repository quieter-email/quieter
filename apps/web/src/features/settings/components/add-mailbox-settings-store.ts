import { useCreateStore } from "@tanstack/react-store";

type AddMailboxSettingsState = {
  direction: "back" | "forward";
  gmailOrganizationId: string;
  isSharedDetailsVisible: boolean;
  isStartingGmail: boolean;
  mailboxType: "gmail" | "shared" | undefined;
  managedDisplayName: string;
  managedDivisionId: string | null;
  managedDomain: string | undefined;
  managedLocalPart: string;
  managedOrganizationId: string;
  receiveWholeDomain: boolean;
};

const initialAddMailboxSettingsState: AddMailboxSettingsState = {
  direction: "forward",
  gmailOrganizationId: "",
  isSharedDetailsVisible: false,
  isStartingGmail: false,
  mailboxType: undefined,
  managedDisplayName: "",
  managedDivisionId: null,
  managedDomain: undefined,
  managedLocalPart: "",
  managedOrganizationId: "",
  receiveWholeDomain: false,
};

export const useAddMailboxSettingsStore = () =>
  useCreateStore(initialAddMailboxSettingsState);
