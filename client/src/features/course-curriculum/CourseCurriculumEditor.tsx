import { useId, useState, type ReactNode } from 'react';
import { useFormContext, useWatch, type FieldError, type FieldPath } from 'react-hook-form';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { CourseCurriculum, CourseCurriculumMaterial } from '@shared/contracts/course-curriculum';
import type { CourseValues } from '@/lib/academyResourceSchemas';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createCurriculumBlock, createCurriculumLesson, createCurriculumMaterial, moveCurriculumItem } from './editor-model';
import { CourseMaterialFileUpload } from './CourseMaterialFileUpload';

type ControlAttributes = { id: string; name: string; 'aria-invalid': boolean; 'aria-describedby'?: string };

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
    <div className="space-y-2">
      {label ? <Label htmlFor={id}>{label}{required ? <span aria-hidden="true" className="ml-1 text-destructive">*</span> : null}</Label> : null}
      {children?.({ id, name: path, 'aria-invalid': Boolean(message), 'aria-describedby': message ? `${id}-error` : undefined })}
      {message ? <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
        {Object.prototype.hasOwnProperty.call(translations, message) ? t(message as TranslationKey) : message}
      </p> : null}
    </div>
  );
}

function ItemActions({ index, count, onMove, onDelete, label }: {
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 gap-1">
      <Button type="button" size="icon" variant="ghost" disabled={index === 0}
        aria-label={`${t('moveUp')}: ${label}`} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
      <Button type="button" size="icon" variant="ghost" disabled={index === count - 1}
        aria-label={`${t('moveDown')}: ${label}`} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
      <Button type="button" size="icon" variant="ghost" className="text-destructive"
        aria-label={`${t('delete')}: ${label}`} onClick={onDelete}><Trash2 className="size-4" /></Button>
    </div>
  );
}

export function CourseCurriculumEditor({ unavailable = false, onUploadBusyChange, disabled = false }: {
  unavailable?: boolean;
  onUploadBusyChange: (id: string, busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const form = useFormContext<CourseValues>();
  const program = useWatch({ control: form.control, name: 'program' });
  const [deleteTarget, setDeleteTarget] = useState<{
    blockId: string;
    lessonId?: string;
    materialId?: string;
    name: string;
  } | null>(null);
  const [typeChange, setTypeChange] = useState<{
    blockId: string; lessonId: string; materialId: string; type: CourseCurriculumMaterial['type'];
  } | null>(null);
  const materialOptions = [
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
      <section className="space-y-3" aria-label={t('courseCurriculum')}>
        <h3 className="text-base font-semibold">{t('courseCurriculum')}</h3>
        <p role="alert" className="text-sm text-destructive">{t('courseCurriculumLoadFailed')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label={t('courseCurriculum')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('courseCurriculum')}</h3>
        <Button type="button" variant="outline" onClick={() => change({ ...program, blocks: [...program.blocks, createCurriculumBlock()] })}>
          <Plus className="mr-1.5 size-4" />{t('courseAddBlock')}
        </Button>
      </div>
      {program.blocks.length === 0 ? <p className="text-sm">{t('courseNoBlocks')}</p> : null}
      {program.blocks.map((block, blockIndex) => {
        const blockLabel = block.title || t('courseBlockNumber', { number: blockIndex + 1 });
        return (
          <section key={block.id} className="min-w-0 space-y-4 rounded-xl border bg-muted/20 p-3 sm:p-4" aria-label={blockLabel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium">{t('courseBlockNumber', { number: blockIndex + 1 })}</h4>
              <ItemActions index={blockIndex} count={program.blocks.length} label={blockLabel}
                onMove={(direction) => change({ ...program, blocks: moveCurriculumItem(program.blocks, blockIndex, direction) })}
                onDelete={() => setDeleteTarget({ blockId: block.id, name: blockLabel })} />
            </div>
            <CurriculumField path={`program.blocks.${blockIndex}.title`} label={t('courseBlockTitle')}>
              {(attributes) => <Input {...attributes} value={block.title} onChange={(event) => updateBlock(blockIndex, { title: event.target.value })} maxLength={255} />}
            </CurriculumField>
            {block.lessons.map((lesson, lessonIndex) => {
              const lessonLabel = lesson.title || t('courseLessonNumber', { number: lessonIndex + 1 });
              return (
                <section key={lesson.id} className="min-w-0 space-y-4 rounded-lg border bg-background p-3 sm:p-4" aria-label={lessonLabel}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-sm font-medium">{t('courseLessonNumber', { number: lessonIndex + 1 })}</h5>
                    <ItemActions index={lessonIndex} count={block.lessons.length} label={lessonLabel}
                      onMove={(direction) => updateBlock(blockIndex, { lessons: moveCurriculumItem(block.lessons, lessonIndex, direction) })}
                      onDelete={() => setDeleteTarget({ blockId: block.id, lessonId: lesson.id, name: lessonLabel })} />
                  </div>
                  <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.title`} label={t('courseLessonTitle')}>
                    {(attributes) => <Input {...attributes} value={lesson.title} onChange={(event) => updateLesson(blockIndex, lessonIndex, { title: event.target.value })} maxLength={255} />}
                  </CurriculumField>
                  <div className="space-y-3">
                    {lesson.materials.map((material, materialIndex) => {
                      const materialLabel = material.title || t('courseMaterialNumber', { number: materialIndex + 1 });
                      return (
                        <section key={material.id} className="space-y-3 rounded-lg border p-3" aria-label={materialLabel}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h6 className="text-sm font-medium">{t('courseMaterialNumber', { number: materialIndex + 1 })}</h6>
                            <ItemActions index={materialIndex} count={lesson.materials.length} label={materialLabel}
                              onMove={(direction) => updateLesson(blockIndex, lessonIndex, { materials: moveCurriculumItem(lesson.materials, materialIndex, direction) })}
                              onDelete={() => setDeleteTarget({ blockId: block.id, lessonId: lesson.id, materialId: material.id, name: materialLabel })} />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.title`} label={t('courseMaterialTitle')}>
                              {(attributes) => <Input {...attributes} value={material.title} onChange={(event) => updateMaterial(blockIndex, lessonIndex, materialIndex, { title: event.target.value })} maxLength={255} />}
                            </CurriculumField>
                            <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.type`} label={t('courseMaterialType')}>
                              {(attributes) => <Select value={material.type} onValueChange={(type: CourseCurriculumMaterial['type']) => {
                                if (material.file && type !== 'file') setTypeChange({ blockId: block.id, lessonId: lesson.id, materialId: material.id, type });
                                else updateMaterial(blockIndex, lessonIndex, materialIndex, { type });
                              }}>
                                <SelectTrigger {...attributes}><SelectValue /></SelectTrigger>
                                <SelectContent>{materialOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                              </Select>}
                            </CurriculumField>
                          </div>
                          {material.type === 'file' ? <>
                            <CourseMaterialFileUpload materialId={material.id} file={material.file} onBusyChange={onUploadBusyChange} disabled={disabled}
                              onUploaded={(file) => {
                                const current = form.getValues('program').blocks.find((item) => item.id === block.id)?.lessons
                                  .find((item) => item.id === lesson.id)?.materials.find((item) => item.id === material.id);
                                if (current?.type === 'file') updateMaterialById(block.id, lesson.id, material.id, {
                                  file, content: '', title: current.title || file.name,
                                });
                              }} />
                            <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.file`} />
                          </> : null}
                          {material.file && material.type === 'file' ? null : <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials.${materialIndex}.content`} label={material.type === 'text' ? t('courseMaterialContent') : t('courseMaterialUrl')} required={material.type !== 'file'}>
                            {(attributes) => material.type === 'text'
                              ? <Textarea {...attributes} value={material.content} onChange={(event) => updateMaterial(blockIndex, lessonIndex, materialIndex, { content: event.target.value })} rows={4} />
                              : <Input {...attributes} value={material.content} onChange={(event) => updateMaterial(blockIndex, lessonIndex, materialIndex, { content: event.target.value })} type="url" />}
                          </CurriculumField>}
                        </section>
                      );
                    })}
                    <CurriculumField path={`program.blocks.${blockIndex}.lessons.${lessonIndex}.materials`} />
                    <Button type="button" variant="outline" size="sm" onClick={() => updateLesson(blockIndex, lessonIndex, { materials: [...lesson.materials, createCurriculumMaterial()] })}>
                      <Plus className="mr-1.5 size-4" />{t('courseAddMaterial')}
                    </Button>
                  </div>
                </section>
              );
            })}
            <CurriculumField path={`program.blocks.${blockIndex}.lessons`} />
            <Button type="button" variant="outline" size="sm" onClick={() => updateBlock(blockIndex, { lessons: [...block.lessons, createCurriculumLesson()] })}>
              <Plus className="mr-1.5 size-4" />{t('courseAddLesson')}
            </Button>
          </section>
        );
      })}
      <CurriculumField path="program.blocks" />
      <CurriculumField path="program" />
      <ConfirmDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('courseDeleteCurriculumItem')} description={t('courseDeleteCurriculumItemConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('delete')} variant="destructive" onConfirm={confirmDelete} />
      <ConfirmDialog open={typeChange !== null} onOpenChange={(open) => { if (!open) setTypeChange(null); }}
        title={t('courseRemoveMaterialFile')} description={t('courseRemoveMaterialFileConfirm')}
        confirmLabel={t('courseRemoveMaterialFile')} variant="destructive" onConfirm={() => {
          if (typeChange) updateMaterialById(typeChange.blockId, typeChange.lessonId, typeChange.materialId, { type: typeChange.type, file: undefined, content: '' });
          setTypeChange(null);
        }} />
    </section>
  );
}
