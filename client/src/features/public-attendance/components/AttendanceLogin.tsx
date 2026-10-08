import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AlertCircle, ArrowBigUp, ArrowRight, ClipboardCheck, Clock3, DoorClosed, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface Props {
  password: string;
  loading: boolean;
  unavailable: boolean;
  /** The first check of the session failed: what to say instead of the form. */
  initialError?: string;
  /** Access ended on its own (time limit or a changed password), not because the visitor signed out. */
  expired: boolean;
  /** Marks that wait to be sent once the visitor is signed in again. */
  unsent: number;
  error?: string;
  pending: boolean;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent) => void;
  onRetry: () => void;
}

/*
  A visitor arrives here from a link someone sent them, so the screen says what
  is behind it and asks for exactly one thing. Everything that can go wrong is
  said next to the field in plain words: a wrong password, too many attempts,
  no connection, Caps Lock, or access that simply ran out — and how many marks
  are waiting to go out once the visitor is back in.

  The field does not ask for a numeric keypad: the shared password is set by an
  operator and may contain letters.
*/
export function AttendanceLogin(props: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  // The notice region is there from the first paint and filled right after it, so a screen reader announces the notice.
  const [announce, setAnnounce] = useState(false);
  useEffect(() => { setAnnounce(true); }, []);
  // A refused password leaves the field focused with its text selected, ready to be typed over.
  useEffect(() => {
    if (!props.error) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [props.error]);
  const watchCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  const described = [props.error ? 'attendance-password-error' : '', capsLock ? 'attendance-caps-lock' : ''].filter(Boolean).join(' ') || undefined;
  const unsent = props.unsent > 0 ? t('publicAttendanceUnsentAfterLogin').replace('{count}', String(props.unsent)) : '';
  return (
    <div className="pa-login">
      <div className="pa-login-card">
        <div className="pa-login-top">
          <span className="pa-login-mark" aria-hidden="true"><ClipboardCheck /></span>
          <LanguageSwitcher className="h-10 w-10 gap-0 px-0" />
        </div>
        <h1 className="pa-login-title">{t('publicAttendanceJournal')}</h1>
        <p className="pa-login-caption">{t('publicAttendanceBrand')} · {t('publicAttendanceCourse')}</p>

        <div aria-live="polite">
          {announce && (props.expired || unsent) ? (
            <div className="pa-login-notice">
              <Clock3 aria-hidden="true" />
              <div className="pa-login-notice-text">
                {props.expired ? <p>{t('publicAttendanceAccessExpired')}</p> : null}
                {unsent ? <p>{unsent}</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        {props.loading ? (
          <div className="pa-login-loading" role="status" aria-label={t('loading')}>
            <span className="pa-skeleton pa-skeleton-label" /><span className="pa-skeleton pa-skeleton-field" /><span className="pa-skeleton pa-skeleton-field" />
          </div>
        ) : props.initialError ? (
          <div className="pa-login-state">
            <span className="pa-login-state-icon is-error"><AlertCircle /></span>
            <p role="alert">{props.initialError}</p>
            <button type="button" className="pa-secondary" onClick={props.onRetry}>{t('retry')}</button>
          </div>
        ) : props.unavailable ? (
          <div className="pa-login-state">
            <span className="pa-login-state-icon"><DoorClosed /></span>
            <p role="status">{t('publicAttendanceUnavailable')}</p>
          </div>
        ) : (
          <form onSubmit={props.onSubmit} className="pa-login-form" noValidate>
            <label htmlFor="attendance-password" className="pa-field-label">{t('publicAttendancePassword')}</label>
            <div className={`pa-password${props.error ? ' is-invalid' : ''}`}>
              <LockKeyhole className="pa-password-icon" aria-hidden="true" />
              <input ref={inputRef} id="attendance-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={256}
                autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} value={props.password}
                onChange={(event) => props.onPasswordChange(event.target.value)} onKeyDown={watchCapsLock} onKeyUp={watchCapsLock}
                onBlur={() => setCapsLock(false)} aria-invalid={Boolean(props.error)} aria-describedby={described} />
              <button type="button" className="pa-password-toggle" aria-pressed={showPassword}
                aria-label={showPassword ? t('publicAttendanceHidePassword') : t('publicAttendanceShowPassword')}
                onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button>
            </div>
            {capsLock ? <p id="attendance-caps-lock" className="pa-field-hint"><ArrowBigUp aria-hidden="true" />{t('publicAttendanceCapsLock')}</p> : null}
            {props.error ? <p id="attendance-password-error" role="alert" className="pa-field-error"><AlertCircle aria-hidden="true" />{props.error}</p> : null}
            <button type="submit" className="pa-primary pa-login-submit" disabled={props.pending || !props.password}>
              {props.pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {t('publicAttendanceEnter')}
              {!props.pending ? <ArrowRight aria-hidden="true" /> : null}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
