import { describe, expect, it } from 'vitest';
import {
  ONLINE_PBX_SHARED_EXTENSION,
  sharedCallEventClaimsOwnership,
} from '../shared/telephony';

describe('shared OnlinePBX extension', () => {
  it('uses extension 100 for the whole CRM', () => {
    expect(ONLINE_PBX_SHARED_EXTENSION).toBe('100');
  });

  it('does not let a ringing or rejected browser claim a shared incoming call', () => {
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'ringing',
      talkSeconds: 0,
    })).toBe(false);
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'declined',
      talkSeconds: 0,
    })).toBe(false);
  });

  it('attributes the call to the employee who answers or starts it', () => {
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'connected',
      talkSeconds: 0,
    })).toBe(true);
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'ended',
      talkSeconds: 18,
    })).toBe(true);
    expect(sharedCallEventClaimsOwnership({
      direction: 'outgoing',
      status: 'dialing',
      talkSeconds: 0,
    })).toBe(true);
  });
});
