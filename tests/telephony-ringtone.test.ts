import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INCOMING_CALL_RINGTONE_PATTERN,
  INCOMING_CALL_RINGTONE_REPEAT_MS,
  shouldPlayIncomingRingtone,
} from '../client/src/lib/incomingCallRingtone';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('incoming call ringtone', () => {
  it('rings only while an incoming browser call is waiting for an answer', () => {
    expect(shouldPlayIncomingRingtone('incoming', 'ringing')).toBe(true);
    expect(shouldPlayIncomingRingtone('incoming', 'connected')).toBe(false);
    expect(shouldPlayIncomingRingtone('outgoing', 'ringing')).toBe(false);
    expect(shouldPlayIncomingRingtone(undefined, undefined)).toBe(false);
  });

  it('uses a restrained double-pulse pattern with a pause between repeats', () => {
    expect(INCOMING_CALL_RINGTONE_PATTERN).toHaveLength(2);
    expect(INCOMING_CALL_RINGTONE_PATTERN[1].offsetSeconds)
      .toBeGreaterThan(INCOMING_CALL_RINGTONE_PATTERN[0].durationSeconds);
    expect(INCOMING_CALL_RINGTONE_REPEAT_MS).toBeGreaterThan(2_000);
  });

  it('does not depend on an external SIP-server ringtone asset', () => {
    const provider = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/contexts/TelephonyContext.tsx'),
      'utf8',
    );

    expect(provider).toContain('IncomingCallRingtone');
    expect(provider).not.toContain('/assets/audio/ring.mp3');
  });
});
