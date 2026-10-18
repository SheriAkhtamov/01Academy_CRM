import { useEffect, useId, useState, type ReactNode } from 'react';
import { useFormContext, useWatch, type FieldError, type FieldPath } from 'react-hook-form';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileText,
  Layers,
  Link2,
  Paperclip,
  Plus,
  Trash2,
  Video,
} from 'lucide-react';
import type {
  CourseCurriculum,
  CourseCurriculumBlock,
  CourseCurriculumLesson,
  CourseCurriculumMaterial,
} from '@shared/contracts/course-curriculum';
import type { CourseValues } from '@/lib/academyResourceSchemas';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createCurriculumBlock,
  createCurriculumLesson,
  createCurriculumMaterial,
  duplicateCurriculumBlock,
  duplicateCurriculumLesson,
  insertCurriculumItemAfter,
  moveCurriculumItem,
  summarizeCourseCurriculum,
} from './editor-model';
import { CourseMaterialFileUpload } from './CourseMaterialFileUpload';

type ControlAttributes = { id: string; name: string; 'aria-invalid': boolean; 'aria-describedby'?: string };

const MATERIAL_STYLE: Record<CourseCurriculumMaterial['type'], { icon: typeof FileText; tint: string }> = {
  text: { icon: FileText, tint: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  link: { icon: Link2, tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  video: { icon: Video, tint: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' },
  file: { icon: Paperclip, tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
};

function CurriculumField({ path, label, children, required = true }: {
  path: FieldPath<CourseValues>;
  label?: string;
  children?: (attributes: ControlAttributes) => ReactNode;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const form = useFormContext<CourseValues>();
  const error = form.getFieldState(path, form.formState).error as (FieldError & { root?: FieldError }) | undefined;
  const message = error?.message || error?.root?.message;
  return (
    <div className="space-y-1.5">
      {label ? (
        <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
          {required ? <span aria-hidden="true" className="ml-1 text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children?.({ id, name: path, 'aria-invalid': Boolean(message), 'aria-describedby': message ? `${id}-error` : undefined })}
      {message ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {Object.prototype.hasOwnProperty.call(translations, message) ? t(message as TranslationKey) : message}
        </p>
      ) : null}
    </div>
  );
}

function ItemActions({ index, count, onMove, onDuplicate, onDelete, label }: {
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-sm">
      {onDuplicate ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={`${t('courseDuplicateItem')}: ${label}`}
          onClick={onDuplicate}
        >
          <Copy className="size-3.5" />
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={index === 0}
        aria-label={`${t('moveUp')}: ${label}`}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={index === count - 1}
        aria-label={`${t('moveDown')}: ${label}`}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
        aria-label={`${t('delete')}: ${label}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function CurriculumMaterialCard({
  blockId,
  blockIndex,
  lessonId,
  lessonIndex,
  material,
  materialIndex,
  materialCount,
  materialOptions,
  disabled,
  onUploadBusyChange,
  onUpdate,
  onUploadedFile,
  onRequestTypeChange,
  onMove,
  onDelete,
}: {
  blockId: string;
  blockIndex: number;
  lessonId: string;
  lessonIndex: number;
  material: CourseCurriculumMaterial;
  materialIndex: number;
  materialCount: number;
  materialOptions: Array<{ value: CourseCurriculumMaterial['type']; label: string }>;
  disabled: boolean;
  onUploadBusyChange: (id: string, busy: boolean) => void;
  onUpdate: (updates: Partial<CourseCurriculumMaterial>) => void;
  onUploadedFile: (file: NonNullable<CourseCurriculumMaterial['file']>) => void;
  onRequestTypeChange: (type: CourseCurriculumMaterial['type']) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const materialLabel = material.title || t('courseMaterialNumber', { number: materialIndex + 1 });
  const style = MATERIAL_STYLE[material.type];
  const TypeIcon = style.icon;

  return (
    <section
      className="space-y-3 rounded-xl border bg-muted/15 p-3.5 transition-colors hover:border-border/90"
      aria-label={materialLabel}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg border', style.tint)}>
            <TypeIcon className="size-3.5" aria-hidden="true" />
          </span>
          <h6 className="truncate text-sm font-semibold">
            {material.title || t('courseMaterialNumber', { number: materialIndex + 1 })}
          </h6>
        </div>
        <ItemActions
          index={materialIndex}
          count={materialCount}
          label={materialLabel}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.title`} label={t('courseMaterialTitle')}>
            {(attributes) => (
              <Input
                {...attributes}
                value={material.title}
                onChange={(event) => onUpdate({ title: event.target.value })}
                maxLength={255}
                className="bg-background"
              />
            )}
          </CurriculumField>
        </div>
        <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.type`} label={t('courseMaterialType')}>
          {(attributes) => (
            <Select
              value={material.type}
              onValueChange={(type: CourseCurriculumMaterial['type']) => {
                if (material.file && type !== 'file') onRequestTypeChange(type);
                else onUpdate({ type });
              }}
            >
              <SelectTrigger {...attributes} className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {materialOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CurriculumField>
      </div>
      {material.type === 'file' ? (
        <>
          <CourseMaterialFileUpload
            materialId={material.id}
            file={material.file}
            onBusyChange={onUploadBusyChange}
            disabled={disabled}
            onUploaded={onUploadedFile}
          />
          <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.file`} />
        </>
      ) : null}
      {material.file && material.type === 'file' ? null : (
        <CurriculumField
          path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.content`}
          label={material.type === 'text' ? t('courseMaterialContent') : t('courseMaterialUrl')}
          required={material.type !== 'file'}
        >
          {(attributes) => material.type === 'text' ? (
            <Textarea
              {...attributes}
              value={material.content}
              onChange={(event) => onUpdate({ content: event.target.value })}
              rows={3}
              className="bg-background"
            />
          ) : (
            <Input
              {...attributes}
              value={material.content}
              onChange={(event) => onUpdate({ content: event.target.value })}
              type="url"
              placeholder="https://"
              className="bg-background font-mono text-sm"
            />
          )}
        </CurriculumField>
      )}
      <span className="sr-only" data-block-id={blockId} data-lesson-id={lessonId} />
    </section>
  );
}

function CurriculumLessonCard({
  block,
  blockIndex,
  lesson,
  lessonIndex,
  collapsed,
  onToggleCollapse,
  materialOptions,
  disabled,
  onUploadBusyChange,
  onUpdateLesson,
  onUpdateMaterial,
  onUploadedMaterialFile,
  onRequestTypeChange,
  onDuplicateLesson,
  onMoveLesson,
  onDeleteLesson,
  onDeleteMaterial,
}: {
  block: CourseCurriculumBlock;
  blockIndex: number;
  lesson: CourseCurriculumLesson;
  lessonIndex: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  materialOptions: Array<{ value: CourseCurriculumMaterial['type']; label: string }>;
  disabled: boolean;
  onUploadBusyChange: (id: string, busy: boolean) => void;
  onUpdateLesson: (updates: Partial<CourseCurriculumLesson>) => void;
  onUpdateMaterial: (materialIndex: number, updates: Partial<CourseCurriculumMaterial>) => void;
  onUploadedMaterialFile: (materialId: string, file: NonNullable<CourseCurriculumMaterial['file']>) => void;
  onRequestTypeChange: (materialId: string, type: CourseCurriculumMaterial['type']) => void;
  onDuplicateLesson: () => void;
  onMoveLesson: (direction: -1 | 1) => void;
  onDeleteLesson: () => void;
  onDeleteMaterial: (materialId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const lessonLabel = lesson.title || t('courseLessonNumber', { number: lessonIndex + 1 });

  return (
    <section
      className="min-w-0 rounded-xl border bg-background shadow-sm transition-all hover:border-primary/30"
      aria-label={lessonLabel}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/10 px-3.5 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={`${collapsed ? t('courseExpandSection') : t('courseCollapseSection')}: ${lessonLabel}`}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
          <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-primary/10 px-2 font-mono text-xs font-semibold text-primary">
            {blockIndex + 1}.{lessonIndex + 1}
          </span>
          <h5 className="truncate text-sm font-semibold">
            {lesson.title || t('courseLessonNumber', { number: lessonIndex + 1 })}
          </h5>
          <Badge variant="secondary" className="ml-auto shrink-0 text-xs font-normal sm:ml-1">
            {t('courseMaterialsStat', { count: lesson.materials.length })}
          </Badge>
        </div>
        <ItemActions
          index={lessonIndex}
          count={block.lessons.length}
          label={lessonLabel}
          onDuplicate={onDuplicateLesson}
          onMove={onMoveLesson}
          onDelete={onDeleteLesson}
        />
      </div>
      {!collapsed ? (
        <div className="space-y-4 p-3.5 sm:p-4">
          <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.title`} label={t('courseLessonTitle')}>
            {(attributes) => (
              <Input
                {...attributes}
                value={lesson.title}
                onChange={(event) => onUpdateLesson({ title: event.target.value })}
                maxLength={255}
              />
            )}
          </CurriculumField>
          <div className="space-y-3">
            {lesson.materials.map((material, materialIndex) => {
              const materialLabel = material.title || t('courseMaterialNumber', { number: materialIndex + 1 });
              return (
                <CurriculumMaterialCard
                  key={material.id}
                  blockId={block.id}
                  blockIndex={blockIndex}
                  lessonId={lesson.id}
                  lessonIndex={lessonIndex}
                  material={material}
                  materialIndex={materialIndex}
                  materialCount={lesson.materials.length}
                  materialOptions={materialOptions}
                  disabled={disabled}
                  onUploadBusyChange={onUploadBusyChange}
                  onUpdate={(updates) => onUpdateMaterial(materialIndex, updates)}
                  onUploadedFile={(file) => onUploadedMaterialFile(material.id, file)}
                  onRequestTypeChange={(type) => onRequestTypeChange(material.id, type)}
                  onMove={(direction) => onUpdateLesson({ materials: moveCurriculumItem(lesson.materials, materialIndex, direction) })}
                  onDelete={() => onDeleteMaterial(material.id, materialLabel)}
                />
              );
            })}
            <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials`} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-dashed"
              onClick={() => onUpdateLesson({ materials: [...lesson.materials, createCurriculumMaterial()] })}
            >
              <Plus className="mr-1.5 size-4" />
              {t('courseAddMaterial')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function CourseCurriculumEditor({
  unavailable = false,
  onUploadBusyChange,
  disabled = false,
  focusBlockRequest = null,
}: {
  unavailable?: boolean;
  onUploadBusyChange: (id: string, busy: boolean) => void;
  disabled?: boolean;
  focusBlockRequest?: { blockId: string; seq: number } | null;
}) {
  const { t } = useTranslation();
  const form = useFormContext<CourseValues>();
  const program = useWatch({ control: form.control, name: 'program' });
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<{
    blockId: string;
    lessonId?: string;
    materialId?: string;
    name: string;
  } | null>(null);
  const [typeChange, setTypeChange] = useState<{
    blockId: string;
    lessonId: string;
    materialId: string;
    type: CourseCurriculumMaterial['type'];
  } | null>(null);

  const hasProgramErrors = Boolean(form.formState.errors.program);
  const stats = summarizeCourseCurriculum(program);

  useEffect(() => {
    if (!focusBlockRequest) return;
    setCollapsedIds((prev) => {
      if (!prev.has(focusBlockRequest.blockId)) return prev;
      const next = new Set(prev);
      next.delete(focusBlockRequest.blockId);
      return next;
    });
    const element = document.getElementById(`course-block-${focusBlockRequest.blockId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusBlockRequest]);

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allCollapsibleIds = program.blocks.flatMap((block) => [
    block.id,
    ...block.lessons.map((lesson) => lesson.id),
  ]);
  const allCollapsed = allCollapsibleIds.length > 0 && allCollapsibleIds.every((id) => collapsedIds.has(id));

  const toggleCollapseAll = () => {
    if (allCollapsed) setCollapsedIds(new Set());
    else setCollapsedIds(new Set(allCollapsibleIds));
  };

  const materialOptions: Array<{ value: CourseCurriculumMaterial['type']; label: string }> = [
    { value: 'text', label: t('courseMaterialText') },
    { value: 'link', label: t('courseMaterialLink') },
    { value: 'video', label: t('courseMaterialVideo') },
    { value: 'file', label: t('courseMaterialFile') },
  ];

  const change = (next: CourseCurriculum) => form.setValue('program', next, { shouldDirty: true, shouldValidate: true });
  const updateBlock = (blockIndex: number, updates: Partial<CourseCurriculum['blocks'][number]>) => {
    change({ ...program, blocks: program.blocks.map((block, index) => index === blockIndex ? { ...block, ...updates } : block) });
  };
  const updateLesson = (blockIndex: number, lessonIndex: number, updates: Partial<CourseCurriculum['blocks'][number]['lessons'][number]>) => {
    const block = program.blocks[blockIndex];
    updateBlock(blockIndex, { lessons: block.lessons.map((lesson, index) => index === lessonIndex ? { ...lesson, ...updates } : lesson) });
  };
  const updateMaterial = (blockIndex: number, lessonIndex: number, materialIndex: number, updates: Partial<CourseCurriculumMaterial>) => {
    const lesson = program.blocks[blockIndex].lessons[lessonIndex];
    updateLesson(blockIndex, lessonIndex, { materials: lesson.materials.map((material, index) => index === materialIndex ? { ...material, ...updates } : material) });
  };
  const updateMaterialById = (blockId: string, lessonId: string, materialId: string, updates: Partial<CourseCurriculumMaterial>) => {
    const current = form.getValues('program');
    change({ ...current, blocks: current.blocks.map((block) => block.id !== blockId ? block : {
      ...block, lessons: block.lessons.map((lesson) => lesson.id !== lessonId ? lesson : {
        ...lesson, materials: lesson.materials.map((material) => material.id !== materialId ? material : { ...material, ...updates }),
      }),
    }) });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const { blockId, lessonId, materialId } = deleteTarget;
    const blocks = program.blocks.flatMap((block) => {
      if (block.id !== blockId) return [block];
      if (!lessonId) return [];
      return [{ ...block, lessons: block.lessons.flatMap((lesson) => {
        if (lesson.id !== lessonId) return [lesson];
        if (!materialId) return [];
        return [{ ...lesson, materials: lesson.materials.filter((material) => material.id !== materialId) }];
      }) }];
    });
    change({ ...program, blocks });
    setDeleteTarget(null);
  };

  if (unavailable) {
    return (
      <section className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5" aria-label={t('courseCurriculum')}>
        <h3 className="text-base font-semibold">{t('courseCurriculum')}</h3>
        <p role="alert" className="text-sm font-medium text-destructive">{t('courseCurriculumLoadFailed')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label={t('courseCurriculum')}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="size-4" aria-hidden="true" />
          </span>
          <h3 className="text-base font-semibold">{t('courseCurriculum')}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-xs font-medium">
              {t('courseBlocksStat', { count: stats.blockCount })}
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {t('courseLessonsStat', { count: stats.lessonCount })}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {program.blocks.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleCollapseAll}
            >
              {allCollapsed ? (
                <ChevronsUpDown className="mr-1.5 size-4" aria-hidden="true" />
              ) : (
                <ChevronsDownUp className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {allCollapsed ? t('courseExpandAll') : t('courseCollapseAll')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => change({ ...program, blocks: [...program.blocks, createCurriculumBlock()] })}
          >
            <Plus className="mr-1.5 size-4" />
            {t('courseAddBlock')}
          </Button>
        </div>
      </div>

      {program.blocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed bg-muted/15 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Layers className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-muted-foreground">{t('courseNoBlocks')}</p>
        </div>
      ) : null}

      {program.blocks.map((block, blockIndex) => {
        const blockLabel = block.title || t('courseBlockNumber', { number: blockIndex + 1 });
        const blockCollapsed = !hasProgramErrors && collapsedIds.has(block.id);
        return (
          <section
            key={block.id}
            id={`course-block-${block.id}`}
            className="min-w-0 overflow-hidden rounded-2xl border border-l-4 border-l-primary/70 bg-muted/15 shadow-sm transition-all"
            aria-label={blockLabel}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 text-muted-foreground"
                  aria-label={`${blockCollapsed ? t('courseExpandSection') : t('courseCollapseSection')}: ${blockLabel}`}
                  aria-expanded={!blockCollapsed}
                  onClick={() => toggleCollapsed(block.id)}
                >
                  {blockCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                </Button>
                <span className="inline-flex h-6 shrink-0 items-center justify-center rounded-md bg-primary px-2 font-mono text-xs font-bold text-primary-foreground">
                  {String(blockIndex + 1).padStart(2, '0')}
                </span>
                <h4 className="truncate font-semibold">
                  {block.title || t('courseBlockNumber', { number: blockIndex + 1 })}
                </h4>
                <Badge variant="secondary" className="ml-auto shrink-0 text-xs font-normal sm:ml-1">
                  {t('courseLessonsStat', { count: block.lessons.length })}
                </Badge>
              </div>
              <ItemActions
                index={blockIndex}
                count={program.blocks.length}
                label={blockLabel}
                onDuplicate={() => change({
                  ...program,
                  blocks: insertCurriculumItemAfter(program.blocks, blockIndex, duplicateCurriculumBlock(block)),
                })}
                onMove={(direction) => change({ ...program, blocks: moveCurriculumItem(program.blocks, blockIndex, direction) })}
                onDelete={() => setDeleteTarget({ blockId: block.id, name: blockLabel })}
              />
            </div>

            {!blockCollapsed ? (
              <div className="space-y-4 p-3.5 sm:p-4">
                <CurriculumField path={`program.blocks.${blockIndex}.title`} label={t('courseBlockTitle')}>
                  {(attributes) => (
                    <Input
                      {...attributes}
                      value={block.title}
                      onChange={(event) => updateBlock(blockIndex, { title: event.target.value })}
                      maxLength={255}
                      className="bg-background"
                    />
                  )}
                </CurriculumField>

                <div className="space-y-3 border-l-2 border-primary/20 pl-3 sm:pl-4">
                  {block.lessons.map((lesson, lessonIndex) => (
                    <CurriculumLessonCard
                      key={lesson.id}
                      block={block}
                      blockIndex={blockIndex}
                      lesson={lesson}
                      lessonIndex={lessonIndex}
                      collapsed={!hasProgramErrors && collapsedIds.has(lesson.id)}
                      onToggleCollapse={() => toggleCollapsed(lesson.id)}
                      materialOptions={materialOptions}
                      disabled={disabled}
                      onUploadBusyChange={onUploadBusyChange}
                      onUpdateLesson={(updates) => updateLesson(blockIndex, lessonIndex, updates)}
                      onUpdateMaterial={(materialIndex, updates) => updateMaterial(blockIndex, lessonIndex, materialIndex, updates)}
                      onUploadedMaterialFile={(materialId, file) => {
                        const current = form.getValues('program').blocks.find((item) => item.id === block.id)?.lessons
                          .find((item) => item.id === lesson.id)?.materials.find((item) => item.id === materialId);
                        if (current?.type === 'file') {
                          updateMaterialById(block.id, lesson.id, materialId, {
                            file,
                            content: '',
                            title: current.title || file.name,
                          });
                        }
                      }}
                      onRequestTypeChange={(materialId, type) => setTypeChange({
                        blockId: block.id,
                        lessonId: lesson.id,
                        materialId,
                        type,
                      })}
                      onDuplicateLesson={() => updateBlock(blockIndex, {
                        lessons: insertCurriculumItemAfter(block.lessons, lessonIndex, duplicateCurriculumLesson(lesson)),
                      })}
                      onMoveLesson={(direction) => updateBlock(blockIndex, {
                        lessons: moveCurriculumItem(block.lessons, lessonIndex, direction),
                      })}
                      onDeleteLesson={() => setDeleteTarget({
                        blockId: block.id,
                        lessonId: lesson.id,
                        name: lesson.title || t('courseLessonNumber', { number: lessonIndex + 1 }),
                      })}
                      onDeleteMaterial={(materialId, name) => setDeleteTarget({
                        blockId: block.id,
                        lessonId: lesson.id,
                        materialId,
                        name,
                      })}
                    />
                  ))}
                  <CurriculumField path={`program.blocks.${blockIndex}.lessons`} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center border-dashed bg-background/70 hover:bg-background"
                    onClick={() => updateBlock(blockIndex, { lessons: [...block.lessons, createCurriculumLesson()] })}
                  >
                    <Plus className="mr-1.5 size-4" />
                    {t('courseAddLesson')}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
      <CurriculumField path="program.blocks" />
      <CurriculumField path="program" />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('courseDeleteCurriculumItem')}
        description={t('courseDeleteCurriculumItemConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('delete')}
        variant="destructive"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={typeChange !== null}
        onOpenChange={(open) => { if (!open) setTypeChange(null); }}
        title={t('courseRemoveMaterialFile')}
        description={t('courseRemoveMaterialFileConfirm')}
        confirmLabel={t('courseRemoveMaterialFile')}
        variant="destructive"
        onConfirm={() => {
          if (typeChange) {
            updateMaterialById(typeChange.blockId, typeChange.lessonId, typeChange.materialId, {
              type: typeChange.type,
              file: undefined,
              content: '',
            });
          }
          setTypeChange(null);
        }}
      />
    </section>
  );
}
