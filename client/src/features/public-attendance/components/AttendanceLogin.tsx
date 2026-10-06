import { useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Check, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  password: string;
  loading: boolean;
  unavailable: boolean;
  initialError: boolean;
  error?: string;
  pending: boolean;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent) => void;
  onRetry: () => void;
}

export function AttendanceLogin(props: Props) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="pa-login-layout">
      <section className="pa-login-cover">
        <div className="pa-login-title">
          <span className="pa-cover-tag">{t('publicAttendanceCourse')}</span>
          <h1>{t('publicAttendanceJournal')}</h1>
        </div>
        <div className="pa-login-art" aria-hidden="true">
          <div className="pa-art-calendar"><CalendarDays /><div className="pa-art-line" /></div>
          <div className="pa-art-days">{Array.from({ length: 8 }, (_, index) => <span key={index} className={index === 2 ? 'is-active' : ''} />)}</div>
          <div className="pa-art-rows">{Array.from({ length: 4 }, (_, index) => (
            <div className="pa-art-row" key={index}>
              <div className="pa-art-avatar" /><div className="pa-art-name"><span /><span /></div>
              <span className={`pa-art-check ${index === 2 ? 'is-pending' : ''}`}>{index === 2 ? null : <Check />}</span>
            </div>
          ))}</div>
          <div className="pa-art-float"><Check /></div>
        </div>
      </section>
      <section className="pa-login-form-panel">
        <div className="pa-login-form-heading"><span className="pa-lock"><LockKeyhole /></span><h2>{t('publicAttendanceLoginTitle')}</h2></div>
        {props.loading ? <p role="status" className="pa-loading"><Loader2 className="animate-spin" />{t('loading')}</p>
          : props.initialError ? <div className="pa-login-error"><p role="alert">{t('publicAttendanceLoadFailed')}</p><Button variant="outline" onClick={props.onRetry}>{t('retry')}</Button></div>
            : props.unavailable ? <p role="status" className="pa-muted">{t('publicAttendanceUnavailable')}</p>
              : <form onSubmit={props.onSubmit} className="pa-login-form">
                <Label htmlFor="attendance-password">{t('publicAttendancePassword')}</Label>
                <div className="pa-password-field">
                  <Input id="attendance-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" inputMode="numeric" required maxLength={256}
                    value={props.password} onChange={(event) => props.onPasswordChange(event.target.value)} className="pa-password-input" aria-invalid={Boolean(props.error)} aria-describedby={props.error ? 'attendance-password-error' : undefined} />
                  <Button type="button" variant="ghost" className="pa-password-toggle" aria-label={showPassword ? t('publicAttendanceHidePassword') : t('publicAttendanceShowPassword')}
                    onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</Button>
                </div>
                {props.error ? <p id="attendance-password-error" role="alert" className="pa-error-text">{props.error}</p> : null}
                <Button type="submit" className="pa-enter-button" disabled={props.pending || !props.password}>
                  {props.pending ? <Loader2 className="animate-spin" /> : null}{t('publicAttendanceEnter')}{!props.pending ? <ArrowRight /> : null}
                </Button>
              </form>}
      </section>
    </div>
  );
}
