import { describe, expect, it, vi } from 'vitest';
import {
  resolveOnlinePbxRecording,
} from '../server/services/telephony-recording';
import type { OnlinePbxCallHistoryItem } from '../server/services/onlinepbx';

const historyItem = (
  input: Partial<OnlinePbxCallHistoryItem> & Pick<OnlinePbxCallHistoryItem, 'uuid' | 'startStamp'>,
): OnlinePbxCallHistoryItem => ({
  uuid: input.uuid,
  callerIdNumber: input.callerIdNumber ?? '+998901234567',
  destinationNumber: input.destinationNumber ?? '100',
  startStamp: input.startStamp,
  endStamp: input.endStamp ?? input.startStamp + 60,
  duration: input.duration ?? 60,
  talkTime: input.talkTime ?? 45,
  hangupCause: input.hangupCause ?? 'NORMAL_CLEARING',
  direction: input.direction ?? 'outbound',
  gateway: input.gateway ?? '',
  events: input.events ?? [],
});

describe('OnlinePBX recording resolution', () => {
  it('requests a fresh signed URL whenever the provider UUID is already known', async () => {
    const getCallRecordingUrl = vi.fn().mockResolvedValue(
      'https://api2.onlinepbx.ru/calls-records/download/fresh/rec.mp3',
    );
    const getCallHistory = vi.fn();

    await expect(resolveOnlinePbxRecording({
      providerCallId: 'provider-call-uuid',
      phone: '+998901234567',
      startedAt: '2026-07-28T10:00:00.000Z',
    }, {
      getCallHistory,
      getCallRecordingUrl,
    })).resolves.toEqual({
      state: 'ready',
      url: 'https://api2.onlinepbx.ru/calls-records/download/fresh/rec.mp3',
      providerCallId: 'provider-call-uuid',
      history: null,
    });

    expect(getCallRecordingUrl).toHaveBeenCalledWith('provider-call-uuid');
    expect(getCallHistory).not.toHaveBeenCalled();
  });

  it('finds the nearest matching call when a provider UUID is missing', async () => {
    const startedAt = Date.parse('2026-07-28T10:00:00.000Z');
    const nearest = historyItem({
      uuid: 'nearest-call',
      startStamp: Math.floor(startedAt / 1000) + 15,
    });
    const getCallHistory = vi.fn().mockResolvedValue([
      historyItem({
        uuid: 'other-phone',
        callerIdNumber: '+998991111111',
        startStamp: Math.floor(startedAt / 1000),
      }),
      historyItem({
        uuid: 'farther-call',
        startStamp: Math.floor(startedAt / 1000) + 120,
      }),
      nearest,
    ]);
    const getCallRecordingUrl = vi.fn().mockResolvedValue(
      'https://api2.onlinepbx.ru/calls-records/download/found/rec.mp3',
    );

    await expect(resolveOnlinePbxRecording({
      providerCallId: null,
      phone: '+998901234567',
      startedAt: new Date(startedAt),
    }, {
      getCallHistory,
      getCallRecordingUrl,
    })).resolves.toEqual({
      state: 'ready',
      url: 'https://api2.onlinepbx.ru/calls-records/download/found/rec.mp3',
      providerCallId: 'nearest-call',
      history: nearest,
    });

    expect(getCallHistory).toHaveBeenCalledWith({
      phoneNumbers: '+998901234567',
      startStampFrom: Math.floor(startedAt / 1000) - 180,
      startStampTo: Math.floor(startedAt / 1000) + 300,
    });
    expect(getCallRecordingUrl).toHaveBeenCalledWith('nearest-call');
  });

  it('reports a pending recording when OnlinePBX history has no matching call', async () => {
    const getCallRecordingUrl = vi.fn();
    const getCallHistory = vi.fn().mockResolvedValue([]);

    await expect(resolveOnlinePbxRecording({
      providerCallId: null,
      phone: '+998901234567',
      startedAt: '2026-07-28T10:00:00.000Z',
    }, {
      getCallHistory,
      getCallRecordingUrl,
    })).resolves.toEqual({ state: 'pending' });
    expect(getCallRecordingUrl).not.toHaveBeenCalled();
  });

  it('reports an unavailable recording when a matched call has no downloadable audio', async () => {
    const getCallHistory = vi.fn().mockResolvedValue([
      historyItem({
        uuid: 'matched-without-audio',
        startStamp: Date.parse('2026-07-28T10:00:00.000Z') / 1000,
      }),
    ]);
    const getCallRecordingUrl = vi.fn().mockResolvedValue(null);

    await expect(resolveOnlinePbxRecording({
      providerCallId: null,
      phone: '+998901234567',
      startedAt: '2026-07-28T10:00:00.000Z',
    }, {
      getCallHistory,
      getCallRecordingUrl,
    })).resolves.toEqual({ state: 'unavailable' });
    expect(getCallRecordingUrl).toHaveBeenCalledWith('matched-without-audio');
  });
});
