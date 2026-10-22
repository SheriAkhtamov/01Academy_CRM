import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useFormContext, useWatch, type FieldError, type FieldPath } from 'react-hook-form';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
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
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import {
  createCurriculumBlock,
  createCurriculumLesson,
  createCurriculumMaterial,
  duplicateCurriculumBlock,
  duplicateCurriculumLesson,
  insertCurriculumItemAfter,
  moveCurriculumItem,
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
        <Label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
          {required ? <span aria-hidden="true" className="ml-1 text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children?.({ id, name: path, 'aria-invalid': Boolean(message), 'aria-describedby': message ? `${id}-error` : undefined })}
      {message ? (
        <p id={`${id}-error`} role="alert" tabIndex={-1} data-curriculum-error className="text-sm font-medium text-destructive">
          {Object.prototype.hasOwnProperty.call(translations, message) ? t(message as TranslationKey) : message}
        </p>
      ) : null}
    </div>
  );
}

function ItemActions({ index, count, onMove, onDuplicate, onDelete, label, disabled = false }: {
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border-strong bg-background/90 p-0.5">
      {onDuplicate ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          disabled={disabled}
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
        disabled={disabled || index === 0}
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
        disabled={disabled || index === count - 1}
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
        disabled={disabled}
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
  isUploading,
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
  isUploading: boolean;
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
  const typeSelectDisabled = disabled || isUploading;

  return (
    <section
      className="space-y-2.5 rounded-md border border-border-strong bg-muted/25 p-2.5"
      aria-label={materialLabel}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg border', style.tint)}>
            <TypeIcon className="size-3.5" aria-hidden="true" />
          </span>
          <h6 className="min-w-0 break-words text-xs font-semibold">
            {material.title || t('courseMaterialNumber', { number: materialIndex + 1 })}
          </h6>
        </div>
        <ItemActions
          index={materialIndex}
          count={materialCount}
          label={materialLabel}
          disabled={disabled}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
      <fieldset disabled={disabled} className="min-w-0 space-y-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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
                disabled={typeSelectDisabled}
                onValueChange={(type: CourseCurriculumMaterial['type']) => {
                  if (material.file && type !== 'file') {
                    onRequestTypeChange(type);
                    return;
                  }
                  const shouldClearTextContent =
                    material.type === 'text' &&
                    type !== 'text' &&
                    material.content.length > 0 &&
                    !material.content.trim().startsWith('https://');
                  onUpdate(shouldClearTextContent ? { type, content: '' } : { type });
                }}
              >
                <SelectTrigger {...attributes} disabled={typeSelectDisabled} className="bg-background">
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
      </fieldset>
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
  parentExpanded,
  uploadingMaterialIds,
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
  parentExpanded: boolean;
  uploadingMaterialIds: ReadonlySet<string>;
  onToggleCollapse: () => void;
  materialOptions: Array<{ value: CourseCurriculumMaterial['type']; label: string }>;
  disabled: boolean;
  onUploadBusyChange: (id: string, busy: boolean) => void;
  onUpdateLesson: (updates: Partial<CourseCurriculumLesson>, options?: { validate?: boolean }) => void;
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
  const contentId = useId();
  // Defer unopened lessons, then keep their file uploads and retry state mounted.
  const [contentMounted, setContentMounted] = useState(!collapsed && parentExpanded);
  useEffect(() => {
    if (!collapsed && parentExpanded) setContentMounted(true);
  }, [collapsed, parentExpanded]);

  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-border-strong bg-background"
      aria-label={lessonLabel}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 bg-violet-500/10 p-1.5">
        <button
          type="button"
          className="flex min-h-9 min-w-0 flex-[1_1_12rem] items-center gap-2 rounded-md px-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${collapsed ? t('courseExpandSection') : t('courseCollapseSection')}: ${lessonLabel}`}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={onToggleCollapse}
        >
          <ChevronDown className={cn('size-4 shrink-0 text-violet-600 transition-transform', !collapsed && 'rotate-180')} aria-hidden="true" />
          <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-violet-700 dark:text-violet-300">
            {blockIndex + 1}.{lessonIndex + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{lessonLabel}</span>
          <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
            {t('courseMaterialsStat', { count: lesson.materials.length })}
          </Badge>
        </button>
        <ItemActions
          index={lessonIndex}
          count={block.lessons.length}
          label={lessonLabel}
          disabled={disabled}
          onDuplicate={onDuplicateLesson}
          onMove={onMoveLesson}
          onDelete={onDeleteLesson}
        />
      </div>
      <div id={contentId} hidden={collapsed}>
        {contentMounted ? (
          <div className="space-y-2.5 p-2.5">
            <fieldset disabled={disabled}>
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
            </fieldset>
            <div className="space-y-2.5">
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
                    isUploading={uploadingMaterialIds.has(material.id)}
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
                className="h-8 border-dashed text-xs"
                disabled={disabled}
                onClick={() => onUpdateLesson({ materials: [...lesson.materials, createCurriculumMaterial()] }, { validate: false })}
              >
                <Plus className="mr-1.5 size-4" />
                {t('courseAddMaterial')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CourseCurriculumEditor({
  unavailable = false,
  onUploadBusyChange,
  disabled = false,
}: {
  unavailable?: boolean;
  onUploadBusyChange: (id: string, busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const form = useFormContext<CourseValues>();
  const program = useWatch({ control: form.control, name: 'program' });
  const { submitCount, isSubmitted, errors } = form.formState;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(
    form.getValues('program').blocks.flatMap((block, index) => [
      ...(index > 0 ? [block.id] : []),
      ...block.lessons.slice(1).map((lesson) => lesson.id),
    ]),
  ));
  const [uploadingMaterialIds, setUploadingMaterialIds] = useState<Set<string>>(() => new Set());
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

  const handleUploadBusyChange = useCallback((id: string, busy: boolean) => {
    onUploadBusyChange(id, busy);
    setUploadingMaterialIds((prev) => {
      const has = prev.has(id);
      if (busy === has) return prev;
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, [onUploadBusyChange]);

  useEffect(() => {
    if (submitCount === 0) return;
    const blockErrors = form.formState.errors.program?.blocks;
    if (!Array.isArray(blockErrors)) return;
    const currentBlocks = form.getValues('program').blocks;
    const idsToExpand = new Set<string>();
    currentBlocks.forEach((block, blockIndex) => {
      const blockError = blockErrors[blockIndex];
      if (!blockError) return;
      idsToExpand.add(block.id);
      const lessonErrors = blockError.lessons;
      if (Array.isArray(lessonErrors)) {
        block.lessons.forEach((lesson, lessonIndex) => {
          if (lessonErrors[lessonIndex]) {
            idsToExpand.add(lesson.id);
          }
        });
      }
    });
    if (idsToExpand.size === 0) return;
    setCollapsedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      idsToExpand.forEach((id) => {
        if (next.delete(id)) changed = true;
      });
      return changed ? next : prev;
    });
  }, [form, submitCount]);

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
    if (allCollapsed) {
      setCollapsedIds(new Set());
      return;
    }
    const next = new Set(allCollapsibleIds);
    setCollapsedIds(next);
  };

  const materialOptions: Array<{ value: CourseCurriculumMaterial['type']; label: string }> = [
    { value: 'text', label: t('courseMaterialText') },
    { value: 'link', label: t('courseMaterialLink') },
    { value: 'video', label: t('courseMaterialVideo') },
    { value: 'file', label: t('courseMaterialFile') },
  ];

  const change = (
    next: CourseCurriculum,
    options?: { validate?: boolean },
  ) => {
    const shouldValidate = options?.validate ?? (isSubmitted || Boolean(errors.program));
    form.setValue('program', next, { shouldDirty: true, shouldValidate });
  };
  const updateBlock = (
    blockIndex: number,
    updates: Partial<CourseCurriculum['blocks'][number]>,
    options?: { validate?: boolean },
  ) => {
    change(
      { ...program, blocks: program.blocks.map((block, index) => index === blockIndex ? { ...block, ...updates } : block) },
      options,
    );
  };
  const updateLesson = (
    blockIndex: number,
    lessonIndex: number,
    updates: Partial<CourseCurriculum['blocks'][number]['lessons'][number]>,
    options?: { validate?: boolean },
  ) => {
    const block = program.blocks[blockIndex];
    updateBlock(
      blockIndex,
      { lessons: block.lessons.map((lesson, index) => index === lessonIndex ? { ...lesson, ...updates } : lesson) },
      options,
    );
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
    if (!deleteTarget || disabled) return;
    const { blockId, lessonId, materialId } = deleteTarget;
    const deletedCollapseIds = new Set<string>();
    const blocks = program.blocks.flatMap((block) => {
      if (block.id !== blockId) return [block];
      if (!lessonId) {
        deletedCollapseIds.add(block.id);
        block.lessons.forEach((lesson) => deletedCollapseIds.add(lesson.id));
        return [];
      }
      return [{ ...block, lessons: block.lessons.flatMap((lesson) => {
        if (lesson.id !== lessonId) return [lesson];
        if (!materialId) {
          deletedCollapseIds.add(lesson.id);
          return [];
        }
        return [{ ...lesson, materials: lesson.materials.filter((material) => material.id !== materialId) }];
      }) }];
    });
    if (deletedCollapseIds.size > 0) {
      setCollapsedIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        deletedCollapseIds.forEach((id) => {
          if (next.delete(id)) changed = true;
        });
        return changed ? next : prev;
      });
    }
    change({ ...program, blocks });
    setDeleteTarget(null);
  };

  if (unavailable) {
    return (
      <CompactModalSection title={t('courseCurriculum')} icon={BookOpen} tone="violet" collapsible={false}>
        <p role="alert" className="text-sm font-medium text-destructive">{t('courseCurriculumLoadFailed')}</p>
      </CompactModalSection>
    );
  }

  return (
    <CompactModalSection
      title={t('courseCurriculum')}
      icon={BookOpen}
      tone="violet"
      collapsible={false}
      count={program.blocks.length}
      contentClassName="space-y-2.5"
      actions={(
        <>
          {program.blocks.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={toggleCollapseAll}>
              {allCollapsed ? <ChevronsUpDown className="mr-1.5 size-3.5" aria-hidden="true" /> : <ChevronsDownUp className="mr-1.5 size-3.5" aria-hidden="true" />}
              {allCollapsed ? t('courseExpandAll') : t('courseCollapseAll')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 bg-background text-xs"
            disabled={disabled}
            onClick={() => change({ ...program, blocks: [...program.blocks, createCurriculumBlock()] }, { validate: false })}
          >
            <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
            {t('courseAddBlock')}
          </Button>
        </>
      )}
    >
      {program.blocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-muted/25 px-4 py-5 text-center">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Layers className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-muted-foreground">{t('courseNoBlocks')}</p>
        </div>
      ) : null}

      {program.blocks.map((block, blockIndex) => {
        const blockLabel = block.title || t('courseBlockNumber', { number: blockIndex + 1 });
        const blockCollapsed = collapsedIds.has(block.id);
        return (
          <CompactModalSection
            key={block.id}
            title={blockLabel}
            summary={t('courseLessonsStat', { count: block.lessons.length })}
            icon={Layers}
            tone="teal"
            open={!blockCollapsed}
            onOpenChange={() => toggleCollapsed(block.id)}
            contentClassName="space-y-2.5"
            actions={(
              <ItemActions
                index={blockIndex}
                count={program.blocks.length}
                label={blockLabel}
                disabled={disabled}
                onDuplicate={() => change({
                  ...program,
                  blocks: insertCurriculumItemAfter(program.blocks, blockIndex, duplicateCurriculumBlock(block)),
                })}
                onMove={(direction) => change({ ...program, blocks: moveCurriculumItem(program.blocks, blockIndex, direction) })}
                onDelete={() => setDeleteTarget({ blockId: block.id, name: blockLabel })}
              />
            )}
          >
            <fieldset disabled={disabled}>
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
            </fieldset>
            <div className="space-y-2.5">
              {block.lessons.map((lesson, lessonIndex) => {
                return (
                  <CurriculumLessonCard
                    key={lesson.id}
                    block={block}
                    blockIndex={blockIndex}
                    lesson={lesson}
                    lessonIndex={lessonIndex}
                    collapsed={collapsedIds.has(lesson.id)}
                    parentExpanded={!blockCollapsed}
                    uploadingMaterialIds={uploadingMaterialIds}
                    onToggleCollapse={() => toggleCollapsed(lesson.id)}
                    materialOptions={materialOptions}
                    disabled={disabled}
                    onUploadBusyChange={handleUploadBusyChange}
                    onUpdateLesson={(updates, options) => updateLesson(blockIndex, lessonIndex, updates, options)}
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
                );
              })}
              <CurriculumField path={`program.blocks.${blockIndex}.lessons`} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-center border-dashed bg-background text-xs"
                disabled={disabled}
                onClick={() => {
                  updateBlock(blockIndex, { lessons: [...block.lessons, createCurriculumLesson()] }, { validate: false });
                  form.clearErrors(`program.blocks.${blockIndex}.lessons`);
                }}
              >
                <Plus className="mr-1.5 size-4" />
                {t('courseAddLesson')}
              </Button>
            </div>
          </CompactModalSection>
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
          if (typeChange && !disabled) {
            updateMaterialById(typeChange.blockId, typeChange.lessonId, typeChange.materialId, {
              type: typeChange.type,
              file: undefined,
              content: '',
            });
          }
          setTypeChange(null);
        }}
      />
    </CompactModalSection>
  );
}
