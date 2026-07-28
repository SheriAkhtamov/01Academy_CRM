import { describe, expect, it, vi } from 'vitest';
import { createAcademyLeadRequestSchema } from '../shared/contracts/academy-leads';
import { sendMessageRequestSchema } from '../shared/contracts/messages';
import {
  publishRealtimeEvent,
  setRealtimeTransport,
} from '../server/realtime/realtime-hub';

describe('shared API contracts', () => {
  it('normalizes valid message input and rejects malformed payloads', () => {
    expect(sendMessageRequestSchema.parse({
      receiverId: '7',
      content: '  hello  ',
    })).toEqual({
      receiverId: 7,
      content: 'hello',
    });

    expect(sendMessageRequestSchema.safeParse({
      receiverId: '7oops',
      content: 'hello',
    }).success).toBe(false);
    expect(sendMessageRequestSchema.safeParse({
      receiverId: 7,
      content: { text: 'hello' },
    }).success).toBe(false);
  });

  it('keeps lead acquisition extensions compatible while validating core fields', () => {
    const result = createAcademyLeadRequestSchema.parse({
      contactName: '  Parent  ',
      sourceCode: 'website',
      managerId: '9',
      campaignPayload: { utmSource: 'instagram' },
    });

    expect(result).toMatchObject({
      contactName: 'Parent',
      sourceCode: 'website',
      managerId: 9,
      campaignPayload: { utmSource: 'instagram' },
    });
    expect(createAcademyLeadRequestSchema.safeParse({
      contactName: '',
    }).success).toBe(false);
  });
});

describe('realtime port', () => {
  it('decouples domain publishing from the active WebSocket transport', () => {
    const transport = vi.fn();
    const reset = setRealtimeTransport(transport);
    const event = {
      type: 'ACADEMY_LEAD_CREATED' as const,
      data: { id: 42 },
    };

    publishRealtimeEvent(event);
    expect(transport).toHaveBeenCalledWith(event);

    reset();
    publishRealtimeEvent(event);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
