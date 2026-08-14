export const normalizeManagedOrganizationName = (value: string) =>
  value.replaceAll(/\s+/gu, " ").trim().toLocaleLowerCase();
