import type { LabelOrganization } from "@quieter/mail/mailbox-organization";

export type LabelGroup = LabelOrganization["groups"][number];

export const createLabelGroupTree = (
  organization: LabelOrganization | undefined
) => {
  const groups = new Map(
    (organization?.groups ?? []).map((group) => [group.id, group])
  );

  const getLabelGroupId = (labelId: string) => {
    const groupId = organization?.labelGroups[labelId];
    return groupId !== undefined && groups.has(groupId) ? groupId : null;
  };
  return {
    getGroup: (groupId: string) => groups.get(groupId),
    getGroupPath: (groupId: string | null) =>
      groupId === null ? null : (groups.get(groupId)?.name ?? null),
    getLabelGroupId,
    labelOrder: organization?.labelOrder,
  };
};
