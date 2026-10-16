import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  Clock,
  Eye,
  FileText,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Video,
} from "lucide-react";
import {
  lmsMaterialSchema,
  type LmsStaffMaterialDto,
  type LmsStaffEnrollmentDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LearningText } from "../learning-content/text";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffRecipients,
  StaffConfirm,
  StaffStatus,
  staffDateInput,
  staffDateIso,
  safeStaffLink,
  useStaffError,
} from "./ui";
import { StaffEditor } from "./editor";
import { StaffUploads, StaffFiles } from "./files";
export function StaffMaterials({
  runId,
  enrollments,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
}) {
  const { t } = useTranslation();
  const query = useStaffQuery("materials", runId, (signal) =>
    lmsStaffApi.materials(runId, signal),
  );
  const [edit, setEdit] = useState<LmsStaffMaterialDto | true | null>(null);
  const [preview, setPreview] = useState<LmsStaffMaterialDto | null>(null);
  const [archive, setArchive] = useState<LmsStaffMaterialDto | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "lesson" | "practice" | "repeat"
  >("all");
  const invalidate = useStaffInvalidate();
  const archiveAction = useMutation({
    mutationFn: () => lmsStaffApi.archiveMaterial(archive!.id),
    onSuccess: () => {
      setArchive(null);
      void invalidate();
    },
  });
  if (query.isPending) return <StaffLoading />;
  if (query.error)
    return (
      <StaffError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );

  const categoryLabels = {
    lesson: t("portalForLesson"),
    practice: t("portalPractice"),
    repeat: t("portalRevision"),
  } as const;

  const filteredMaterials = query.data.filter((material) => {
    if (categoryFilter !== "all" && material.category !== categoryFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        material.title.toLowerCase().includes(q) ||
        material.body.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-semibold">{t("lmsStaffMaterials")}</h2>
          <Badge variant="secondary" className="tabular-nums">
            {query.data.length}
          </Badge>
        </div>
        <Button onClick={() => setEdit(true)} className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("lmsStaffAddMaterial")}
        </Button>
      </div>

      {query.data.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("lmsStaffSearchPlaceholder")}
              className="h-9 bg-background pl-9 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["all", t("lmsStaffAllCategories")],
                ["lesson", t("portalForLesson")],
                ["practice", t("portalPractice")],
                ["repeat", t("portalRevision")],
              ] as const
            ).map(([cat, label]) => (
              <div
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  "cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  categoryFilter === cat
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredMaterials.length === 0 && <StaffEmpty />}
      <div className="grid gap-4 md:grid-cols-2">
        {filteredMaterials.map((material) => (
          <Card
            key={material.id}
            className="flex flex-col justify-between border-border/70 transition-all hover:border-primary/30 hover:shadow-sm"
          >
            <CardContent className="flex h-full flex-col justify-between gap-4 p-4 sm:p-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="min-w-0 break-words font-semibold leading-snug">
                        {material.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="text-[11px] font-normal"
                        >
                          <BookOpen className="mr-1 h-3 w-3 text-muted-foreground" />
                          {categoryLabels[material.category]}
                        </Badge>
                        {material.durationMinutes && (
                          <Badge
                            variant="outline"
                            className="text-[11px] font-normal"
                          >
                            <Clock className="mr-1 h-3 w-3 text-muted-foreground" />
                            {material.durationMinutes} {t("minutesShort")}
                          </Badge>
                        )}
                        {material.videoUrl && (
                          <Badge
                            variant="outline"
                            className="border-sky-500/30 bg-sky-500/10 text-[11px] font-normal text-sky-700 dark:text-sky-300"
                          >
                            <Video className="mr-1 h-3 w-3" />
                            {t("lmsStaffVideoUrl")}
                          </Badge>
                        )}
                        {material.fileIds.length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-[11px] font-normal"
                          >
                            <Paperclip className="mr-1 h-3 w-3 text-muted-foreground" />
                            {material.fileIds.length}
                          </Badge>
                        )}
                        {material.links.length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-[11px] font-normal"
                          >
                            <Link2 className="mr-1 h-3 w-3 text-muted-foreground" />
                            {material.links.length}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <StaffStatus state={material.state} />
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {material.body}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreview(material)}
                  className="gap-1.5"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("lmsStaffPreview")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEdit(material)}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("lmsStaffEdit")}
                </Button>
                {material.state === "published" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setArchive(material)}
                    className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("lmsStaffArchiveMaterial")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {edit && (
        <MaterialEditor
          key={edit === true ? "new" : edit.id}
          runId={runId}
          enrollments={enrollments}
          initial={edit === true ? undefined : edit}
          onClose={() => setEdit(null)}
        />
      )}
      <StaffDialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        titleKey="lmsStaffPreview"
        description={preview?.title}
      >
        {preview && (
          <div className="space-y-5">
            <LearningText text={preview.body} />
            {preview.links.filter(safeStaffLink).map((link) => (
              <a
                key={link}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all text-primary underline"
              >
                {link}
              </a>
            ))}
            <StaffFiles runId={runId} ids={preview.fileIds} />
          </div>
        )}
      </StaffDialog>
      <StaffConfirm
        open={archive !== null}
        onOpenChange={(open) => {
          if (!open) setArchive(null);
        }}
        titleKey="lmsStaffArchiveMaterialTitle"
        description="lmsStaffArchiveMaterialBody"
        action="lmsStaffArchiveMaterial"
        pending={archiveAction.isPending}
        error={archiveAction.error}
        onConfirm={() => archiveAction.mutate()}
      >
        <p className="font-medium">{archive?.title}</p>
      </StaffConfirm>
    </div>
  );
}
export function MaterialEditor({
  runId,
  enrollments,
  initial,
  initialUnitId,
  onClose,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
  initial?: LmsStaffMaterialDto;
  initialUnitId?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useStaffError();
  const invalidate = useStaffInvalidate();
  const units = useStaffQuery("units", runId, (signal) =>
    lmsStaffApi.units(runId, signal),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState<"lesson" | "practice" | "repeat">(
    initial?.category ?? "lesson",
  );
  const [unit, setUnit] = useState(
    String(initial?.unitId ?? initialUnitId ?? ""),
  );
  const [links, setLinks] = useState(initial?.links.join("\n") ?? "");
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? "");
  const [duration, setDuration] = useState(
    String(initial?.durationMinutes ?? ""),
  );
  const [fileIds, setFileIds] = useState(initial?.fileIds ?? []);
  const [publish, setPublish] = useState(initial?.state === "published");
  const [publishAt, setPublishAt] = useState(
    staffDateInput(initial?.publishAt ?? new Date().toISOString()),
  );
  const [selected, setSelected] = useState(
    enrollments
      .filter((item) => item.status === "active")
      .map((item) => item.id),
  );
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: (input: Parameters<typeof lmsStaffApi.material>[0]) =>
      lmsStaffApi.material(input, initial?.id),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const dirty =
    title !== (initial?.title ?? "") ||
    body !== (initial?.body ?? "") ||
    links !== (initial?.links.join("\n") ?? "") ||
    videoUrl !== (initial?.videoUrl ?? "") ||
    duration !== String(initial?.durationMinutes ?? "") ||
    JSON.stringify(fileIds) !== JSON.stringify(initial?.fileIds ?? []);
  function save(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    const parsed = lmsMaterialSchema.safeParse({
      idempotencyKey,
      runId,
      unitId: unit ? Number(unit) : null,
      title,
      body,
      category,
      links: links
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      fileIds,
      videoUrl: videoUrl.trim() || null,
      durationMinutes: duration ? Number(duration) : null,
      publishAt: publish ? staffDateIso(publishAt) : null,
      recipientEnrollmentIds: publish ? selected : undefined,
    });
    if (!parsed.success) {
      setValidation(t("portalInvalidData"));
      return;
    }
    if (publish && !selected.length) {
      setValidation(t("lmsStaffNoRecipients"));
      return;
    }
    action.mutate(parsed.data);
  }
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey={initial ? "lmsStaffEdit" : "lmsStaffAddMaterial"}
      dirty={dirty}
      pending={action.isPending}
    >
      <form onSubmit={save} className="space-y-5">
        <StaffField id="material-title" labelKey="lmsStaffTitleField">
          <Input
            id="material-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
          />
        </StaffField>
        <div className="grid gap-4 sm:grid-cols-2">
          <StaffField id="material-category" labelKey="lmsStaffCategory">
            <select
              id="material-category"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as typeof category)
              }
            >
              <option value="lesson">{t("portalForLesson")}</option>
              <option value="practice">{t("portalPractice")}</option>
              <option value="repeat">{t("portalRevision")}</option>
            </select>
          </StaffField>
          <StaffField id="material-unit" labelKey="portalLessons">
            <select
              id="material-unit"
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
        </div>
        <StaffField id="material-body" labelKey="lmsStaffBody">
          <StaffEditor id="material-body" value={body} onChange={setBody} />
        </StaffField>
        <StaffField id="material-links" labelKey="portalLinks">
          <Input
            id="material-links"
            value={links}
            onChange={(event) => setLinks(event.target.value)}
            placeholder={t("portalLinkPlaceholder")}
          />
        </StaffField>
        <div className="grid gap-4 sm:grid-cols-2">
          <StaffField id="material-video" labelKey="lmsStaffVideoUrl">
            <Input
              id="material-video"
              type="url"
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
            />
          </StaffField>
          <StaffField id="material-duration" labelKey="lmsStaffDurationMinutes">
            <Input
              id="material-duration"
              type="number"
              min={1}
              max={1440}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </StaffField>
        </div>
        <StaffUploads
          runId={runId}
          ids={fileIds}
          onChange={setFileIds}
          onBusyChange={setBusy}
        />
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
          />
          {t("lmsStaffPublish")}
        </label>
        {publish && (
          <>
            <StaffField id="material-publishAt" labelKey="lmsStaffOpensAt">
              <Input
                id="material-publishAt"
                type="datetime-local"
                value={publishAt}
                onChange={(event) => setPublishAt(event.target.value)}
                required
              />
            </StaffField>
            <StaffRecipients
              items={enrollments}
              selected={selected}
              onChange={setSelected}
            />
          </>
        )}
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || errorText(action.error)}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="submit" disabled={action.isPending || busy}>
            {t(publish ? "lmsStaffPublish" : "lmsStaffSave")}
          </Button>
        </div>
      </form>
    </StaffDialog>
  );
}
