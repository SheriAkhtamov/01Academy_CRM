import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  lmsCourseVersionSchema,
  type LmsStaffLessonDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffConfirm,
  StaffStatus,
  useStaffError,
  useStaffFormat,
  safeStaffLink,
  staffDateInput,
  staffDateIso,
} from "./ui";
export function StaffProgram({
  runId,
  courseId,
  administration,
  manageContent = true,
  manageSchedule = true,
}: {
  runId: number;
  courseId: number;
  administration: boolean;
  manageContent?: boolean;
  manageSchedule?: boolean;
}) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<LmsStaffLessonDto | null>(null);
  const [preview, setPreview] = useState<{
    id: number;
    title: string;
    previewEnabled?: boolean;
    visibleFrom?: string | null;
    openAt?: string | null;
  } | null>(null);
  const units = useStaffQuery("units", runId, (signal) =>
    lmsStaffApi.units(runId, signal),
  );
  const versions = useStaffQuery(
    "course-versions",
    manageContent ? runId : null,
    (signal) => lmsStaffApi.courseVersions(runId, signal),
  );
  const lessons = useStaffQuery("lessons", runId, (signal) =>
    lmsStaffApi.lessons(runId, signal),
  );
  if ((manageContent && versions.isPending) || lessons.isPending)
    return <StaffLoading />;
  if ((manageContent && versions.error) || lessons.error)
    return (
      <StaffError
        error={versions.error ?? lessons.error}
        retry={() => {
          void versions.refetch();
          void lessons.refetch();
        }}
      />
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("lmsStaffProgram")}</h2>
        {administration && (
          <Button onClick={() => setCreate(true)}>
            {t("lmsStaffNewProgram")}
          </Button>
        )}
      </div>
      {manageContent && units.data && units.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground">
            {t("lmsStaffPreviewUnit")}
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {units.data.map((unit) => (
              <div
                key={unit.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs transition-colors hover:border-primary/30"
              >
                <p className="min-w-0 break-words text-sm font-medium">
                  {unit.title}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreview(unit)}
                >
                  {t("lmsStaffEdit")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      {manageContent && !versions.data?.length && <StaffEmpty />}
      {manageContent && (
        <div className="grid gap-4 lg:grid-cols-2">
          {versions.data?.map((program) => (
            <Card key={program.id} className="border-border/70">
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {date(program.createdAt)}
                  </span>
                  <StaffStatus state={program.state} />
                </div>
                <ol className="space-y-2">
                  {program.units.map((unit, index) => (
                    <li
                      key={unit.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 p-3"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary tabular-nums">
                          {index + 1}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          {unit.sectionTitle && (
                            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              {unit.sectionTitle}
                            </p>
                          )}
                          <p className="text-sm font-medium break-words">
                            {unit.title}
                          </p>
                        </div>
                      </div>
                      {unit.required && (
                        <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {t("lmsStaffRequired")}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("portalSchedule")}</h2>
        {!lessons.data.length && <StaffEmpty />}
        <div className="grid gap-3 md:grid-cols-2">
          {lessons.data.map((lesson) => (
            <Card
              key={lesson.id}
              className="border-border/70 transition-colors hover:border-primary/30"
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <h3 className="break-words font-semibold">{lesson.topic}</h3>
                  <p className="text-xs text-muted-foreground">
                    {date(lesson.scheduledAt)} ·{" "}
                    {t(
                      lesson.format === "online"
                        ? "lmsStaffOnline"
                        : "lmsStaffOffline",
                    )}
                  </p>
                </div>
                {manageSchedule && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(lesson)}
                  >
                    {t("lmsStaffBindLesson")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      {create && (
        <ProgramEditor courseId={courseId} onClose={() => setCreate(false)} />
      )}{" "}
      {selected && (
        <LessonBindingEditor
          runId={runId}
          lesson={selected}
          onClose={() => setSelected(null)}
        />
      )}
      {preview && (
        <UnitPreviewEditor
          runId={runId}
          unit={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
function UnitPreviewEditor({
  runId,
  unit,
  onClose,
}: {
  runId: number;
  unit: {
    id: number;
    title: string;
    previewEnabled?: boolean;
    visibleFrom?: string | null;
    openAt?: string | null;
  };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const [enabled, setEnabled] = useState(unit.previewEnabled ?? false);
  const [from, setFrom] = useState(
    staffDateInput(unit.visibleFrom ?? new Date().toISOString()),
  );
  const [openAt, setOpenAt] = useState(
    staffDateInput(unit.openAt ?? new Date().toISOString()),
  );
  const [invalid, setInvalid] = useState(false);
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.unitPreview(runId, unit.id, {
        enabled,
        visibleFrom: staffDateIso(from),
        openAt: staffDateIso(openAt),
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffPreviewUnit"
      description={unit.title}
      dirty
      pending={action.isPending}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (staffDateIso(from) > staffDateIso(openAt)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          action.mutate();
        }}
      >
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {t("lmsStaffPreviewUnit")}
        </label>
        <StaffField id="unit-visible-from" labelKey="lmsStaffPreviewFrom">
          <Input
            id="unit-visible-from"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </StaffField>
        <StaffField id="unit-open-at" labelKey="lmsStaffUnitOpensAt">
          <Input
            id="unit-open-at"
            type="datetime-local"
            value={openAt}
            onChange={(event) => setOpenAt(event.target.value)}
            required
          />
        </StaffField>
        {(invalid || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {invalid ? t("lmsDatesInvalid") : message(action.error)}
          </p>
        )}
        <Button disabled={action.isPending}>{t("portalSave")}</Button>
      </form>
    </StaffDialog>
  );
}
function ProgramEditor({
  courseId,
  onClose,
}: {
  courseId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const [sections, setSections] = useState<
    Array<{
      id: string;
      title: string;
      units: Array<{ id: string; title: string; required: boolean }>;
    }>
  >([{ id: crypto.randomUUID(), title: "", units: [] }]);
  const [publish, setPublish] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [validation, setValidation] = useState("");
  const [remove, setRemove] = useState<{
    sectionId: string;
    unitId: string;
  } | null>(null);
  const action = useMutation({
    mutationFn: lmsStaffApi.createCourseVersion,
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffNewProgram"
      dirty={sections.some((section) => section.title || section.units.length)}
      pending={action.isPending}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setValidation("");
          const parsed = lmsCourseVersionSchema.safeParse({
            idempotencyKey,
            courseId,
            sections: sections.map((section) => ({
              title: section.title,
              units: section.units.map((unit) => ({
                title: unit.title,
                required: unit.required,
              })),
            })),
            publish,
          });
          if (!parsed.success) {
            setValidation(t("portalInvalidData"));
            return;
          }
          action.mutate(parsed.data);
        }}
      >
        {sections.map((section, index) => (
          <fieldset
            key={section.id}
            className="space-y-4 rounded-xl border p-4"
          >
            <legend className="px-2 font-semibold">
              {t("lmsStaffSections")} {index + 1}
            </legend>
            <StaffField
              id={`section-${section.id}`}
              labelKey="lmsStaffTitleField"
            >
              <Input
                id={`section-${section.id}`}
                value={section.title}
                onChange={(event) =>
                  setSections((items) =>
                    items.map((item) =>
                      item.id === section.id
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  )
                }
                required
              />
            </StaffField>
            {section.units.map((unit) => (
              <div
                key={unit.id}
                className="space-y-3 rounded-md bg-muted/30 p-3"
              >
                <StaffField
                  id={`unit-${unit.id}`}
                  labelKey="lmsStaffTitleField"
                >
                  <Input
                    id={`unit-${unit.id}`}
                    value={unit.title}
                    onChange={(event) =>
                      setSections((items) =>
                        items.map((item) =>
                          item.id === section.id
                            ? {
                                ...item,
                                units: item.units.map((previous) =>
                                  previous.id === unit.id
                                    ? { ...previous, title: event.target.value }
                                    : previous,
                                ),
                              }
                            : item,
                        ),
                      )
                    }
                    required
                  />
                </StaffField>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={unit.required}
                      onChange={(event) =>
                        setSections((items) =>
                          items.map((item) =>
                            item.id === section.id
                              ? {
                                  ...item,
                                  units: item.units.map((previous) =>
                                    previous.id === unit.id
                                      ? {
                                          ...previous,
                                          required: event.target.checked,
                                        }
                                      : previous,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {t("lmsStaffRequired")}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setRemove({ sectionId: section.id, unitId: unit.id })
                    }
                  >
                    {t("portalRemove")}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setSections((items) =>
                  items.map((item) =>
                    item.id === section.id
                      ? {
                          ...item,
                          units: [
                            ...item.units,
                            {
                              id: crypto.randomUUID(),
                              title: "",
                              required: true,
                            },
                          ],
                        }
                      : item,
                  ),
                )
              }
            >
              {t("lmsStaffAddUnit")}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setSections((items) => [
              ...items,
              { id: crypto.randomUUID(), title: "", units: [] },
            ])
          }
        >
          {t("lmsStaffAddSection")}
        </Button>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
          />
          {t("lmsStaffPublish")}
        </label>
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <Button disabled={action.isPending}>
          {t(publish ? "lmsStaffPublish" : "lmsStaffSave")}
        </Button>
      </form>
      <StaffConfirm
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        titleKey="lmsStaffRemoveUnitTitle"
        description="lmsStaffRemoveUnitBody"
        action="portalRemove"
        onConfirm={() => {
          setSections((items) =>
            items.map((item) =>
              item.id === remove?.sectionId
                ? {
                    ...item,
                    units: item.units.filter(
                      (unit) => unit.id !== remove.unitId,
                    ),
                  }
                : item,
            ),
          );
          setRemove(null);
        }}
      />
    </StaffDialog>
  );
}
function LessonBindingEditor({
  runId,
  lesson,
  onClose,
}: {
  runId: number;
  lesson: LmsStaffLessonDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const units = useStaffQuery("units", runId, (signal) =>
    lmsStaffApi.units(runId, signal),
  );
  const [unit, setUnit] = useState(String(lesson.unitId ?? ""));
  const [format, setFormat] = useState<"offline" | "online" | "">(
    lesson.format,
  );
  const [meeting, setMeeting] = useState(lesson.meetingUrl ?? "");
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.bindLesson(runId, lesson.id, {
        unitId: unit ? Number(unit) : null,
        format: format || null,
        meetingUrl: format === "online" && meeting ? meeting : null,
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffBindLesson"
      description={lesson.topic}
      dirty={
        meeting !== (lesson.meetingUrl ?? "") ||
        unit !== String(lesson.unitId ?? "")
      }
      pending={action.isPending}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setValidation("");
          if (format === "online" && !safeStaffLink(meeting)) {
            setValidation(t("portalInvalidUrl"));
            return;
          }
          action.mutate();
        }}
      >
        <StaffField id="binding-unit" labelKey="portalLessons">
          <select
            id="binding-unit"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            <option value="">{t("lmsStaffNoLesson")}</option>
            {units.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </StaffField>
        <StaffField id="binding-format" labelKey="lmsStaffGroup">
          <select
            id="binding-format"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="">{t("lmsStaffDefaultFormat")}</option>
            <option value="offline">{t("lmsStaffOffline")}</option>
            <option value="online">{t("lmsStaffOnline")}</option>
          </select>
        </StaffField>
        {format === "online" && (
          <StaffField id="binding-meeting" labelKey="lmsStaffMeeting">
            <Input
              id="binding-meeting"
              type="url"
              value={meeting}
              onChange={(event) => setMeeting(event.target.value)}
              required
            />
          </StaffField>
        )}
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <Button disabled={action.isPending}>{t("lmsStaffSave")}</Button>
      </form>
    </StaffDialog>
  );
}
