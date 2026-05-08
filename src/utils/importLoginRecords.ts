import { GameConfig, GameUserDataSchema } from "../schemas";

export type ImportedLoginRecord = {
  password?: number[];
  user: string;
  adminPassword?: number[];
};

const STATIC_USER_DATA_KEYS = new Set([
  "app",
  "theme",
  "cachePath",
  "schemaVersion",
  "lastRunAppVersion",
  "clientVersion",
  "originalImportDeclinedAt",
  "originalImportDeclinedAppName",
  "originalImportCompletedAt",
  "originalImportCompletedAppName",
  "originalUninstallDeclinedAt",
  "originalUninstallDeclinedAppName",
]);

function recordSignature(record: ImportedLoginRecord) {
  return JSON.stringify({
    user: record.user,
    password: record.password ?? [],
    adminPassword: record.adminPassword ?? [],
  });
}

function hasSavedLogin(record: ImportedLoginRecord) {
  return (
    !!record.user ||
    (record.password?.length ?? 0) > 0 ||
    (record.adminPassword?.length ?? 0) > 0
  );
}

function getGameKey(game: GameConfig) {
  return game.id === undefined || game.id === null
    ? undefined
    : String(game.id);
}

export function extractImportedLoginRecords(
  rawData: unknown,
  games: GameConfig[] = [],
) {
  const data =
    typeof rawData === "object" && rawData !== null
      ? (rawData as Record<string, unknown>)
      : {};

  const loginEntries = Object.entries(data)
    .filter(([key]) => !STATIC_USER_DATA_KEYS.has(key))
    .map(([key, value]) => {
      const result = GameUserDataSchema.safeParse(value);
      return result.success ? ([key, result.data] as const) : null;
    })
    .filter(
      (entry): entry is readonly [string, ImportedLoginRecord] =>
        entry !== null,
    );

  const gameKeys = new Set(
    games.map((game) => getGameKey(game)).filter((key): key is string => !!key),
  );
  const records: Record<string, ImportedLoginRecord> =
    Object.fromEntries(loginEntries);
  const exactRecordSignatures = new Set<string>();

  for (const game of games) {
    const key = getGameKey(game);
    if (!key) continue;
    const exactRecord = loginEntries.find(([recordKey]) => recordKey === key);
    if (!exactRecord) continue;
    records[key] = exactRecord[1];
    exactRecordSignatures.add(recordSignature(exactRecord[1]));
  }

  const fallbackRecords = loginEntries
    .filter(([key]) => !gameKeys.has(key))
    .filter(([, record]) => hasSavedLogin(record))
    .filter(([, record]) => !exactRecordSignatures.has(recordSignature(record)))
    .reverse();

  let fallbackIndex = 0;
  for (const game of games) {
    const key = getGameKey(game);
    if (!key || records[key]) continue;
    const fallback = fallbackRecords[fallbackIndex];
    if (!fallback) break;
    records[key] = fallback[1];
    fallbackIndex += 1;
  }

  return records;
}
