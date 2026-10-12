import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import {
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  Clock,
  Copy,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Sparkles,
  X,
} from 'lucide-react';
import { hasLeadershipAccess, canAccessAcademyModule } from '@shared/academy';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { ModulePage } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { updatesApi, updateQueryKeys } from './api';
import { PublishUpdateDialog } from './PublishUpdateDialog';
import { UpdateArticle } from './UpdateArticle';
import { calculateReadingTime, formatReleaseDate, getFirstPostImage } from './utils';

export default function UpdatesPage() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const postText = new URLSearchParams(search).get('post');
  const postId =
    postText && /^\d+$/.test(postText) && Number.isSafeInteger(Number(postText)) && Number(postText) > 0
      ? Number(postText)
      : null;

  const [publishOpen, setPublishOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string | null>(null);

  const list = useQuery({ queryKey: updateQueryKeys.list, queryFn: updatesApi.list, enabled: !postText });
  const detail = useQuery({
    queryKey: updateQueryKeys.detail(postId ?? 0),
    queryFn: () => updatesApi.find(postId!),
    enabled: Boolean(postId),
  });

  const current = postText ? detail : list;
  const locale = language === 'ru' ? 'ru' : 'en';

  const copyPostLink = async (id: number) => {
    const url = `${window.location.origin}/updates?post=${id}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {}
    toast({ title: t('updatesLinkCopied') });
  };

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
  }, [list.data, searchQuery, selectedYear, locale]);

  return (
    <ModulePage>
      <PageHeader
        title={t('whatsNew')}
        actions={
          hasLeadershipAccess(user) ? (
            <Button onClick={() => setPublishOpen(true)}>
              <Plus data-icon="inline-start" />
              {t('updatesNewPost')}
            </Button>
          ) : undefined
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
          {/* Release stats block (CRIT-01) */}
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

          {/* Search and Year filter chips (CRIT-02, CRIT-03) */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
              ) : null}
            </div>

            {availableYears.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('updatesAllYears')}>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedYear === null ? 'default' : 'outline'}
                  onClick={() => setSelectedYear(null)}
                >
                  {t('updatesAllYears')}
                </Button>
                {availableYears.map((year) => (
                  <Button
                    key={year}
                    type="button"
                    size="sm"
                    variant={selectedYear === year ? 'default' : 'outline'}
                    onClick={() => setSelectedYear(year)}
                  >
                    {year}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Empty search results state (CRIT-04) */}
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
                }}
              >
                <RotateCcw data-icon="inline-start" className="size-4" />
                {t('updatesResetSearch')}
              </Button>
            </div>
          ) : (
            /* Responsive cards grid (CRIT-05) */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPosts.map((post) => {
                const firstImage = getFirstPostImage(post);
                const readingTime = calculateReadingTime(post, locale);
                const isLatest = latestPost?.id === post.id;
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
                    {/* First screenshot preview (CRIT-08) */}
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
                        <div className="flex items-center gap-1.5">
                          {/* New release badge (CRIT-06) */}
                          {isLatest ? (
                            <Badge variant="default" className="text-xs font-semibold">
                              {t('updatesBadgeNew')}
                            </Badge>
                          ) : null}
                          {/* Reading time badge (CRIT-07) */}
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Clock className="size-3" />
                            {t('updatesReadingTime', { count: readingTime })}
                          </Badge>
                        </div>
                      </div>
                      <h2 className="line-clamp-2 text-xl font-semibold tracking-tight">
                        <Link href={`/updates?post=${post.id}`} className="hover:text-primary">
                          {post.content.title[locale]}
                        </Link>
                      </h2>
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                      <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                        {post.content.summary[locale]}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Button asChild variant="default" size="sm">
                          <Link href={`/updates?post=${post.id}`}>
                            {t('updatesReadPost')}
                            <ArrowUpRight data-icon="inline-end" />
                          </Link>
                        </Button>

                        {/* Direct module link if authorized (CRIT-10) */}
                        {canOpenAction ? (
                          <Button asChild variant="outline" size="sm">
                            <Link href={action.href}>
                              {t('updatesOpenSection')}
                              <ArrowUpRight data-icon="inline-end" />
                            </Link>
                          </Button>
                        ) : null}

                        {/* Copy link button (CRIT-09) */}
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
        /* Overall empty state (CRIT-04) */
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center">
          <Sparkles className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">{t('updatesEmpty')}</p>
        </div>
      )}

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
