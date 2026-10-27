import { isLmsLearningRecipient } from "@shared/contracts/lms";
import { DateTimeInput } from '@/components/ui/date-time-input';
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  lmsMaterialSchema,
  type LmsStaffMaterialDto,
  type LmsStaffEnrollmentDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { NativeCheckbox } from "@/components/ui/checkbox";
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("lmsStaffMaterials")}</h2>
        <Button onClick={() => setEdit(true)}>
          {t("lmsStaffAddMaterial")}
        </Button>
      </div>
      {query.data.length === 0 && <StaffEmpty />}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data.map((material) => (
          <Card key={material.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold">
                  {material.title}
                </h3>
                <StaffStatus state={material.state} />
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {material.body}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setPreview(material)}>
                  {t("lmsStaffPreview")}
                </Button>
                <Button variant="outline" onClick={() => setEdit(material)}>
                  {t("lmsStaffEdit")}
                </Button>
                {material.state === "published" && (
                  <Button variant="ghost" onClick={() => setArchive(material)}>
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
      .filter(isLmsLearningRecipient)
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
          <NativeCheckbox
            type="checkbox"
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
          />
          {t("lmsStaffPublish")}
        </label>
        {publish && (
          <>
            <StaffField id="material-publishAt" labelKey="lmsStaffOpensAt">
              <DateTimeInput
                id="material-publishAt"
                value={publishAt}
                onValueChange={(value) => setPublishAt(value)}
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
          <Button loading={action.isPending || busy} type="submit" disabled={action.isPending || busy}>
            {t(publish ? "lmsStaffPublish" : "lmsStaffSave")}
          </Button>
        </div>
      </form>
    </StaffDialog>
  );
}
