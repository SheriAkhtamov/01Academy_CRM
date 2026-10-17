import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Image as ImageIcon, Link, Music, Play, Video } from 'lucide-react';
import { CHAT_MEDIA_CATEGORIES, type ChatMediaCatalog, type ChatMediaCategory, type ChatMediaItem } from '@shared/chat-media';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import { ChatMessageAttachments } from './ChatAttachments';

export const chatMediaLabels = { photos: 'chatGroupPhotos', videos: 'chatGroupVideos', audio: 'chatGroupAudio', files: 'chatGroupFiles', links: 'chatGroupLinks', gifs: 'chatGroupGifs' } as const;
export const chatMediaIcons = { photos: ImageIcon, videos: Video, audio: Music, files: FileText, links: Link, gifs: Play };
export function ChatGroupMediaDialog({ catalog, initialCategory, onClose }: { catalog: ChatMediaCatalog; initialCategory: ChatMediaCategory; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [category, setCategory] = useState<ChatMediaCategory>(initialCategory);
  const [preview, setPreview] = useState<ChatMediaItem>();
  const [failed, setFailed] = useState<string[]>([]);
  const viewer = useRef<HTMLDivElement>(null);
  const images = category === 'videos' ? catalog.videos : category === 'gifs' ? catalog.gifs : catalog.photos;
  const imageIndex = images.findIndex(item => item.file.id === preview?.file.id);
  const caption = (item: Pick<ChatMediaItem, 'senderId' | 'senderName' | 'senderAvatarUrl' | 'createdAt'>) => <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
    <EmployeeIdentity userId={item.senderId} name={item.senderName} avatarUrl={item.senderAvatarUrl} avatarClassName="size-6" /><span>· {formatAcademyDate(item.createdAt, language, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
  </div>;
  const move = (step: number) => { const next = images[imageIndex + step]; if (next) { setPreview(next); viewer.current?.focus(); } };
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t('chatGroupMedia')}</DialogTitle></DialogHeader>
        <Tabs value={category} onValueChange={(value) => setCategory(value as ChatMediaCategory)} className="flex min-h-0 flex-1 flex-col gap-2">
          <TabsList className="w-full shrink-0" indicator="underline">{CHAT_MEDIA_CATEGORIES.map((key) => <TabsTrigger key={key} value={key} aria-label={`${t(chatMediaLabels[key])} ${catalog[key].length}`}>
            {t(chatMediaLabels[key])}<span className="ml-1.5 text-xs tabular-nums">{catalog[key].length}</span>
          </TabsTrigger>)}</TabsList>
          {CHAT_MEDIA_CATEGORIES.map((key) => <TabsContent key={key} value={key} className="min-h-0 overflow-y-auto">
            {catalog[key].length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t('chatGroupMediaEmpty')}</p> : key === 'links' ? <ul className="space-y-3">
              {catalog.links.map((item) => <li key={`${item.messageId}-${item.url}`} className="space-y-1 rounded-lg border p-3">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-start gap-3 break-all text-sm text-primary hover:underline"><Link className="mt-0.5 size-4 shrink-0" />{item.url}</a>
                {caption(item)}
              </li>)}
            </ul> : key === 'photos' || key === 'gifs' || key === 'videos' ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {catalog[key].map((item) => <button key={`${item.messageId}-${item.file.id}`} type="button" className="aspect-square min-w-0 overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${t('attachmentPreview')}: ${item.file.name}`} onClick={() => setPreview(item)}>
                {failed.includes(item.file.id) ? <ImageIcon className="mx-auto size-8 text-muted-foreground" /> : key === 'videos' ? <video src={item.file.url} muted playsInline preload="metadata" aria-hidden className="size-full object-cover" onError={() => setFailed((current) => [...current, item.file.id])} /> : <img src={item.file.url} alt={item.file.name} loading="lazy" className="size-full object-cover"
                  onError={() => setFailed((current) => [...current, item.file.id])} />}
              </button>)}
            </div> : <ul className="space-y-3">
              {catalog[key].map((item) => <li key={`${item.messageId}-${item.file.id}`} className="space-y-2 rounded-lg border p-3">
                <ChatMessageAttachments attachments={[item.file]} />{caption(item)}
              </li>)}
            </ul>}
          </TabsContent>)}
        </Tabs>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(undefined); }}>
      <DialogContent ref={viewer} tabIndex={-1} aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-4xl" onOpenAutoFocus={(event) => { event.preventDefault(); viewer.current?.focus(); }}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } }}>
        <DialogHeader><DialogTitle className="break-all pr-6">{preview?.file.name ?? t('attachmentPreview')}</DialogTitle></DialogHeader>
        {preview ? <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {failed.includes(preview.file.id) ? <p role="alert" className="py-8 text-center text-sm text-destructive">{t('attachmentDownloadFailed')}</p>
              : preview.file.mimeType.startsWith('video/') ? <video key={preview.file.id} src={preview.file.url} controls playsInline preload="metadata" aria-label={preview.file.name} className="max-h-[65dvh] w-full" onError={() => setFailed((current) => [...current, preview.file.id])} /> : <img src={preview.file.url} alt={preview.file.name} className="max-h-[65dvh] w-full object-contain" onError={() => setFailed((current) => [...current, preview.file.id])} />}
          </div>
          {caption(preview)}
          <div className="flex shrink-0 items-center justify-between gap-2">
            <Button variant="outline" size="icon" aria-label={t('chatGroupPreviousMedia')} disabled={imageIndex <= 0} onClick={() => move(-1)}><ChevronLeft className="size-4" /></Button>
            <span className="text-sm tabular-nums">{imageIndex + 1} / {images.length}</span>
            <Button asChild variant="outline" size="icon" aria-label={t('download')}><a href={`${preview.file.url}?download=1`} aria-label={t('download')}><Download className="size-4" /></a></Button>
            <Button variant="outline" size="icon" aria-label={t('chatGroupNextMedia')} disabled={imageIndex >= images.length - 1} onClick={() => move(1)}><ChevronRight className="size-4" /></Button>
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
  </>;
}
