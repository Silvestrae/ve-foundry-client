import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export function createWorldLoadTimeStore(
  filePath: string,
  onError: (error: unknown) => void = () => {},
) {
  const read = () => {
    try {
      const data: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) return {};
      return Object.fromEntries(
        Object.entries(data).filter(
          ([, value]) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0,
        ),
      ) as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") onError(error);
      return {} as Record<string, number>;
    }
  };

  return {
    get(key: string): number | null {
      const value = read()[key];
      return typeof value === "number" ? value : null;
    },
    record(key: string, elapsedMs: number) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        const data = { ...read(), [key]: Math.round(elapsedMs) };
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(temporaryPath, JSON.stringify(data), "utf8");
        fs.renameSync(temporaryPath, filePath);
      } catch (error) {
        onError(error);
      } finally {
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch (error) {
          onError(error);
        }
      }
    },
  };
}
