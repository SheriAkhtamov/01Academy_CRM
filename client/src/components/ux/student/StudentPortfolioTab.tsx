import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, File, FolderOpen, Link, Loader2, Plus, Upload, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_STUDENT_PROJECT_BYTES, studentProjectLinkSchema, type StudentProject } from '@shared/contracts/student-profile';
import { studentsApi } from '@/features/students/api';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function StudentPortfolioTab({ studentId, projects, open, loading, requestAction, onDraftChange, dateTime }: {
  studentId: number; projects: StudentProject[]; open: boolean;
  loading: boolean; requestAction: (action: () => void) => void;
  onDraftChange: (dirty: boolean, pending: boolean) => void;
  dateTime: (value: string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const save = useMutation({
    mutationFn: (input: { title: string; url?: string; file?: File }) => studentsApi.addProject(studentId, input, setPercent),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['student-profile', studentId] });
      void queryClient.invalidateQueries({ queryKey: ['/api/academy/sales'] });
      setTitle(''); setUrl(''); setFile(undefined); setAdding(false); setPercent(0); setError(null);
      toast({ title: t('studentProjectSaved') });
    },
    onError: (error: Error & { status?: number }) => setError(localizeApiErrorMessage(error.message, error.status ?? 0)),
  });
  const dirty = Boolean(title.trim() || url.trim() || file);
  useEffect(() => { onDraftChange(dirty, save.isPending); }, [dirty, onDraftChange, save.isPending]);
  useEffect(() => () => onDraftChange(false, false), [onDraftChange]);
  useEffect(() => {
    if (open) return;
    setAdding(false); setTitle(''); setUrl(''); setFile(undefined); setError(null); setPercent(0);
  }, [open, studentId]);
  const changeMode = (next: string) => { setMode(next); setError(null); };
  const submit = () => {
    if (!title.trim()) { setError(t('studentProjectTitleRequired')); return; }
    if (mode === 'link' && !studentProjectLinkSchema.safeParse(url).success) { setError(t('studentProjectInvalidLink')); return; }
    if (mode === 'file' && !file) { setError(t('studentProjectSourceRequired')); return; }
    setError(null); setPercent(0);
    save.mutate({ title: title.trim(), ...(mode === 'file' ? { file } : { url: url.trim() }) });
  };
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">{t('portfolio')} <span className="ml-1 text-muted-foreground">{projects.length}</span></h3>
      <Button size="sm" variant="outline" disabled={adding || loading} onClick={() => setAdding(true)}><Plus data-icon="inline-start" />{t('studentProjectAdd')}</Button>
    </div>
    {adding ? <form className="space-y-3 rounded-xl border bg-muted/30 p-4" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) submit(); }}>
      <div className="space-y-1.5"><Label htmlFor={`${fieldId}-title`}>{t('studentProjectTitle')}</Label>
        <Input id={`${fieldId}-title`} value={title} maxLength={255} autoFocus disabled={save.isPending} onChange={(event) => setTitle(event.target.value)} /></div>
      <Tabs value={mode} onValueChange={changeMode}><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="link" disabled={save.isPending}><Link className="mr-2 size-4" />{t('studentProjectLink')}</TabsTrigger><TabsTrigger value="file" disabled={save.isPending}><File className="mr-2 size-4" />{t('mediaFile')}</TabsTrigger></TabsList></Tabs>
      {mode === 'link' ? <div className="space-y-1.5"><Label htmlFor={`${fieldId}-link`}>{t('studentProjectLink')}</Label><Input id={`${fieldId}-link`} type="url" value={url} disabled={save.isPending} maxLength={2000} onChange={(event) => setUrl(event.target.value)} /></div> : <div>
        <input ref={fileInput} type="file" className="sr-only" id={`${fieldId}-file`} aria-label={t('mediaFile')} disabled={save.isPending} onChange={(event) => {
          const selected = event.target.files?.[0]; event.target.value = '';
          if (!selected) return;
          if (selected.size > MAX_STUDENT_PROJECT_BYTES) { setFile(undefined); setError(t('studentProjectFileTooLarge')); return; }
          setFile(selected); setError(null); if (!title.trim()) setTitle(selected.name.replace(/\.[^.]+$/, '').slice(0, 255));
        }} />
        <Button type="button" variant="outline" className="h-auto min-h-12 w-full justify-start gap-3 border-dashed py-3" disabled={save.isPending} onClick={() => fileInput.current?.click()}><Upload className="size-4 shrink-0" /><span className="min-w-0 break-all text-left">{file?.name ?? t('studentProjectChooseFile')}</span></Button>
      </div>}
      {save.isPending && mode === 'file' ? <div className="space-y-1.5"><p role="status" className="text-xs text-muted-foreground">{t('studentProjectUploading').replace('{percent}', String(percent))}</p><Progress value={percent} aria-label={t('mediaFile')} /></div> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={save.isPending} onClick={() => requestAction(() => { setAdding(false); setTitle(''); setUrl(''); setFile(undefined); setError(null); })}><X data-icon="inline-start" />{t('cancel')}</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}{t('studentProjectAdd')}</Button></div>
    </form> : null}
    {loading ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</p> : projects.length === 0 && !adding ? <div className="grid place-items-center gap-2 rounded-xl border border-dashed py-10 text-sm text-muted-foreground"><FolderOpen className="size-7 opacity-60" />{t('noProjects')}</div> : <div className="divide-y rounded-xl border">
      {projects.map((project) => <div key={project.id} className="flex flex-wrap items-center gap-3 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/5 text-primary">{project.fileUrl ? <File className="size-5" /> : <Link className="size-5" />}</span>
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{project.title}</p><p className="mt-0.5 break-all text-xs text-muted-foreground">{project.fileName || dateTime(project.createdAt)}</p></div>
        {project.url && studentProjectLinkSchema.safeParse(project.url).success ? <Button size="sm" variant="ghost" asChild><a href={project.url} target="_blank" rel="noopener noreferrer"><ExternalLink data-icon="inline-start" />{t('studentProjectOpen')}</a></Button> : null}
        {project.fileUrl && project.fileUrl.startsWith(`/api/academy/students/${studentId}/projects/files/`) ? <Button size="sm" variant="outline" asChild><a href={project.fileUrl}>{t('download')}</a></Button> : null}
      </div>)}
    </div>}
  </div>;
}
