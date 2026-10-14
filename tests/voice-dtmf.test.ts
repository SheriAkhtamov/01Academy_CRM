import { describe, expect, it } from 'vitest';
import { RtpHeader, RtpPacket } from 'werift';
import { decodeMulawSample, detectDtmfTone, DtmfReceiver } from '../server/infrastructure/voice-telephony/dtmf-receiver';

// Independent G.711 encoder supplies actual telephony samples to the receiver.
const mulaw = (sample: number) => {
  const sign = sample < 0 ? 128 : 0;
  const magnitude = Math.min(32635, Math.abs(sample)) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
  return ~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 15)) & 255;
};
const tone = (row = 697, column = 1209, count = 960) => Buffer.from(Array.from({ length: count }, (_, index) => (
  mulaw(Math.round(3000 * Math.sin(2 * Math.PI * row * index / 8000)
    + 3000 * Math.sin(2 * Math.PI * column * index / 8000)))
)));
const packet = (payload: Buffer, sequence = 1, payloadType = 0, timestamp = sequence * 160, ssrc = 123) => (
  new RtpPacket(new RtpHeader({ payloadType, sequenceNumber: sequence, timestamp, ssrc }), payload)
);
const feed = (receiver: DtmfReceiver, data: Buffer, start = 1) => {
  for (let offset = 0; offset < data.length; offset += 160) receiver.receive(packet(data.subarray(offset, offset + 160), start + offset / 160));
};

describe('DTMF signals received by the reminder robot', () => {
  it('decodes the G.711 silence and peak values', () => {
    expect([255, 127, 0, 128].map(decodeMulawSample)).toEqual([0, 0, -32124, 32124]);
  });

  it.each([[697, 1209, '1'], [697, 1336, '2'], [852, 1477, '9'], [941, 1209, '*']] as const)(
    'recognizes sustained PCMU keypad tone %s/%s once as %s', (row, column, expected) => {
      const actual: string[] = [];
      const receiver = new DtmfReceiver(digit => actual.push(digit));
      receiver.arm();
      feed(receiver, tone(row, column));
      expect(actual).toEqual([expected]);
    },
  );

  it('ignores early audio, silence, single-frequency sounds and brief tones', () => {
    const actual: string[] = [];
    const receiver = new DtmfReceiver(digit => actual.push(digit));
    feed(receiver, tone());
    receiver.arm();
    feed(receiver, Buffer.alloc(960, 255));
    feed(receiver, tone(697, 697), 7);
    feed(receiver, tone(697, 1209, 160), 13);
    feed(receiver, Buffer.alloc(960, 255), 14);
    expect(actual).toEqual([]);
    expect(detectDtmfTone(Array(320).fill(0))).toBeNull();
  });

  it('does not construct a tone from duplicate or nonconsecutive RTP packets', () => {
    const actual: string[] = [];
    const receiver = new DtmfReceiver(digit => actual.push(digit));
    const samples = tone();
    receiver.arm();
    const first = packet(samples.subarray(0, 160), 1);
    receiver.receive(first);
    receiver.receive(first);
    receiver.receive(packet(samples.subarray(320, 480), 3));
    receiver.receive(packet(samples.subarray(480, 640), 4));
    expect(actual).toEqual([]);
  });

  it('uses only negotiated telephone-event payloads and deduplicates end packets', () => {
    const actual: string[] = [];
    const receiver = new DtmfReceiver(digit => actual.push(digit));
    const event = packet(Buffer.from([2, 138, 3, 32]), 1, 126, 999);
    receiver.receive(event);
    receiver.arm();
    receiver.receive(event);
    receiver.negotiate('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0 126\r\na=rtpmap:126 telephone-event/8000\r\n');
    receiver.receive(event);
    receiver.receive(packet(event.payload, 2, 126, 999));
    expect(actual).toEqual(['2']);
    receiver.disarm();
    receiver.receive(packet(Buffer.from([1, 138, 3, 32]), 3, 126, 2000));
    expect(actual).toEqual(['2']);
  });

  it.each([Buffer.from([1]), Buffer.from([1, 74, 3, 32]), Buffer.from([1, 10, 3, 32]),
    Buffer.from([17, 138, 3, 32]), Buffer.from([1, 138, 0, 1])])('rejects malformed, reserved or unfinished events', bytes => {
    const actual: string[] = [];
    const receiver = new DtmfReceiver(digit => actual.push(digit));
    receiver.negotiate('a=rtpmap:101 telephone-event/8000\r\n');
    receiver.arm();
    receiver.receive(packet(bytes, 1, 101));
    expect(actual).toEqual([]);
  });
});
