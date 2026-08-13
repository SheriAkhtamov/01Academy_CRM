import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsChartsSkeleton } from '@/components/ux/analytics/AnalyticsChartCard';
import type { TeacherSection } from '@/lib/teacherModule';

/**
 * One generic skeleton used to promise six KPI tiles and four charts no matter
 * which section was loading, so every navigation ended in a full relayout. Each
 * section now gets a placeholder with its own grid and its own heights.
 */
export function TeacherSectionSkeleton({ section }: { section: TeacherSection }) {
  if (section === 'schedule') {
    return (
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-16 w-full rounded-xl" />
        {/* Same breakpoints as the live week grid, or the column count jumps
            the moment the data lands. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-56 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (section === 'groups') {
    return (
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (section === 'attendance') {
    return (
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-[34rem] w-full rounded-xl" />
      </div>
    );
  }

  if (section === 'ratings') {
    return (
      <div className="space-y-4" aria-hidden="true">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[22rem] w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Skeleton className="h-40 rounded-xl lg:col-span-2" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      {/* `ReportingDateRangeFilter` is `p-3` plus one row of controls: it wraps
          to ~176px while stacked and settles at ~72px once `xl` puts the row
          on one line. */}
      <Skeleton className="h-44 w-full rounded-xl xl:h-[4.5rem]" />
      {/* Mirrors the live KPI grid exactly, so the column count never jumps at
          640px, and `h-32` is the tile's real height: p-3 (24) + icon row (28)
          + mt-2 (8) + the 68px gauge. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <AnalyticsChartsSkeleton />
    </div>
  );
}
