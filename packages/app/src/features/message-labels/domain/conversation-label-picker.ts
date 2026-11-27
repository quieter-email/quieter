import { orderMailboxLabels } from "@quieter/mail/mailbox-organization";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";

import type { LabelGroup, createLabelGroupTree } from "./label-group-tree";

export type LabelPickerEntry =
  | { kind: "group"; group: LabelGroup; labelCount: number }
  | { kind: "label"; label: MailboxLabel; path: string | null };

export type LabelPickerSection = {
  entries: LabelPickerEntry[];
  title: string;
};

/**
 * `appliedIds` and `suggestionIds` are captured when the picker opens, so
 * toggling a label changes only its check, never its section or position.
 */
export type LabelPickerView = {
  appliedIds: readonly string[];
  groupId: string | null;
  query: string;
  suggestionIds: readonly string[];
};

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();

export const buildLabelPickerSections = (
  labels: readonly MailboxLabel[],
  tree: ReturnType<typeof createLabelGroupTree>,
  view: LabelPickerView
): LabelPickerSection[] => {
  const userLabels = orderMailboxLabels(
    labels.filter((label) => label.type === "user"),
    tree.labelOrder
  );
  const labelsById = new Map(userLabels.map((label) => [label.id, label]));
  const applied = new Set(view.appliedIds);
  const appliedLabels = userLabels.filter((label) => applied.has(label.id));
  const suggestedLabels = [...new Set(view.suggestionIds)]
    .filter((id) => !applied.has(id))
    .flatMap((id) => {
      const label = labelsById.get(id);
      return label === undefined ? [] : [label];
    })
    .slice(0, 3);
  const suggested = new Set(suggestedLabels.map((label) => label.id));
  const otherLabels = userLabels.filter(
    (label) => !applied.has(label.id) && !suggested.has(label.id)
  );
  const toLabelEntry = (label: MailboxLabel): LabelPickerEntry => ({
    kind: "label",
    label,
    path: tree.getGroupPath(tree.getLabelGroupId(label.id)),
  });

  const words = normalizeSearchText(view.query)
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length > 0) {
    const matches = (label: MailboxLabel) => {
      const text = normalizeSearchText(
        `${label.name} ${tree.getGroupPath(tree.getLabelGroupId(label.id)) ?? ""}`
      );
      return words.every((word) => text.includes(word));
    };
    return [
      { entries: appliedLabels.filter(matches), title: "Applied" },
      { entries: suggestedLabels.filter(matches), title: "Suggestions" },
      { entries: otherLabels.filter(matches), title: "Other labels" },
    ]
      .filter(({ entries }) => entries.length > 0)
      .map(({ entries, title }) => ({
        entries: entries.map(toLabelEntry),
        title,
      }));
  }

  const getEntriesUnder = (
    parentId: string | null,
    directLabels: readonly MailboxLabel[]
  ) => {
    const direct = new Set(directLabels.map((label) => label.id));
    const entries: LabelPickerEntry[] = [];
    const groupEntries = new Map<
      string,
      Extract<LabelPickerEntry, { kind: "group" }>
    >();
    for (const label of userLabels) {
      const groupId = tree.getLabelGroupId(label.id);
      if (groupId === parentId) {
        if (direct.has(label.id)) {
          entries.push(toLabelEntry(label));
        }
        continue;
      }
      if (parentId !== null || groupId === null) {
        continue;
      }
      const group = tree.getGroup(groupId);
      if (group === undefined) {
        continue;
      }
      const existing = groupEntries.get(groupId);
      if (existing === undefined) {
        const entry: Extract<LabelPickerEntry, { kind: "group" }> = {
          group,
          kind: "group",
          labelCount: 1,
        };
        groupEntries.set(groupId, entry);
        entries.push(entry);
      } else {
        existing.labelCount += 1;
      }
    }
    return entries;
  };

  const group = view.groupId === null ? undefined : tree.getGroup(view.groupId);
  if (group !== undefined) {
    return [
      {
        entries: getEntriesUnder(group.id, userLabels),
        title: group.name,
      },
    ];
  }

  const hasPinnedSections = appliedLabels.length + suggestedLabels.length > 0;
  return [
    { entries: appliedLabels.map(toLabelEntry), title: "Applied" },
    { entries: suggestedLabels.map(toLabelEntry), title: "Suggestions" },
    {
      entries: getEntriesUnder(null, otherLabels),
      title: hasPinnedSections ? "Other labels" : "Labels",
    },
  ].filter(({ entries }) => entries.length > 0);
};
