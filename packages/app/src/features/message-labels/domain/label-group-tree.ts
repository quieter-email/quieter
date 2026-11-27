import type { LabelOrganization } from "@quieter/mail/mailbox-organization";

export type LabelGroup = LabelOrganization["groups"][number];

export const createLabelGroupTree = (
  organization: LabelOrganization | undefined
) => {
  const groups = new Map(
    (organization?.groups ?? []).map((group) => [group.id, group])
  );

  /** Outermost group first; stops at missing or cyclic parents. */
  const getAncestry = (groupId: string | null) => {
    const chain: LabelGroup[] = [];
    const seen = new Set<string>();
    let current = groupId;
    while (current !== null && !seen.has(current)) {
      const group = groups.get(current);
      if (group === undefined) {
        break;
      }
      seen.add(current);
      chain.unshift(group);
      current = group.parentId;
    }
    return chain;
  };

  const getLabelGroupId = (labelId: string) => {
    const groupId = organization?.labelGroups[labelId];
    return groupId !== undefined && groups.has(groupId) ? groupId : null;
  };
  const getLabelAncestry = (labelId: string) =>
    getAncestry(getLabelGroupId(labelId));
  const getGroupPath = (groupId: string | null) => {
    const chain = getAncestry(groupId);
    return chain.length === 0
      ? null
      : chain.map((group) => group.name).join(" / ");
  };

  return {
    getAncestry,
    getGroup: (groupId: string) => groups.get(groupId),
    getGroupPath,
    getLabelAncestry,
    getLabelGroupId,
  };
};
