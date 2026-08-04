export const DEFAULT_GMAIL_MAILBOX_NAME = "Gmail";

export const getGmailMailboxDisplayName = (
  displayName: string | null | undefined,
  emailAddress: string,
) => {
  const trimmedDisplayName = displayName?.trim();
  if (
    !trimmedDisplayName ||
    trimmedDisplayName.toLowerCase() === emailAddress.trim().toLowerCase()
  ) {
    return DEFAULT_GMAIL_MAILBOX_NAME;
  }
  return trimmedDisplayName;
};
