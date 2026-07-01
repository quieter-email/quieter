import { setMailboxAutoLabeling } from "../mail-automation/settings";

export const setGmailAutoLabeling = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => setMailboxAutoLabeling(input);
