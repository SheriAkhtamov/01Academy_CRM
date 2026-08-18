import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveTransferTarget } from '../client/src/contexts/TelephonyContext';
import { isUnansweredIncoming } from '../client/src/components/telephony/TelephonyCallHistory';
import {
  isDiallableNumber,
  sanitizeDialledNumber,
} from '../client/src/components/telephony/TelephonyDialer';
import { parseTelephonyCallNote } from '../server/routes/telephony.routes';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const widget = read('client/src/components/telephony/TelephonyWidget.tsx');
const activeCall = read('client/src/components/telephony/TelephonyActiveCall.tsx');
const history = read('client/src/components/telephony/TelephonyCallHistory.tsx');
const dialer = read('client/src/components/telephony/TelephonyDialer.tsx');
const movableWidget = read('client/src/hooks/useMovableWidget.ts');
const widgetSources = [widget, activeCall, history, dialer];

describe('telephony widget theming', () => {
  it('paints itself from semantic tokens so the dark theme is not left behind', () => {
    // Only these three slate utilities are remapped for dark mode, and the
    // collapsed pill is deliberately dark in both themes.
    const darkAwareSlate = /\bslate-(?:600|800|950)\b/g;
    for (const source of widgetSources) {
      const slateClasses = source.match(/\bslate-\d{2,3}\b/g) ?? [];
      const unmapped = slateClasses.filter((token) => !token.match(darkAwareSlate));
      expect(unmapped).toEqual([]);
    }
  });
});

describe('telephony widget call duration', () => {
  it('shows hours through the shared formatter instead of a local minute counter', () => {
    for (const source of [widget, activeCall, history]) {
      expect(source).toContain('formatCallDuration');
      expect(source).not.toContain('const formatDuration =');
    }
    expect(activeCall).toContain('telephonyStatusTranslationKey(call.status)');
  });
});

describe('telephony widget drag surface', () => {
  it('is still dragged by its whole surface rather than by a grip handle', () => {
    expect(widget).toContain('useMovableWidget<HTMLDivElement>');
    expect(widget).toContain('{...widgetDragProps}');
    expect(widget).not.toContain('GripHorizontal');
    expect(widget).not.toContain('dragHandleProps');
  });

  it('lets text fields and scroll regions keep the press for themselves', () => {
    expect(movableWidget).toContain("event.target.closest('[data-no-drag]')");
    expect(dialer).toContain('data-no-drag');
    expect(history).toContain('data-no-drag');
  });
});

describe('telephony widget presence rules', () => {
  it('opens itself as soon as a call starts so ringing is never invisible', () => {
    expect(widget).toContain('if (!activeCallKey) return;');
    expect(widget).toContain('setIsOpen(true)');
  });

  it('keeps a finished call on screen until the manager closes it', () => {
    expect(widget).not.toContain('FINISHED_CALL_DISMISS_MS');
    expect(widget).not.toContain('dismissTimerRef');
    expect(activeCall).toContain('onClose');
  });

  it('never collapses through Escape while the manager is typing', () => {
    expect(widget).toContain('isEditableTarget(event.target)');
  });
});

describe('telephony widget history', () => {
  it('separates an unanswered incoming call from one that was picked up', () => {
    expect(isUnansweredIncoming({ direction: 'incoming', status: 'missed', talkSeconds: 0 })).toBe(true);
    expect(isUnansweredIncoming({ direction: 'incoming', status: 'declined', talkSeconds: 0 })).toBe(true);
    expect(isUnansweredIncoming({ direction: 'incoming', status: 'ended', talkSeconds: 42 })).toBe(false);
    expect(isUnansweredIncoming({ direction: 'outgoing', status: 'failed', talkSeconds: 0 })).toBe(false);
  });

  it('offers a way into the contact card and the full journal', () => {
    expect(history).toContain('/sales/pipeline?lead=${call.leadId}');
    expect(activeCall).toContain('/sales/pipeline?lead=${call.contact.leadId}');
    expect(widget).toContain('href="/sales/calls"');
  });

  it('relies on the websocket invalidation rather than polling on a timer', () => {
    expect(history).not.toContain('refetchInterval');
  });
});

describe('telephony dialer input', () => {
  it('keeps only diallable characters and refuses a number that is too short', () => {
    expect(sanitizeDialledNumber('+998 (90) 123-45-67')).toBe('+998901234567');
    expect(sanitizeDialledNumber('call me maybe')).toBe('');
    expect(isDiallableNumber('+998901234567')).toBe(true);
    expect(isDiallableNumber('123')).toBe(false);
  });
});

describe('telephony transfer target', () => {
  it('accepts a colleague extension and a full external number, but not your own line', () => {
    expect(resolveTransferTarget('101', '100')).toBe('101');
    expect(resolveTransferTarget('100', '100')).toBeNull();
    expect(resolveTransferTarget('+998 90 123 45 67', '100')).toBe('998901234567');
    expect(resolveTransferTarget('901234567', '100')).toBe('998901234567');
    expect(resolveTransferTarget('12', '100')).toBeNull();
    expect(resolveTransferTarget('99', '100')).toBeNull();
  });
});

describe('telephony call note', () => {
  it('stores trimmed text, clears on an empty value and rejects an oversized note', () => {
    expect(parseTelephonyCallNote('  agreed on a demo  ')).toBe('agreed on a demo');
    expect(parseTelephonyCallNote('   ')).toBeNull();
    expect(parseTelephonyCallNote(null)).toBeNull();
    expect(parseTelephonyCallNote('x'.repeat(2_001))).toBeUndefined();
    expect(parseTelephonyCallNote(42)).toBeUndefined();
  });
});

describe('telephony ringer', () => {
  it('silences the ringtone without hiding the call itself', () => {
    const provider = read('client/src/contexts/TelephonyContext.tsx');
    expect(provider).toContain('if (ringtoneMutedRef.current) return;');
    expect(provider).toContain('!isRingtoneMuted && shouldPlayIncomingRingtone(');
    expect(widget).toContain('telephony.toggleRingtoneMuted');
  });
});
