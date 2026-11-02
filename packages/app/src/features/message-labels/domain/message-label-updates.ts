export type MessageLabelsTarget = {
  id: string;
  labelIds: readonly string[];
};

export type MessageLabelsUpdate = {
  id: string;
  addLabelIds: string[];
  removeLabelIds: string[];
};

export type MessageLabelSelection = "all" | "none" | "some";

export const getMessageLabelSelection = (
  targets: readonly MessageLabelsTarget[],
  labelId: string
): MessageLabelSelection => {
  if (targets.length === 0) {
    return "none";
  }

  const selectedCount = targets.reduce(
    (count, target) => count + Number(target.labelIds.includes(labelId)),
    0
  );

  if (selectedCount === 0) {
    return "none";
  }

  return selectedCount === targets.length ? "all" : "some";
};

export const getMessageLabelUpdates = (
  targets: readonly MessageLabelsTarget[],
  draftLabels: Readonly<Record<string, boolean>>
): MessageLabelsUpdate[] =>
  targets.flatMap((target) => {
    const currentLabelIds = new Set(target.labelIds);
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];

    for (const [labelId, checked] of Object.entries(draftLabels)) {
      if (checked && !currentLabelIds.has(labelId)) {
        addLabelIds.push(labelId);
      }
      if (!checked && currentLabelIds.has(labelId)) {
        removeLabelIds.push(labelId);
      }
    }

    return addLabelIds.length > 0 || removeLabelIds.length > 0
      ? [{ addLabelIds, id: target.id, removeLabelIds }]
      : [];
  });
