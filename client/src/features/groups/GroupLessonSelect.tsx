import { forwardRef, Fragment, type ComponentPropsWithoutRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { normalizeCourseCurriculum } from '@shared/contracts/course-curriculum';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type GroupLessonSelectProps = Omit<ComponentPropsWithoutRef<'button'>, 'value' | 'onChange'> & {
  program: unknown;
  value: string[] | null;
  onChange: (ids: string[]) => void;
};

export const GroupLessonSelect = forwardRef<HTMLButtonElement, GroupLessonSelectProps>(
  ({ program, value, onChange, disabled, ...props }, ref) => {
    const { t } = useTranslation();
    const blocks = normalizeCourseCurriculum(program).blocks;
    const allIds = blocks.flatMap((block) => block.lessons.map((lesson) => lesson.id));
    const selected = new Set(value ?? []);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
    const setChecked = (ids: string[], checked: boolean) => {
      const next = new Set(value ?? []);
      ids.forEach((id) => checked ? next.add(id) : next.delete(id));
      onChange(allIds.filter((id) => next.has(id)));
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button {...props} ref={ref} type="button" variant="outline"
            disabled={disabled} className="h-auto min-h-10 w-full justify-between gap-2 text-left font-normal">
            <span className="min-w-0 break-words">
              {selected.size > 0
                ? t('groupLessonsSelected').replace('{count}', String(selected.size)).replace('{total}', String(allIds.length))
                : t('groupSelectLessons')}
            </span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-[var(--radix-dropdown-menu-trigger-width)] min-w-60 max-w-[calc(100vw-2rem)]">
          {allIds.length === 0 ? (
            <DropdownMenuLabel>{t('groupNoCourseLessons')}</DropdownMenuLabel>
          ) : (
            <>
              <DropdownMenuCheckboxItem checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => onChange(checked ? allIds : [])}>
                {t('groupSelectAllLessons')}
              </DropdownMenuCheckboxItem>
              {blocks.filter((block) => block.lessons.length > 0).map((block, index) => (
                <Fragment key={block.id}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="break-words">{block.title || t('courseBlockNumber', { number: index + 1 })}</DropdownMenuLabel>
                  {block.lessons.map((lesson) => (
                    <DropdownMenuCheckboxItem key={lesson.id} checked={selected.has(lesson.id)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) => setChecked([lesson.id], checked === true)}>
                      <span className="break-words">{lesson.title}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </Fragment>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
GroupLessonSelect.displayName = 'GroupLessonSelect';
