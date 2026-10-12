import { createHash } from "node:crypto";

export type CrmPreparationActor =
  | { kind: "system" }
  | { kind: "staff"; userId: number; requestId?: string };
export type CrmLearningFormat = "offline" | "online";
export type CrmPreparationStatus =
  | "ready" | "preparing" | "needs_format" | "needs_course" | "needs_program_review";

/** Only the owner's explicit, unambiguous business code identifies a format. */
export function crmGroupFormat(name: string, fallback: CrmLearningFormat | null = null): CrmLearningFormat | null {
  const codes = [...name.matchAll(/(?:^|[^A-Z0-9-])((CYP|ONL)-[A-Z0-9]+-(?:GRP|IND)-\d{2}-(\d{4,}))(?=$|[^A-Z0-9-])/g)];
  if (codes.length === 1 && Number(codes[0][3]) > 0) {
    const withoutCode = name.replace(codes[0][1], "");
    if (!/(?:CYP|ONL)-/i.test(withoutCode)) return codes[0][2] === "ONL" ? "online" : "offline";
  }
  if (codes.length || /(?:CYP|ONL)-/i.test(name)) return null;
  return fallback;
}

export function crmProgramUnits(program: unknown): { title: string; position: number }[] | null {
  if (!Array.isArray(program) || program.length > 2000) return null;
  const positions = new Set<number>();
  const units = [];
  for (let index = 0; index < program.length; index++) {
    const item = program[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    const position = entry.lessonNumber === undefined ? index : Number(entry.lessonNumber) - 1;
    const title = typeof entry.topic === "string" ? entry.topic.trim() : typeof entry.title === "string" ? entry.title.trim() : "";
    if (!Number.isSafeInteger(position) || position < 0 || positions.has(position) || !title) return null;
    positions.add(position);
    units.push({ title, position });
  }
  return units;
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
};
export const crmPreparationHash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
