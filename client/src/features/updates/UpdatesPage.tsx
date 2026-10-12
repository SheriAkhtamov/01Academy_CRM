import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import {
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  CheckCheck,
  Clock,
  Copy,
  Eye,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Sparkles,
  X,
} from 'lucide-react';
import { hasLeadershipAccess, canAccessAcademyModule } from '@shared/academy';
import type { PlatformUpdate } from '@shared/contracts/platform-updates';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ModulePage } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updatesApi, updateQueryKeys } from './api';
import { PublishUpdateDialog } from './PublishUpdateDialog';
import { UpdateArticle } from './UpdateArticle';
import {
  calculateReadingTime,
  formatReleaseDate,
  getFirstPostImage,
  getPostCategory,
  getCategoryBadgeClass,
  getCategoryTranslationKey,
  getReadPostIds,
  markPostAsRead,
  markAllPostsAsRead,
  type UpdateCategory,
} from './utils';

export default function UpdatesPage() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const postText = new URLSearchParams(search).get('post');
  const postId =
    postText && /^\d+$/.test(postText) && Number.isSafeInteger(Number(postText)) && Number(postText) > 0
      ? Number(postText)
      : null;

  const [publishOpen, setPublishOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<UpdateCategory | null>(null);
  const [readIds, setReadIds] = useState<number[]>(() => getReadPostIds());
  const [quickViewPost, setQuickViewPost] = useState<PlatformUpdate | null>(null);

  const list = useQuery({ queryKey: updateQueryKeys.list, queryFn: updatesApi.list, enabled: !postText });
  const detail = useQuery({
    queryKey: updateQueryKeys.detail(postId ?? 0),
    queryFn: () => updatesApi.find(postId!),
    enabled: Boolean(postId),
  });

  const current = postText ? detail : list;
  const locale = language === 'ru' ? 'ru' : 'en';

  // Mark article as read when opened via URL
  useEffect(() => {
    if (postId && detail.data) {
      const updated = markPostAsRead(postId);
      setReadIds(updated);
    }
  }, [postId, detail.data]);

  // Keyboard shortcut: '/' focuses search input when no modal is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable ||
        publishOpen ||
        Boolean(quickViewPost)
      ) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [publishOpen, quickViewPost]);

  const handleMarkAsRead = (id: number) => {
    const updated = markPostAsRead(id);
    setReadIds(updated);
  };

  const handleMarkAllAsRead = () => {
    if (!list.data || list.data.length === 0) return;
    const allIds = list.data.map((item) => item.id);
    const updated = markAllPostsAsRead(allIds);
    setReadIds(updated);
    toast({ title: t('updatesAllMarkedAsRead') });
  };

  const copyPostLink = async (id: number) => {
    const url = `${window.location.origin}/updates?post=${id}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {}
    toast({ title: t('updatesLinkCopied') });
  };

  const unreadCount = useMemo(() => {
    if (!list.data) return 0;
    return list.data.filter((item) => !readIds.includes(item.id)).length;
  }, [list.data, readIds]);

  const availableYears = useMemo(() => {
    if (!list.data) return [];
    const yearsSet = new Set<string>();
    for (const item of list.data) {
      if (item.publishedAt) {
        try {
          const year = new Date(item.publishedAt).getFullYear().toString();
          if (year && !isNaN(Number(year))) {
            yearsSet.add(year);
          }
        } catch {}
      }
    }
    return Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  }, [list.data]);

  const latestPost = useMemo(() => {
    if (!list.data || list.data.length === 0) return null;
    return [...list.data].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )[0];
  }, [list.data]);

  const categoryFilterOptions: Array<{ id: UpdateCategory | null; labelKey: TranslationKey }> = [
    { id: null, labelKey: 'updatesCategoryAll' },
    { id: 'feature', labelKey: 'updatesCategoryFeature' },
    { id: 'improvement', labelKey: 'updatesCategoryImprovement' },
    { id: 'sales', labelKey: 'updatesCategorySales' },
    { id: 'administration', labelKey: 'updatesCategoryAdministration' },
  ];

  const filteredPosts = useMemo(() => {
    if (!list.data) return [];
    const query = searchQuery.trim().toLowerCase();

    return list.data.filter((item) => {
      if (selectedYear) {
        try {
          const itemYear = new Date(item.publishedAt).getFullYear().toString();
          if (itemYear !== selectedYear) return false;
        } catch {
          return false;
        }
      }

      if (selectedCategory) {
        const itemCategory = getPostCategory(item);
        if (itemCategory !== selectedCategory) return false;
      }

      if (!query) return true;

      const titleMatch =
        item.content.title[locale]?.toLowerCase().includes(query) ||
        item.content.title.ru?.toLowerCase().includes(query) ||
        item.content.title.en?.toLowerCase().includes(query);
      if (titleMatch) return true;

      const summaryMatch =
        item.content.summary[locale]?.toLowerCase().includes(query) ||
        item.content.summary.ru?.toLowerCase().includes(query) ||
        item.content.summary.en?.toLowerCase().includes(query);
      if (summaryMatch) return true;

      const sectionsMatch = item.content.sections?.some((section) => {
        const headingMatch =
          section.heading?.[locale]?.toLowerCase().includes(query) ||
          section.heading?.ru?.toLowerCase().includes(query) ||
          section.heading?.en?.toLowerCase().includes(query);
        if (headingMatch) return true;

        const paragraphsMatch = section.paragraphs?.some(
          (p) =>
            p[locale]?.toLowerCase().includes(query) ||
            p.ru?.toLowerCase().includes(query) ||
            p.en?.toLowerCase().includes(query)
        );
        if (paragraphsMatch) return true;

        const itemsMatch = section.items?.some(
          (it) =>
            it[locale]?.toLowerCase().includes(query) ||
            it.ru?.toLowerCase().includes(query) ||
            it.en?.toLowerCase().includes(query)
        );
        if (itemsMatch) return true;

        const captionMatch =
          section.image?.caption?.[locale]?.toLowerCase().includes(query) ||
          section.image?.caption?.ru?.toLowerCase().includes(query) ||
          section.image?.caption?.en?.toLowerCase().includes(query);
        return Boolean(captionMatch);
      });

      return Boolean(sectionsMatch);
    });
  }, [list.data, searchQuery, selectedYear, selectedCategory, locale]);

  return (
    <ModulePage>
      <PageHeader
        title={t('whatsNew')}
        actions={
          <div className="flex items-center gap-2">
            {unreadCount > 0 && !postText ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMarkAllAsRead}
              >
                <CheckCheck data-icon="inline-start" className="size-4" />
                {t('updatesMarkAllAsRead')}
              </Button>
            ) : null}
            {hasLeadershipAccess(user) ? (
              <Button onClick={() => setPublishOpen(true)}>
                <Plus data-icon="inline-start" />
                {t('updatesNewPost')}
              </Button>
            ) : null}
          </div>
        }
      />

      {postText && !detail.data ? (
        <Button asChild variant="ghost" className="mb-5">
          <Link href="/updates">
            <ArrowLeft data-icon="inline-start" />
            {t('updatesBackToFeed')}
          </Link>
        </Button>
      ) : null}

      {postText && !postId ? (
        <p role="alert">{t('updatesPostMissing')}</p>
      ) : current.isPending ? (
        <div role="status" aria-label={t('loading')} className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      ) : current.isError ? (
        <div className="space-y-3" role="alert">
          <p>{t('failedToLoadData')}</p>
          <Button onClick={() => void current.refetch()}>{t('retry')}</Button>
        </div>
      ) : postText && detail.data ? (
        <UpdateArticle post={detail.data} />
      ) : list.data && list.data.length > 0 ? (
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Release stats block */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border bg-card/60 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('updatesTotalReleases')}</p>
                <p className="text-xl font-bold tracking-tight">{list.data.length}</p>
              </div>
            </div>
            {latestPost ? (
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Calendar className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('updatesLastRelease')}</p>
                  <p className="text-sm font-semibold tracking-tight">
                    {formatReleaseDate(latestPost.publishedAt, locale)}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Filter Bar: Search, Category chips, and Year chips */}
          <div className="space-y-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchQuery('');
                      searchInputRef.current?.blur();
                    }
                  }}
                  placeholder={t('updatesSearch')}
                  aria-label={t('updatesSearch')}
                  className="pl-9 pr-9"
                />
                {searchQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSearchQuery('')}
                    aria-label={t('updatesClearSearch')}
                    className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </Button>
                ) : (
                  <kbd
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground select-none"
                    title={t('updatesSearchShortcutHint')}
                  >
                    /
                  </kbd>
                )}
              </div>

              {/* Year filter chips */}
              {availableYears.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('updatesAllYears')}>
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedYear === null ? 'default' : 'outline'}
                    aria-pressed={selectedYear === null ? 'true' : 'false'}
                    onClick={() => setSelectedYear(null)}
                  >
                    {t('updatesAllYears')}
                  </Button>
                  {availableYears.map((year) => {
                    const isSelected = selectedYear === year;
                    return (
                      <Button
                        key={year}
                        type="button"
                        size="sm"
                        variant={isSelected ? 'default' : 'outline'}
                        aria-pressed={isSelected ? 'true' : 'false'}
                        onClick={() => setSelectedYear(year)}
                      >
                        {year}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Category filter chips */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('updatesCategories')}>
              {categoryFilterOptions.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <Button
                    key={cat.id ?? 'all'}
                    type="button"
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    aria-pressed={isSelected ? 'true' : 'false'}
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    {t(cat.labelKey)}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Empty search/filter results state */}
          {filteredPosts.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center" role="status">
              <SearchX className="size-8 text-muted-foreground" />
              <p className="text-muted-foreground">{t('updatesSearchEmpty')}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedYear(null);
                  setSelectedCategory(null);
                }}
              >
                <RotateCcw data-icon="inline-start" className="size-4" />
                {t('updatesResetSearch')}
              </Button>
            </div>
          ) : (
            /* Responsive cards grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPosts.map((post) => {
                const firstImage = getFirstPostImage(post);
                const readingTime = calculateReadingTime(post, locale);
                const isLatest = latestPost?.id === post.id;
                const category = getPostCategory(post);
                const isRead = readIds.includes(post.id);
                const action = post.content.action;
                const canOpenAction =
                  action &&
                  (action.href === '/sales/groups'
                    ? canAccessAcademyModule(user, 'sales')
                    : canAccessAcademyModule(user, 'administration'));

                return (
                  <Card
                    key={post.id}
                    className="flex flex-col overflow-hidden transition-all duration-200 hover:shadow-md"
                  >
                    {/* First screenshot preview */}
                    {firstImage ? (
                      <div className="relative aspect-video w-full overflow-hidden border-b bg-muted">
                        <img
                          src={firstImage.src}
                          alt={firstImage.caption[locale] || post.content.title[locale]}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                        />
                      </div>
                    ) : null}

                    <CardHeader className="space-y-3 pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          <time dateTime={post.publishedAt}>
                            {formatReleaseDate(post.publishedAt, locale)}
                          </time>
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Unread badge & dot indicator */}
                          {!isRead ? (
                            <Badge variant="secondary" className="gap-1.5 border-primary/20 bg-primary/10 text-primary text-xs font-semibold">
                              <span className="size-1.5 rounded-full bg-primary" />
                              {t('updatesUnread')}
                            </Badge>
                          ) : null}
                          {/* Category badge */}
                          <Badge variant="outline" className={cn('text-xs font-medium', getCategoryBadgeClass(category))}>
                            {t(getCategoryTranslationKey(category))}
                          </Badge>
                          {/* New release badge */}
                          {isLatest ? (
                            <Badge variant="default" className="text-xs font-semibold">
                              {t('updatesBadgeNew')}
                            </Badge>
                          ) : null}
                          {/* Reading time badge */}
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Clock className="size-3" />
                            {t('updatesReadingTime', { count: readingTime })}
                          </Badge>
                        </div>
                      </div>
                      <h2 className="line-clamp-2 text-xl font-semibold tracking-tight">
                        <Link
                          href={`/updates?post=${post.id}`}
                          className="hover:text-primary"
                          onClick={() => handleMarkAsRead(post.id)}
                        >
                          {post.content.title[locale]}
                        </Link>
                      </h2>
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                      <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                        {post.content.summary[locale]}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Button
                          asChild
                          variant="default"
                          size="sm"
                          onClick={() => handleMarkAsRead(post.id)}
                        >
                          <Link href={`/updates?post=${post.id}`}>
                            {t('updatesReadPost')}
                            <ArrowUpRight data-icon="inline-end" />
                          </Link>
                        </Button>

                        {/* Quick View Button */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            handleMarkAsRead(post.id);
                            setQuickViewPost(post);
                          }}
                        >
                          <Eye data-icon="inline-start" className="size-3.5" />
                          {t('updatesQuickView')}
                        </Button>

                        {/* Direct module link if authorized */}
                        {canOpenAction ? (
                          <Button asChild variant="outline" size="sm">
                            <Link href={action.href}>
                              {t('updatesOpenSection')}
                              <ArrowUpRight data-icon="inline-end" />
                            </Link>
                          </Button>
                        ) : null}

                        {/* Copy link button */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => copyPostLink(post.id)}
                          aria-label={t('updatesCopyLink')}
                          title={t('updatesCopyLink')}
                        >
                          <Copy className="size-3.5" data-icon="inline-start" />
                          {t('updatesCopyLink')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Overall empty state */
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center">
          <Sparkles className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">{t('updatesEmpty')}</p>
        </div>
      )}

      {/* Quick View Dialog (ADV-04) */}
      <Dialog
        open={Boolean(quickViewPost)}
        onOpenChange={(open) => {
          if (!open) setQuickViewPost(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {quickViewPost ? (
            <>
              <DialogHeader className="space-y-2 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn('text-xs font-medium', getCategoryBadgeClass(getPostCategory(quickViewPost)))}
                  >
                    {t(getCategoryTranslationKey(getPostCategory(quickViewPost)))}
                  </Badge>
                  <time className="text-xs text-muted-foreground" dateTime={quickViewPost.publishedAt}>
                    {formatReleaseDate(quickViewPost.publishedAt, locale)}
                  </time>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {t('updatesReadingTime', { count: calculateReadingTime(quickViewPost, locale) })}
                  </span>
                </div>
                <DialogTitle className="text-xl sm:text-2xl font-bold">
                  {quickViewPost.content.title[locale]}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                  {quickViewPost.content.summary[locale]}
                </DialogDescription>
              </DialogHeader>

              {/* Sections list inside quick view */}
              <div className="space-y-6 py-2">
                {quickViewPost.content.sections.map((section, idx) => (
                  <div key={idx} className="space-y-3">
                    {section.heading ? (
                      <h3 className="font-semibold text-foreground text-base">
                        {section.heading[locale]}
                      </h3>
                    ) : null}
                    {section.paragraphs.map((p, pIdx) => (
                      <p key={pIdx} className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                        {p[locale]}
                      </p>
                    ))}
                    {section.items.length > 0 ? (
                      <ul className="list-disc pl-5 text-sm space-y-1 text-muted-foreground">
                        {section.items.map((item, itemIdx) => (
                          <li key={itemIdx}>{item[locale]}</li>
                        ))}
                      </ul>
                    ) : null}
                    {section.image ? (
                      <figure className="space-y-1.5 overflow-hidden rounded-lg border">
                        <img
                          src={section.image.src}
                          alt={section.image.caption[locale] || quickViewPost.content.title[locale]}
                          className="w-full object-cover"
                        />
                        {section.image.caption?.[locale] ? (
                          <figcaption className="p-2 text-xs text-muted-foreground">
                            {section.image.caption[locale]}
                          </figcaption>
                        ) : null}
                      </figure>
                    ) : null}
                  </div>
                ))}
              </div>

              <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild variant="default" size="sm">
                    <Link href={`/updates?post=${quickViewPost.id}`} onClick={() => setQuickViewPost(null)}>
                      {t('updatesReadPost')}
                      <ArrowUpRight data-icon="inline-end" className="size-3.5" />
                    </Link>
                  </Button>
                  {quickViewPost.content.action &&
                  (quickViewPost.content.action.href === '/sales/groups'
                    ? canAccessAcademyModule(user, 'sales')
                    : canAccessAcademyModule(user, 'administration')) ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={quickViewPost.content.action.href} onClick={() => setQuickViewPost(null)}>
                        {t('updatesOpenSection')}
                        <ArrowUpRight data-icon="inline-end" className="size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" onClick={() => setQuickViewPost(null)}>
                  {t('updatesCloseQuickView')}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {publishOpen ? (
        <PublishUpdateDialog
          onClose={() => setPublishOpen(false)}
          onPublished={(id) => {
            setPublishOpen(false);
            navigate(`/updates?post=${id}`);
          }}
        />
      ) : null}
    </ModulePage>
  );
}
