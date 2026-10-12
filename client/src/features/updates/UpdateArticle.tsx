import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Clock, Copy, ListCollapse } from 'lucide-react';
import { canAccessAcademyModule } from '@shared/academy';
import type { PlatformUpdate } from '@shared/contracts/platform-updates';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  calculateReadingTime,
  getPostCategory,
  getCategoryBadgeClass,
  getCategoryTranslationKey,
  getPostReactions,
  togglePostReaction,
  type ReactionType,
  type PostReactions,
} from './utils';
import { updatesApi, updateQueryKeys } from './api';

export function UpdateArticle({ post }: { post: PlatformUpdate }) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [image, setImage] = useState<{ src: string; caption: string } | null>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const [reactions, setReactions] = useState<PostReactions>(() => getPostReactions(post.id));

  const locale = language === 'ru' ? 'ru' : 'en';
  const category = getPostCategory(post);
  const action = post.content.action;
  const canOpenAction =
    action &&
    (action.href === '/sales/groups'
      ? canAccessAcademyModule(user, 'sales')
      : canAccessAcademyModule(user, 'administration'));

  // Sync reactions when post changes
  useEffect(() => {
    setReactions(getPostReactions(post.id));
  }, [post.id]);

  // Calculate reading scroll progress
  useEffect(() => {
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        const percent = Math.min(100, Math.max(0, (window.scrollY / scrollHeight) * 100));
        setReadingProgress(percent);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Safe fetch of neighboring posts
  const listQuery = useQuery({
    queryKey: updateQueryKeys.list,
    queryFn: updatesApi.list,
    enabled: typeof post.id === 'number' && Number.isSafeInteger(post.id) && post.id > 0,
  });

  const posts = listQuery.data ?? [];
  const currentIndex = posts.findIndex((item) => item.id === post.id);
  const nextPost = currentIndex > 0 ? posts[currentIndex - 1] : null; // newer post
  const prevPost = currentIndex >= 0 && currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null; // older post

  // Keyboard navigation shortcuts (ADV-05)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (image) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        navigate('/updates');
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'k' || event.key === 'K') &&
        prevPost
      ) {
        event.preventDefault();
        navigate(`/updates?post=${prevPost.id}`);
      } else if (
        (event.key === 'ArrowRight' || event.key === 'j' || event.key === 'J') &&
        nextPost
      ) {
        event.preventDefault();
        navigate(`/updates?post=${nextPost.id}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [image, prevPost, nextPost, navigate]);

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/updates?post=${post.id}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // safe fallback for environments without clipboard permissions
    }
    toast({ title: t('updatesLinkCopied') });
  };

  const handleReaction = (reaction: ReactionType) => {
    const updated = togglePostReaction(post.id, reaction);
    setReactions(updated);
  };

  const scrollToTop = () => {
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const readingTime = calculateReadingTime(post, locale);

  return (
    <article className="mx-auto max-w-4xl space-y-7">
      {/* Sticky reading progress bar at top of window */}
      <div className="sticky top-0 z-30 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div
          role="progressbar"
          aria-label={t('updatesReadingProgress')}
          aria-valuenow={Math.round(readingProgress)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-full overflow-hidden rounded-full bg-muted/40"
        >
          <div
            className="h-full bg-primary transition-[width] duration-150 ease-out"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
      </div>

      {/* Top action bar: back to feed + copy link */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/updates">
            <ArrowLeft data-icon="inline-start" className="size-4" />
            {t('updatesBackToFeed')}
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyLink}>
          <Copy data-icon="inline-start" className="size-4" />
          {t('updatesCopyLink')}
        </Button>
      </div>

      {/* Article Header (ADV-02) */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
          <Badge variant="outline" className={cn(getCategoryBadgeClass(category), 'font-medium')}>
            {t(getCategoryTranslationKey(category))}
          </Badge>
          <span>•</span>
          <time dateTime={post.publishedAt}>
            {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
              dateStyle: 'long',
              timeZone: 'Asia/Tashkent',
            }).format(new Date(post.publishedAt))}
          </time>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {t('updatesReadingTime', { count: readingTime })}
          </span>
        </div>
        <h2 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{post.content.title[locale]}</h2>
        <p className="text-base leading-relaxed text-muted-foreground">{post.content.summary[locale]}</p>
        {canOpenAction ? (
          <Button asChild>
            <Link href={action.href}>
              {t('updatesOpenSection')}
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
      </header>

      {/* Interactive Table of Contents (for articles with 3 or more sections) */}
      {post.content.sections.length >= 3 ? (
        <nav aria-label={t('updatesTableOfContents')} className="rounded-xl border border-border/80 bg-muted/40 p-4 space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListCollapse className="size-4" />
            {t('updatesTableOfContents')}
          </p>
          <ul className="space-y-1.5 pl-1 text-sm">
            {post.content.sections.map((section, index) => {
              const headingText = section.heading?.[locale] || `${t('updatesSection')} ${index + 1}`;
              return (
                <li key={index}>
                  <a
                    href={`#section-${index + 1}`}
                    className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  >
                    {headingText}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {/* Sections content */}
      {post.content.sections.map((section, index) => (
        <section key={index} id={`section-${index + 1}`} className="space-y-4 scroll-mt-20">
          {section.heading ? <h3 className="text-xl font-semibold">{section.heading[locale]}</h3> : null}
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="whitespace-pre-line break-words leading-7">
              {paragraph[locale]}
            </p>
          ))}
          {section.items.length ? (
            <ul className="list-disc space-y-2 pl-6">
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex} className="leading-7">
                  {item[locale]}
                </li>
              ))}
            </ul>
          ) : null}
          {section.image ? (
            <figure className="space-y-2">
              <button
                type="button"
                className="block w-full overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setImage({ src: section.image!.src, caption: section.image!.caption[locale] })}
                aria-label={section.image.caption[locale]}
              >
                <img src={section.image.src} alt={section.image.caption[locale]} loading="lazy" className="h-auto w-full" />
              </button>
              <figcaption className="text-sm text-muted-foreground">{section.image.caption[locale]}</figcaption>
            </figure>
          ) : null}
        </section>
      ))}

      {/* Employee reactions block (ADV-06) */}
      <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold tracking-tight text-foreground">
            {t('updatesReactionsTitle')}
          </p>
          {reactions.userReaction ? (
            <span className="text-xs text-muted-foreground animate-in fade-in duration-200">
              {t('updatesReactionFeedback')}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant={reactions.userReaction === 'helpful' ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            aria-label={t('updatesReactionHelpful')}
            aria-pressed={reactions.userReaction === 'helpful'}
            onClick={() => handleReaction('helpful')}
          >
            <span aria-hidden="true">👍</span>
            <span>{t('updatesReactionHelpful')}</span>
            {reactions.helpful > 0 ? (
              <span className="ml-1 rounded-full bg-background/30 px-1.5 py-0.5 text-xs font-semibold">
                {reactions.helpful}
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            variant={reactions.userReaction === 'awesome' ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            aria-label={t('updatesReactionAwesome')}
            aria-pressed={reactions.userReaction === 'awesome'}
            onClick={() => handleReaction('awesome')}
          >
            <span aria-hidden="true">🔥</span>
            <span>{t('updatesReactionAwesome')}</span>
            {reactions.awesome > 0 ? (
              <span className="ml-1 rounded-full bg-background/30 px-1.5 py-0.5 text-xs font-semibold">
                {reactions.awesome}
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            variant={reactions.userReaction === 'excited' ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            aria-label={t('updatesReactionExcited')}
            aria-pressed={reactions.userReaction === 'excited'}
            onClick={() => handleReaction('excited')}
          >
            <span aria-hidden="true">🚀</span>
            <span>{t('updatesReactionExcited')}</span>
            {reactions.excited > 0 ? (
              <span className="ml-1 rounded-full bg-background/30 px-1.5 py-0.5 text-xs font-semibold">
                {reactions.excited}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      {/* Bottom navigation cards: Previous and Next updates */}
      {prevPost || nextPost ? (
        <div className="grid gap-4 border-t pt-6 sm:grid-cols-2">
          {prevPost ? (
            <Card className="flex flex-col justify-between">
              <CardContent className="space-y-1.5 p-4">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowLeft className="size-3" />
                  {t('updatesPrevPost')}
                </span>
                <Link href={`/updates?post=${prevPost.id}`} className="line-clamp-2 font-medium hover:text-primary">
                  {prevPost.content.title[locale]}
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div />
          )}

          {nextPost ? (
            <Card className="flex flex-col justify-between text-right sm:items-end">
              <CardContent className="space-y-1.5 p-4">
                <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  {t('updatesNextPost')}
                  <ArrowRight className="size-3" />
                </span>
                <Link href={`/updates?post=${nextPost.id}`} className="line-clamp-2 font-medium hover:text-primary">
                  {nextPost.content.title[locale]}
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Keyboard navigation hint (ADV-05) */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>{t('updatesHotkeyHint')}</span>
      </div>

      {/* Back to top button */}
      <div className="flex justify-center pt-2">
        <Button variant="outline" size="sm" onClick={scrollToTop}>
          <ArrowUp data-icon="inline-start" className="size-4" />
          {t('updatesScrollToTop')}
        </Button>
      </div>

      {/* Fullscreen Screenshot Dialog */}
      <Dialog
        open={Boolean(image)}
        onOpenChange={(open) => {
          if (!open) setImage(null);
        }}
      >
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{image?.caption}</DialogTitle>
          </DialogHeader>
          {image ? (
            <div className="min-h-0 overflow-auto">
              <img src={image.src} alt={image.caption} className="h-auto w-full" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </article>
  );
}
