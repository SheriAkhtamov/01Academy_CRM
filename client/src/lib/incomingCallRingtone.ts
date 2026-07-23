export const INCOMING_CALL_RINGTONE_PATTERN = [
  { offsetSeconds: 0, durationSeconds: 0.32 },
  { offsetSeconds: 0.46, durationSeconds: 0.32 },
] as const;

export const INCOMING_CALL_RINGTONE_REPEAT_MS = 2_300;

const RINGTONE_FREQUENCIES = [440, 554.37] as const;
const RINGTONE_VOLUME = 0.055;

type AudioContextConstructor = new () => AudioContext;

const getAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
};

export const shouldPlayIncomingRingtone = (
  direction: 'incoming' | 'outgoing' | undefined,
  status: string | undefined,
) => direction === 'incoming' && status === 'ringing';

export class IncomingCallRingtone {
  private context: AudioContext | null = null;
  private repeatTimer: number | null = null;
  private shouldRing = false;
  private readonly oscillators = new Set<OscillatorNode>();
  private readonly gains = new Set<GainNode>();

  private ensureContext() {
    if (this.context && this.context.state !== 'closed') return this.context;
    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    return this.context;
  }

  async unlock() {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    const ready = context.state === 'running';
    if (ready && this.shouldRing && this.repeatTimer === null && this.oscillators.size === 0) {
      this.scheduleCycle(context);
    }
    return ready;
  }

  async start() {
    this.shouldRing = true;
    return this.unlock();
  }

  stop() {
    this.shouldRing = false;
    if (this.repeatTimer !== null) {
      window.clearTimeout(this.repeatTimer);
      this.repeatTimer = null;
    }
    for (const oscillator of this.oscillators) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have ended.
      }
      oscillator.disconnect();
    }
    this.oscillators.clear();
    for (const gain of this.gains) gain.disconnect();
    this.gains.clear();
  }

  destroy() {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private scheduleCycle(context: AudioContext) {
    if (!this.shouldRing || context.state !== 'running') return;
    const cycleStart = context.currentTime + 0.03;

    for (const pulse of INCOMING_CALL_RINGTONE_PATTERN) {
      const startAt = cycleStart + pulse.offsetSeconds;
      const endAt = startAt + pulse.durationSeconds;
      const gain = context.createGain();
      this.gains.add(gain);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(RINGTONE_VOLUME, startAt + 0.025);
      gain.gain.setValueAtTime(RINGTONE_VOLUME, endAt - 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      gain.connect(context.destination);

      let remainingOscillators = RINGTONE_FREQUENCIES.length;
      for (const frequency of RINGTONE_FREQUENCIES) {
        const oscillator = context.createOscillator();
        this.oscillators.add(oscillator);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startAt);
        oscillator.connect(gain);
        oscillator.onended = () => {
          oscillator.disconnect();
          this.oscillators.delete(oscillator);
          remainingOscillators -= 1;
          if (remainingOscillators === 0) {
            gain.disconnect();
            this.gains.delete(gain);
          }
        };
        oscillator.start(startAt);
        oscillator.stop(endAt);
      }
    }

    this.repeatTimer = window.setTimeout(() => {
      this.repeatTimer = null;
      if (!this.shouldRing) return;
      if (context.state === 'running') {
        this.scheduleCycle(context);
      } else {
        void this.unlock();
      }
    }, INCOMING_CALL_RINGTONE_REPEAT_MS);
  }
}
