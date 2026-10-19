import { forwardRef, useEffect, useId, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TimeWheel, type TimeWheelHandle } from '@/components/ui/time-wheel';
import { allowedClockMinutes, clockMinutes, clockValue, nearestClockMinute } from '@/components/ui/time-picker-model';
import { useTranslation } from '@/hooks/useTranslation';

export type TimePickerProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value?: string;
  onValueChange: (value: string) => void;
};

export const TimePicker = forwardRef<HTMLInputElement, TimePickerProps>(function TimePicker({
  value = '', onValueChange, min, max, step = 60, disabled, readOnly, className, onClick, onKeyDown, ...props
}, ref) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const hourColumn = useRef<TimeWheelHandle>(null);
  const minuteColumn = useRef<TimeWheelHandle>(null);
  const generatedId = useId();
  const allowed = useMemo(() => allowedClockMinutes(String(min ?? ''), String(max ?? ''), step), [min, max, step]);
  const hours = useMemo(() => [...new Set(allowed.map(minute => Math.floor(minute / 60)))], [allowed]);
  const hour = Math.floor(draft / 60);
  const minutes = useMemo(() => allowed.filter(minute => Math.floor(minute / 60) === hour).map(minute => minute % 60), [allowed, hour]);

  useEffect(() => {
    input.current?.setCustomValidity(value && !allowed.includes(clockMinutes(value) ?? -1) ? t('clockTimeInvalid') : '');
  }, [value, allowed, t]);
  useEffect(() => {
    if (disabled || readOnly) setOpen(false);
  }, [disabled, readOnly]);

  const openPicker = () => {
    if (disabled || readOnly || input.current?.matches(':disabled')) return;
    setDraft(nearestClockMinute(allowed, value));
    setOpen(true);
  };

  return <>
    <div className="relative min-w-0">
      <Input
        {...props}
        id={props.id ?? generatedId}
        ref={node => { input.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
        type="text"
        inputMode="none"
        autoComplete="off"
        maxLength={5}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        placeholder="--:--"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readOnly={readOnly}
        className={cn('cursor-pointer pr-9', className)}
        aria-label={props['aria-label'] ?? (!props.id ? t('time') : undefined)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onChange={event => onValueChange(event.target.value)}
        onClick={event => { onClick?.(event); if (!event.defaultPrevented) openPicker(); }}
        onKeyDown={event => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openPicker(); }
        }}
      />
      <Clock3 aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
    <Dialog open={open && !disabled} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="max-w-xs gap-4 p-5" onCloseAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
        <DialogHeader><DialogTitle>{t('time')}</DialogTitle></DialogHeader>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <TimeWheel ref={hourColumn} label={t('clockHours')} value={hour} options={hours} onValueChange={nextHour => {
            const choices = allowed.filter(minute => Math.floor(minute / 60) === nextHour);
            setDraft(nearestClockMinute(choices, clockValue(nextHour * 60 + draft % 60)));
          }} />
          <TimeWheel ref={minuteColumn} label={t('clockMinutes')} value={draft % 60} options={minutes} onValueChange={minute => setDraft(hour * 60 + minute)} />
        </div>
        <DialogFooter className="grid w-full grid-cols-2 sm:grid">
          {!props.required ? <Button type="button" variant="ghost" onClick={() => { onValueChange(''); setOpen(false); }}>{t('reset')}</Button> : null}
          <Button type="button" variant="outline" className={props.required ? 'col-span-2' : undefined} onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button type="button" className="col-span-2 w-full" disabled={allowed.length === 0} onClick={() => {
            const visible = (hourColumn.current?.getValue() ?? hour) * 60 + (minuteColumn.current?.getValue() ?? draft % 60);
            onValueChange(clockValue(nearestClockMinute(allowed, clockValue(visible))));
            setOpen(false);
          }}>{t('clockSelect')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
});
