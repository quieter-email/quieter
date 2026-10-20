export const formatMailSender = (sender: {
  address: string;
  name: string;
}): string => {
  const name = sender.name.replaceAll(/[\r\n]/gu, " ").trim();
  if (name.length === 0) {
    return sender.address;
  }
  return `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" <${sender.address}>`;
};

export const resolveMailSender = (
  mailbox: { displayName: string | null; emailAddress: string },
  senderName?: string
): { address: string; name: string } => {
  const name =
    senderName?.trim() ||
    mailbox.displayName?.trim() ||
    mailbox.emailAddress.slice(0, mailbox.emailAddress.lastIndexOf("@"));
  return {
    address: mailbox.emailAddress,
    name: name.replaceAll(/[\r\n]/gu, " "),
  };
};
