import { normalizeLegacyTask } from "./domain.js";

// The caller must atomically check existence and insert, e.g. a Firestore transaction.
export async function copyLegacyTasks(
  rows,
  copyIfAbsent,
  onProgress = () => {},
) {
  const result = { copied: 0, existing: 0, skipped: 0 };
  for (const raw of rows) {
    const id = typeof raw.id === "string" ? `legacy_${raw.id}` : "";
    const data = normalizeLegacyTask(raw);
    if (
      !data ||
      !raw.id ||
      !id ||
      id.includes("/") ||
      new TextEncoder().encode(id).length > 1500
    ) {
      result.skipped++;
    } else {
      const copied = await copyIfAbsent(id, data);
      result[copied ? "copied" : "existing"]++;
    }
    onProgress({ ...result });
  }
  return result;
}
