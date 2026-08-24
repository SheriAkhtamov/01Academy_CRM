import { useId } from 'react';
import { CircleOff } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import {
    TASK_COLOR_META,
    TASK_COLOR_ORDER,
    type BoardTaskColor,
} from '@/lib/boardTypes';
import { cn } from '@/lib/utils';

interface TaskColorPickerProps {
    value: BoardTaskColor | null;
    onChange: (color: BoardTaskColor | null) => void;
    disabled?: boolean;
}

const TASK_COLOR_OPTIONS: readonly (BoardTaskColor | null)[] = [null, ...TASK_COLOR_ORDER];

export function TaskColorPicker({ value, onChange, disabled = false }: TaskColorPickerProps) {
    const { t } = useTranslation();
    const generatedId = useId();
    const fieldId = `task-color-${generatedId.replace(/:/g, '')}`;
    const hintId = `${fieldId}-hint`;
    const selectedLabel = value ? t(TASK_COLOR_META[value].labelKey) : t('taskColorNone');

    return (
        <fieldset
            disabled={disabled}
            aria-label={t('taskColorLabel')}
            aria-describedby={hintId}
            className="space-y-2"
        >
            <legend className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                    <span>{t('taskColorLabel')}</span>
                    <span className="font-medium text-foreground">{selectedLabel}</span>
                </span>
            </legend>
            <div className="flex flex-wrap items-center gap-2">
                {TASK_COLOR_OPTIONS.map((color) => {
                    const optionKey = color ?? 'none';
                    const optionId = `${fieldId}-${optionKey}`;
                    const optionLabel = color ? t(TASK_COLOR_META[color].labelKey) : t('taskColorNone');
                    const selected = value === color;

                    return (
                        <label
                            key={optionKey}
                            htmlFor={optionId}
                            title={optionLabel}
                            className={cn('relative cursor-pointer rounded-full', disabled && 'cursor-not-allowed opacity-50')}
                        >
                            <input
                                type="radio"
                                id={optionId}
                                name={`${fieldId}-task-color`}
                                value={optionKey}
                                checked={selected}
                                onChange={() => onChange(color)}
                                aria-label={optionLabel}
                                className="peer sr-only"
                                data-testid={`task-color-${optionKey}`}
                            />
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'flex size-8 items-center justify-center rounded-full border border-border bg-card shadow-2xs transition-[box-shadow,transform] hover:scale-105 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 max-md:size-11',
                                    selected && 'ring-2 ring-primary ring-offset-2',
                                )}
                            >
                                {color ? (
                                    <span className={cn('size-5 rounded-full', TASK_COLOR_META[color].swatch)} />
                                ) : (
                                    <CircleOff className="size-5 text-muted-foreground" />
                                )}
                            </span>
                        </label>
                    );
                })}
            </div>
            <p id={hintId} className="text-[11px] text-muted-foreground">{t('taskColorHint')}</p>
        </fieldset>
    );
}
