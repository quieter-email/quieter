import type {
  LabelOrganization,
  MailboxLabel,
} from "@quieter/mail/mailbox-organization";

type LabelGroup = LabelOrganization["groups"][number];

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

  const getLabelAncestry = (labelId: string) =>
    getAncestry(organization?.labelGroups[labelId] ?? null);

  return {
    getAncestry,
    getGroup: (groupId: string) => groups.get(groupId),
    getLabelAncestry,
    getLabelPath: (labelId: string) => {
      const chain = getLabelAncestry(labelId);
      return chain.length === 0
        ? null
        : chain.map((group) => group.name).join(" / ");
    },
  };
};

export const buildLabelPickerSections = (
  labels: readonly MailboxLabel[],
  organization: LabelOrganization | undefined,
  view: LabelPickerView
): LabelPickerSection[] => {
  const userLabels = labels.filter((label) => label.type === "user");
  const labelsById = new Map(userLabels.map((label) => [label.id, label]));
  const tree = createLabelGroupTree(organization);
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
    path: tree.getLabelPath(label.id),
  });

  const words = normalizeSearchText(view.query)
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length > 0) {
    const matches = (label: MailboxLabel) => {
      const text = normalizeSearchText(
        `${label.name} ${tree.getLabelPath(label.id) ?? ""}`
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

  // Entries directly inside `parentId`: its own labels from `directLabels`,
  // and each child group holding any label at any depth. Each entry sits where
  // its first label sits in the mailbox's label order.
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
      const chain = tree.getLabelAncestry(label.id);
      const parentIndex =
        parentId === null
          ? -1
          : chain.findIndex((group) => group.id === parentId);
      if (parentId !== null && parentIndex === -1) {
        continue;
      }
      const child = chain[parentIndex + 1];
      if (child === undefined) {
        if (direct.has(label.id)) {
          entries.push(toLabelEntry(label));
        }
        continue;
      }
      const existing = groupEntries.get(child.id);
      if (existing === undefined) {
        const entry: Extract<LabelPickerEntry, { kind: "group" }> = {
          group: child,
          kind: "group",
          labelCount: 1,
        };
        groupEntries.set(child.id, entry);
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
        title: tree
          .getAncestry(group.id)
          .map(({ name }) => name)
          .join(" / "),
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
