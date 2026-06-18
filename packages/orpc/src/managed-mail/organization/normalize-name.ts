export const normalizeManagedOrganizationName = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
