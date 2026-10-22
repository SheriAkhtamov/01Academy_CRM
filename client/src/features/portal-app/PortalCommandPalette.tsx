import { enrollmentCourseHref } from "../lms/enrollment-period";
import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import {
  learningModuleForSubject,
  learningSubjectHref,
  toLearningModuleHref,
} from "@shared/platform-routes";
import { portalLmsApi } from "./api";
import { usePortal, useSubjectQuery } from "./context";
import { canAccessPortalSection, studentNav } from "./module-navigation";
import { usePortalLocation } from "./navigation";
import { isPortalAccessError, PortalError, PortalLoading, usePortalFormat } from "./ui";

export function PortalCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { subject, allSubjects, learningModule, guarded } = usePortal();
  const [, navigate] = usePortalLocation();
  const [search, setSearch] = useState("");
  const activeModule = learningModule ?? learningModuleForSubject(subject);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === "k" || event.code === "KeyK")
      ) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down, { capture: true });
    return () => document.removeEventListener("keydown", down, { capture: true });
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const term = search.trim().toLocaleLowerCase();
  const courses = useSubjectQuery(
    "courses",
    portalLmsApi.courses,
    [],
    "learning.read",
    open && term.length >= 2 && activeModule === "student",
  );
  const modules = (["student", "parent"] as const).filter(
    (module) => module === activeModule ||
      allSubjects.some((item) => learningModuleForSubject(item) === module),
  );
  const sections = modules.map((module) => {
    const title = t(module === "student" ? "studentModule" : "parentModule");
    const links = module === activeModule && subject
      ? [subject]
      : allSubjects.filter((item) => learningModuleForSubject(item) === module);
    const items = studentNav
      .filter((item) => !["/learn/profile", "/learn/notifications"].includes(item.route))
      .filter((item) => canAccessPortalSection(item.route, module, links))
      .map((item) => ({
        ...item,
        label: t(item.route === "/learn" && module === "parent"
          ? "portalFamilyOverview"
          : item.route === "/learn/progress" && module === "parent"
            ? "portalResults"
            : item.key),
        href: toLearningModuleHref(item.route, module),
      }))
      .filter((item) =>
        !term || `${title} ${item.label}`.toLocaleLowerCase().includes(term),
      );
    return { module, title, items };
  });
  const searchOwnCourses = activeModule === "student" && term.length >= 2;
  const matchedCourses = searchOwnCourses && !isPortalAccessError(courses.error)
    ? (courses.data ?? []).filter((course) =>
        `${course.courseName} ${course.groupName}`.toLocaleLowerCase().includes(term),
      )
    : [];
  const pending = searchOwnCourses && courses.fetchStatus === "fetching";
  const select = (href: string) => guarded(() => {
    onOpenChange(false);
    navigate(href);
  });

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <DialogTitle className="sr-only">{t("search")}</DialogTitle>
      <CommandInput placeholder={t("search")} value={search} onValueChange={setSearch} />
      <CommandList>
        {!pending && !courses.error &&
          !sections.some((section) => section.items.length) && !matchedCourses.length && (
          <CommandEmpty>{t("noSearchResults")}</CommandEmpty>
        )}
        {sections.map((section) => section.items.length > 0 && (
          <CommandGroup key={section.module} heading={section.title}>
            {section.items.map((item) => (
              <CommandItem key={item.href} value={item.href} onSelect={() => select(item.href)}>
                <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {pending && <PortalLoading variant="section" />}
        {searchOwnCourses && courses.error && (
          <PortalError error={courses.error} retry={() => void courses.refetch()} />
        )}
        {matchedCourses.length > 0 && subject && (
          <CommandGroup heading={t("portalCourses")}>
            {matchedCourses.map((course) => (
              <CommandItem
                key={course.enrollmentId}
                value={`course-${subject.linkId}-${course.enrollmentId}`}
                onSelect={() => select(learningSubjectHref(enrollmentCourseHref(course.runId, course.enrollmentId), subject))}
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate">{course.courseName}</p>
                  <p className="truncate text-xs text-muted-foreground">{course.groupName} · {format.date(course.enrolledAt)}{course.endedAt ? ` – ${format.date(course.endedAt)}` : ""}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
