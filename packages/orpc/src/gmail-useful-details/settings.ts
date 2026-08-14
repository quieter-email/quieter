import { setMailboxUsefulDetails } from "../mail-automation/settings";

export const setGmailUsefulDetails = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => await setMailboxUsefulDetails(input);
