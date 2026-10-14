import type { RtpPacket } from 'werift';

const SAMPLE_RATE = 8_000;
const WINDOW_SAMPLES = 320;
const STEP_SAMPLES = 160;
const ROWS = [697, 770, 852, 941];
const COLUMNS = [1209, 1336, 1477, 1633];
const KEYPAD = ['123A', '456B', '789C', '*0#D'];

export const decodeMulawSample = (byte: number): number => {
  const value = ~byte & 255;
  const magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
  return value & 128 ? 132 - magnitude : magnitude - 132;
};

const tonePower = (samples: readonly number[], frequency: number): number => {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SAMPLE_RATE);
  let previous = 0;
  let older = 0;
  for (const sample of samples) {
    const value = sample + coefficient * previous - older;
    older = previous;
    previous = value;
  }
  return previous * previous + older * older - coefficient * previous * older;
};

/** Require a sustained, dominant pair of keypad frequencies rather than speech. */
export const detectDtmfTone = (samples: readonly number[]): string | null => {
  if (samples.length !== WINDOW_SAMPLES) return null;
  const energy = samples.reduce((sum, sample) => sum + sample * sample, 0);
  if (energy / samples.length < 400) return null;
  const row = ROWS.map(frequency => tonePower(samples, frequency));
  const column = COLUMNS.map(frequency => tonePower(samples, frequency));
  const rowIndex = row.indexOf(Math.max(...row));
  const columnIndex = column.indexOf(Math.max(...column));
  const rowPower = row[rowIndex];
  const columnPower = column[columnIndex];
  if (row.some((value, index) => index !== rowIndex && value * 4 > rowPower)
    || column.some((value, index) => index !== columnIndex && value * 4 > columnPower)) return null;
  const normalization = samples.length * energy / 2;
  if (rowPower / normalization < 0.12 || columnPower / normalization < 0.12
    || (rowPower + columnPower) / normalization < 0.8
    || rowPower / columnPower < 0.15 || rowPower / columnPower > 6.3) return null;
  return KEYPAD[rowIndex][columnIndex];
};

/** One call's negotiated, decrypted RTP only. No incoming audio is recorded. */
export class DtmfReceiver {
  private armed = false;
  private samples: number[] = [];
  private previousDigit: string | null = null;
  private consecutiveWindows = 0;
  private reportedTone = false;
  private previousPacket?: { ssrc: number; sequence: number; timestamp: number };
  private readonly telephonePayloads = new Set<number>();
  private readonly events = new Set<string>();

  constructor(private readonly report: (digit: string) => void) {}

  negotiate(remoteSdp: string) {
    this.telephonePayloads.clear();
    for (const line of remoteSdp.split(/\r?\n/)) {
      const match = line.match(/^a=rtpmap:(\d+) telephone-event\/8000\s*$/i);
      if (match) this.telephonePayloads.add(Number(match[1]));
    }
  }

  arm() {
    this.armed = true;
    this.samples = [];
    this.previousDigit = null;
    this.consecutiveWindows = 0;
    this.reportedTone = false;
    this.previousPacket = undefined;
  }

  disarm() {
    this.armed = false;
    this.samples = [];
  }

  receive(packet: RtpPacket) {
    if (!this.armed) return;
    if (this.telephonePayloads.has(packet.header.payloadType)) {
      const bytes = packet.payload;
      if (bytes.length !== 4 || bytes[0] > 15 || (bytes[1] & 0x40)
        || !(bytes[1] & 0x80) || bytes.readUInt16BE(2) < 320) return;
      const key = `${packet.header.ssrc}:${packet.header.timestamp}:${bytes[0]}`;
      if (this.events.has(key)) return;
      if (this.events.size >= 64) this.events.delete(this.events.values().next().value!);
      this.events.add(key);
      this.report('0123456789*#ABCD'[bytes[0]]);
      return;
    }
    if (packet.header.payloadType !== 0 || !packet.payload.length || packet.payload.length > 1_600) return;
    const previous = this.previousPacket;
    const next = { ssrc: packet.header.ssrc, sequence: packet.header.sequenceNumber, timestamp: packet.header.timestamp };
    if (previous?.ssrc === next.ssrc && previous.sequence === next.sequence) return;
    if (previous && (previous.ssrc !== next.ssrc || ((previous.sequence + 1) & 0xffff) !== next.sequence)) {
      this.samples = [];
      this.previousDigit = null;
      this.consecutiveWindows = 0;
      this.reportedTone = false;
    }
    this.previousPacket = next;
    this.samples.push(...Array.from(packet.payload, decodeMulawSample));
    while (this.samples.length >= WINDOW_SAMPLES) {
      const digit = detectDtmfTone(this.samples.slice(0, WINDOW_SAMPLES));
      this.samples.splice(0, STEP_SAMPLES);
      if (digit !== this.previousDigit) {
        this.consecutiveWindows = 0;
        this.reportedTone = false;
      }
      this.previousDigit = digit;
      this.consecutiveWindows += 1;
      // Two overlapping 40 ms windows establish at least 60 ms of a tone.
      if (digit && this.consecutiveWindows >= 2 && !this.reportedTone) {
        this.reportedTone = true;
        this.report(digit);
      }
    }
  }
}
