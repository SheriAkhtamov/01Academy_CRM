import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowLeft, ArrowUpRight, Plus, Sparkles } from 'lucide-react';
import { hasLeadershipAccess, canAccessAcademyModule } from '@shared/academy';
import type { PlatformUpdate } from '@shared/contracts/platform-updates';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { ModulePage } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { updatesApi, updateQueryKeys } from './api';
import { PublishUpdateDialog } from './PublishUpdateDialog';

function UpdateArticle({ post }: { post: PlatformUpdate }) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [image, setImage] = useState<{ src: string; caption: string } | null>(null);
  const locale = language === 'ru' ? 'ru' : 'en';
  const action = post.content.action;
  const canOpenAction = action && (action.href === '/sales/groups' ? canAccessAcademyModule(user, 'sales') : canAccessAcademyModule(user, 'administration'));
  return <article className="mx-auto max-w-4xl space-y-7">
    <header className="space-y-3">
      <p className="text-sm text-muted-foreground"><time dateTime={post.publishedAt}>{new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'long', timeZone: 'Asia/Tashkent' }).format(new Date(post.publishedAt))}</time></p>
      <h2 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{post.content.title[locale]}</h2>
      <p className="text-base leading-relaxed text-muted-foreground">{post.content.summary[locale]}</p>
      {canOpenAction ? <Button asChild><Link href={action.href}>{t('updatesOpenSection')}<ArrowUpRight data-icon="inline-end" /></Link></Button> : null}
    </header>
    {post.content.sections.map((section, index) => <section key={index} className="space-y-4">
      {section.heading ? <h3 className="text-xl font-semibold">{section.heading[locale]}</h3> : null}
      {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex} className="whitespace-pre-line break-words leading-7">{paragraph[locale]}</p>)}
      {section.items.length ? <ul className="list-disc space-y-2 pl-6">{section.items.map((item, itemIndex) => <li key={itemIndex} className="leading-7">{item[locale]}</li>)}</ul> : null}
      {section.image ? <figure className="space-y-2">
        <button type="button" className="block w-full overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setImage({ src: section.image!.src, caption: section.image!.caption[locale] })} aria-label={section.image.caption[locale]}>
          <img src={section.image.src} alt={section.image.caption[locale]} loading="lazy" className="h-auto w-full" />
        </button><figcaption className="text-sm text-muted-foreground">{section.image.caption[locale]}</figcaption>
      </figure> : null}
    </section>)}
    <Dialog open={Boolean(image)} onOpenChange={(open) => { if (!open) setImage(null); }}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{image?.caption}</DialogTitle></DialogHeader>
        {image ? <div className="min-h-0 overflow-auto"><img src={image.src} alt={image.caption} className="h-auto w-full" /></div> : null}
      </DialogContent>
    </Dialog>
  </article>;
}

export default function UpdatesPage() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const postText = new URLSearchParams(search).get('post');
  const postId = postText && /^\d+$/.test(postText) && Number.isSafeInteger(Number(postText)) && Number(postText) > 0 ? Number(postText) : null;
  const [publishOpen, setPublishOpen] = useState(false);
  const list = useQuery({ queryKey: updateQueryKeys.list, queryFn: updatesApi.list, enabled: !postText });
  const detail = useQuery({ queryKey: updateQueryKeys.detail(postId ?? 0), queryFn: () => updatesApi.find(postId!), enabled: Boolean(postId) });
  const current = postText ? detail : list;
  const locale = language === 'ru' ? 'ru' : 'en';
  return <ModulePage>
    <PageHeader title={t('whatsNew')} actions={hasLeadershipAccess(user) ? <Button onClick={() => setPublishOpen(true)}><Plus data-icon="inline-start" />{t('updatesNewPost')}</Button> : undefined} />
    {postText ? <Button asChild variant="ghost" className="mb-5"><Link href="/updates"><ArrowLeft data-icon="inline-start" />{t('updatesBackToFeed')}</Link></Button> : null}
    {postText && !postId ? <p role="alert">{t('updatesPostMissing')}</p> : current.isPending ? <div role="status" aria-label={t('loading')} className="space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-72 w-full" /></div>
      : current.isError ? <div className="space-y-3" role="alert"><p>{t('failedToLoadData')}</p><Button onClick={() => void current.refetch()}>{t('retry')}</Button></div>
      : postText && detail.data ? <UpdateArticle post={detail.data} /> : list.data?.length ? <div className="mx-auto grid max-w-5xl gap-5">
        {list.data.map((post) => <Card key={post.id}>
          <CardHeader className="space-y-2"><p className="text-sm text-muted-foreground"><time dateTime={post.publishedAt}>{new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'long', timeZone: 'Asia/Tashkent' }).format(new Date(post.publishedAt))}</time></p>
            <h2 className="text-xl font-semibold"><Link href={`/updates?post=${post.id}`} className="hover:text-primary">{post.content.title[locale]}</Link></h2></CardHeader>
          <CardContent className="space-y-4"><p className="leading-relaxed text-muted-foreground">{post.content.summary[locale]}</p><Button asChild variant="outline"><Link href={`/updates?post=${post.id}`}>{t('updatesReadPost')}<ArrowUpRight data-icon="inline-end" /></Link></Button></CardContent>
        </Card>)}
      </div> : <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12"><Sparkles className="size-8 text-muted-foreground" /><p>{t('updatesEmpty')}</p></div>}
    {publishOpen ? <PublishUpdateDialog onClose={() => setPublishOpen(false)} onPublished={(id) => { setPublishOpen(false); navigate(`/updates?post=${id}`); }} /> : null}
  </ModulePage>;
}
