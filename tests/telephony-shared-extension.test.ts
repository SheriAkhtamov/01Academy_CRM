import { describe, expect, it } from 'vitest';
import {
  ONLINE_PBX_LEGACY_SHARED_EXTENSION,
  onlinePbxRoutingDestination,
  sharedCallEventClaimsOwnership,
} from '../shared/telephony';

describe('dedicated OnlinePBX extensions', () => {
  it('never routes new CRM calls through the legacy shared extension', () => {
    expect(ONLINE_PBX_LEGACY_SHARED_EXTENSION).toBe('100');
    expect(onlinePbxRoutingDestination(ONLINE_PBX_LEGACY_SHARED_EXTENSION)).toBeNull();
    expect(onlinePbxRoutingDestination('101')).toBe('101');
  });

  it('does not let a ringing or rejected browser claim an incoming call', () => {
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
