type SnapshotEntity = Record<string, unknown> & {
  entityType: string;
  name: string;
  table?: string;
  schema?: string;
  columns?: Array<Record<string, unknown>>;
  default?: unknown;
};

export type Snapshot = Record<string, unknown> & {
  ddl: SnapshotEntity[];
};

const entityKey = (entity: SnapshotEntity) =>
  [entity.entityType, entity.table, entity.name, entity.schema].filter(Boolean).join(".");

const normalizeJsonDefault = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("'") || !value.endsWith("'")) {
    return value;
  }

  const inner = value.slice(1, -1);

  try {
    return `'${JSON.stringify(JSON.parse(inner))}'`;
  } catch {
    return value;
  }
};

const sortRecord = (record: Record<string, unknown>) =>
  Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = record[key];
      return sorted;
    }, {});

const ignoredEntityFields = new Set(["nameExplicit", "concurrently"]);

const normalizeEntity = (entity: SnapshotEntity) => {
  const { id: _id, prevIds: _prevIds, ...rest } = entity;
  const normalized: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !ignoredEntityFields.has(key)),
  );

  if ("default" in normalized) {
    normalized.default = normalizeJsonDefault(normalized.default);
  }

  if (Array.isArray(normalized.columns)) {
    normalized.columns = normalized.columns.map((column) =>
      typeof column === "object" && column !== null ? sortRecord(column) : column,
    );
  }

  return JSON.stringify(sortRecord(normalized));
};

const comparableEntities = (snapshot: Snapshot) =>
  snapshot.ddl.filter((entity) => entity.entityType !== "checks");

export const serializeSnapshot = (snapshot: Snapshot) =>
  [...comparableEntities(snapshot)]
    .sort((a, b) => entityKey(a).localeCompare(entityKey(b)))
    .map((entity) => normalizeEntity(entity))
    .join("\n");

export const snapshotsMatch = (left: Snapshot, right: Snapshot) => {
  return serializeSnapshot(left) === serializeSnapshot(right);
};
