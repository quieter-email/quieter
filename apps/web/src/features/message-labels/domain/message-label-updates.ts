export type MessageLabelsDialogTarget = {
  id: string;
  labelIds: readonly string[];
};

export type MessageLabelsDialogUpdate = {
  id: string;
  addLabelIds: string[];
  removeLabelIds: string[];
};

export const getMessageLabelUpdates = (
  targets: readonly MessageLabelsDialogTarget[],
  draftLabels: Readonly<Record<string, boolean>>,
): MessageLabelsDialogUpdate[] =>
  targets.flatMap((target) => {
    const currentLabelIds = new Set(target.labelIds);
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];

    for (const [labelId, checked] of Object.entries(draftLabels)) {
      if (checked && !currentLabelIds.has(labelId)) addLabelIds.push(labelId);
      if (!checked && currentLabelIds.has(labelId)) removeLabelIds.push(labelId);
    }

    return addLabelIds.length > 0 || removeLabelIds.length > 0
      ? [{ addLabelIds, id: target.id, removeLabelIds }]
      : [];
  });
