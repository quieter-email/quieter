export const isSyncClientAllowed = (
  userId: string,
  configuration: { enabled?: boolean; clientsEnabled?: boolean; users?: string }
) => {
  if (
    configuration.enabled !== true ||
    configuration.clientsEnabled === false
  ) {
    return false;
  }
  return (
    configuration.users === undefined ||
    configuration.users.split(",").some((id) => id.trim() === userId)
  );
};
