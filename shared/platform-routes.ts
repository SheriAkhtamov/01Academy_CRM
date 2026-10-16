export type LearningModule = "student" | "parent";

const moduleBases: Record<LearningModule, string> = {
  student: "/student-module",
  parent: "/parent-module",
};

const hasBase = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`);

export function learningModuleBase(module: LearningModule): string {
  return moduleBases[module];
}

export function learningModuleFromPath(path: string): LearningModule | null {
  const pathname = path.split(/[?#]/, 1)[0];
  return (
    (Object.keys(moduleBases) as LearningModule[]).find((module) =>
      hasBase(pathname, moduleBases[module]),
    ) ?? null
  );
}

export function isLearningModulePath(path: string): boolean {
  return learningModuleFromPath(path) !== null;
}

export function isLegacyLearningPath(path: string): boolean {
  return hasBase(path.split(/[?#]/, 1)[0], "/learn");
}

export function isLearningNavigationHref(href: string): boolean {
  return isLegacyLearningPath(href) || isLearningModulePath(href);
}

export function isPlatformAccountPath(path: string): boolean {
  return ["/activate", "/recover"].includes(
    path.split(/[?#]/, 1)[0].replace(/\/+$/, ""),
  );
}

export function learningModuleForSubject(
  subject: { kind: "self" | "representative" } | null | undefined,
): LearningModule {
  return subject?.kind === "representative" ? "parent" : "student";
}

/** The persisted notification path may predate the shared platform modules. */
export function toLearningModuleHref(
  href: string,
  module: LearningModule,
): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const boundary = href.search(/[?#]/);
  const pathname = (boundary < 0 ? href : href.slice(0, boundary)).replace(/\/+$/, "") || "/";
  const tail = boundary < 0 ? "" : href.slice(boundary);
  if (["/learn/invite", "/learn/activate"].includes(pathname))
    return `/activate${tail}`;
  if (["/learn/recover", "/learn/reset"].includes(pathname))
    return `/recover${tail}`;
  if (pathname === "/learn/login") return `/login${tail}`;
  const sourceModule = learningModuleFromPath(pathname);
  const sourceBase = sourceModule ? moduleBases[sourceModule] : "/learn";
  if (!hasBase(pathname, sourceBase)) return href;
  return `${moduleBases[module]}${pathname.slice(sourceBase.length)}${tail}`;
}

/** Content sections retain a stable key independently of the active role. */
export function learningSectionPath(path: string): string {
  const module = learningModuleFromPath(path);
  const section = module ? `/learn${path.slice(moduleBases[module].length)}` : path;
  return section.replace(/\/+$/, "") || "/";
}

export function learningSubjectHref(
  href: string,
  subject: { kind: "self" | "representative"; linkId: number } | null,
): string {
  const mapped = toLearningModuleHref(href, learningModuleForSubject(subject));
  if (!subject || !isLearningModulePath(mapped)) return mapped;
  const hashAt = mapped.indexOf("#");
  const address = hashAt < 0 ? mapped : mapped.slice(0, hashAt);
  const fragment = hashAt < 0 ? "" : mapped.slice(hashAt);
  const queryAt = address.indexOf("?");
  const pathname = queryAt < 0 ? address : address.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? "" : address.slice(queryAt + 1));
  params.set("linkId", String(subject.linkId));
  return `${pathname}?${params}${fragment}`;
}
