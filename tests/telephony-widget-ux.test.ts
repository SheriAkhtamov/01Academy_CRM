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
    // The spread is what makes the whole surface the handle. It is applied
    // through `dockedDragProps` so that a phone can opt out of dragging
    // entirely, but it must still be a spread of the hook's own props onto
    // the widget root — never a separate grip element.
    expect(widget).toContain('{...dockedDragProps}');
    expect(widget).toContain('isMobile ? {} : widgetDragProps');
    expect(widget).not.toContain('GripHorizontal');
    expect(widget).not.toContain('dragHandleProps');
  });

  it('docks to a corner instead of dragging on a phone', () => {
    // Dragging by the whole surface competes with the scroll and swipe
    // gestures the dialer and the call history need for themselves, and a
    // phone has nowhere to park the widget anyway.
    expect(widget).toContain("import { useIsMobileViewport } from '@/hooks/useMediaQuery';");
    expect(widget).toContain('const dockedStyle = isMobile ?');
    // Both the expanded panel and the collapsed pill take the whole surface
    // as the drag handle, so both need touch panning switched off on desktop.
    expect(widget.match(/!isMobile && 'touch-none cursor-move'/g) ?? []).toHaveLength(2);
  });

  it('lets text fields and scroll regions keep the press for themselves', () => {
    expect(movableWidget).toContain("event.target.closest('[data-no-drag]')");
    expect(dialer).toContain('data-no-drag');
    expect(history).toContain('data-no-drag');
  });

  it('opts every pressable control out, so a 6px wobble cannot eat the press', () => {
    // The dialpad, the tab switcher and the call actions are aimed at, not
    // dragged from. Without this the drag threshold swallowed the click.
    expect(dialer).toContain('grid max-w-60 grid-cols-3 gap-2" data-no-drag');
    expect(widget).toContain('role="tablist"');
    expect(widget).toMatch(/role="tablist"[\s\S]{0,200}?data-no-drag/);
    expect(activeCall).toContain('items-center justify-center gap-3 border-t bg-background/95 px-4 py-3" data-no-drag');
    expect(activeCall).toContain("'telephony-control cursor-pointer'");
  });

  it('still lets the collapsed pill itself be dragged into a corner', () => {
    const pill = widget.slice(widget.indexOf('The collapsed pill'));
    expect(pill).toContain("aria-label={t('telephonyOpen')}");
    expect(pill.slice(0, pill.indexOf("aria-label={t('telephonyOpen')}"))).not.toContain('data-no-drag');
  });
});

describe('telephony widget call controls', () => {
  it('never locks hanging up behind the microphone request that answering starts', () => {
    // answerCall() sets pendingPhone before awaiting getUserMedia, and that
    // request can hang for 30s. Disabling hangup on the same flag left the
    // manager with no way out of a call they had just mis-answered.
    const start = activeCall.indexOf('{!finished ? (');
    const hangup = activeCall.slice(start, activeCall.indexOf(') : (', start));
    expect(hangup).toContain('onClick={onHangup}');
    expect(hangup).not.toContain('disabled=');
  });

  it('holds the answer button still instead of floating it away from the pointer', () => {
    expect(activeCall).not.toContain('animate-float');
    expect(widget).not.toContain('animate-float');
  });

  it('answers and declines straight from the collapsed pill', () => {
    expect(widget).toContain('isIncomingRinging');
    expect(widget).toContain("aria-label={t('telephonyAnswer')}");
    expect(widget).toContain("aria-label={t('telephonyDecline')}");
  });

  it('will not fire a transfer twice while the first one is still in flight', () => {
    expect(activeCall).toContain('const [isTransferring, setIsTransferring] = useState(false);');
    expect(activeCall).toContain('if (isTransferring) return;');
    expect(activeCall).not.toContain('void onTransfer(transferTarget)');
  });

  it('reopens a call note on what was saved rather than on an empty box', () => {
    expect(activeCall).not.toContain('note={null}');
    expect(activeCall).toContain('note={savedNote}');
    expect(activeCall).toContain('onSaved={setSavedNote}');
  });

  it('keeps DTMF capture away from every kind of text field, rich ones included', () => {
    expect(activeCall).toContain('isEditableTarget(event.target)');
    expect(activeCall).not.toContain("['INPUT', 'TEXTAREA'].includes(target.tagName)");
  });
});

describe('telephony widget layout', () => {
  it('scrolls in exactly one place per tab instead of nesting scrollbars', () => {
    expect(history).not.toContain('h-[336px]');
    expect(dialer).toContain('flex-1 overflow-y-auto overscroll-contain');
    expect(activeCall).toContain('flex-1 flex-col items-center overflow-y-auto overscroll-contain');
  });

  it('lets the history list take what is left rather than a floor that overshoots it', () => {
    // The search box and the filter chips eat ~89px of the 304px panel, so a
    // 220px floor under the list added up to more than the card can show and
    // the last row was clipped by the rounded bottom edge.
    expect(history).toContain('min-h-0 flex-1');
    expect(history).not.toContain('min-h-[220px]');
  });

  it('puts a floor under the clipped body so a short viewport cannot squeeze it away', () => {
    expect(widget).toContain('flex min-h-[min(22rem,calc(100dvh-88px))] flex-1 flex-col overflow-hidden');
  });

  it('never floors a panel higher than the card is allowed to grow', () => {
    // The card tops out at `calc(100dvh-24px)`. Any floor stated as a flat
    // length outgrows that ceiling on a landscape phone and pushes the call
    // button out through the clipped bottom edge, so every floor worth more
    // than a spacer has to shrink with the viewport.
    expect(widget).toContain('max-h-[min(660px,calc(100dvh-24px))]');
    expect(activeCall).toContain('min-h-[min(386px,calc(100dvh-88px))]');

    for (const source of widgetSources) {
      const flatFloors = (source.match(/min-h-\[[^\]]+\]/g) ?? []).filter((token) => {
        if (token.includes('min(')) return false;
        const size = Number(token.match(/(\d+(?:\.\d+)?)(px|rem)\]/)?.[1] ?? 0);
        const rem = token.endsWith('rem]') ? size * 16 : size;
        return rem > 64;
      });
      expect(flatFloors).toEqual([]);
    }
  });

  it('scrolls the transfer targets natively, because Radix cannot size itself here', () => {
    // ScrollArea's viewport asks for `height: 100%` of a root left at auto
    // height; that resolves back to auto, so `max-h` clipped the extension
    // list instead of scrolling it and the tail was unreachable.
    expect(activeCall).toContain('max-h-36 overflow-y-auto overscroll-contain');
    expect(activeCall).not.toContain('<ScrollArea');
    expect(activeCall).not.toContain("from '@/components/ui/scroll-area'");
  });

  it('announces the two views as a real tablist', () => {
    expect(widget).toContain('role="tablist"');
    expect(widget).toContain('role="tab"');
    expect(widget).toContain('role="tabpanel"');
    expect(widget).toContain("aria-selected={tab === 'dialer'}");
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
