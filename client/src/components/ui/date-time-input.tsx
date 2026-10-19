import { forwardRef, useEffect, useRef, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { TimePicker } from '@/components/ui/time-picker';
import { academyToday } from '@/lib/localeFormat';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export type DateTimeInputProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value?: string;
  onValueChange: (value: string) => void;
};

export const DateTimeInput = forwardRef<HTMLInputElement, DateTimeInputProps>(function DateTimeInput({
  value = '', onValueChange, min, max, step, className, name, ...props
}, ref) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement | null>(null);
  const [date = '', time = ''] = value.split('T');
  const minimum = String(min ?? '');
  const maximum = String(max ?? '');
  const [minDate, minTime] = minimum.split('T');
  const [maxDate, maxTime] = maximum.split('T');
  useEffect(() => {
    input.current?.setCustomValidity(value && ((minimum && value < minimum) || (maximum && value > maximum)) ? t('dateTimeInvalid') : '');
  }, [value, minimum, maximum, t]);

  const defaultDate = () => {
    const today = academyToday();
    return minDate && today < minDate ? minDate : maxDate && today > maxDate ? maxDate : today;
  };

  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(6.5rem,0.7fr)] items-start gap-2" data-date-time-input>
    {name ? <input type="hidden" name={name} value={value} disabled={props.disabled} /> : null}
    <Input
      {...props}
      ref={node => { input.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
      type="date"
      min={minDate || undefined}
      max={maxDate || undefined}
      value={date}
      className={cn('min-w-0', className)}
      onChange={event => {
        const nextDate = event.target.value;
        onValueChange(nextDate ? `${nextDate}T${time || (nextDate === minDate && minTime ? minTime : '00:00')}` : '');
      }}
    />
    <TimePicker
      id={props.id ? `${props.id}-time` : undefined}
      value={time}
      className={className}
      min={date === minDate ? minTime : undefined}
      max={date === maxDate ? maxTime : undefined}
      step={step}
      disabled={props.disabled}
      readOnly={props.readOnly}
      required={props.required}
      aria-invalid={props['aria-invalid']}
      aria-describedby={props['aria-describedby']}
      aria-label={t('time')}
      onBlur={props.onBlur}
      onValueChange={nextTime => onValueChange(nextTime ? `${date || defaultDate()}T${nextTime}` : '')}
    />
  </div>;
});
