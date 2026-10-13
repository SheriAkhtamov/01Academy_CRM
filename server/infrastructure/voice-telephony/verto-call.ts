import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, usePCMU as createPcmuCodec } from 'werift';
import type WebSocket from 'ws';
import { VOICE_REMINDER_MAX_AUDIO_SECONDS } from '@shared/contracts/voice-reminders';
import type { VoiceReminderCallOutcome, VoiceReminderCallResult, VoiceReminderLine } from '../../modules/voice-reminders/application/ports';
import type { OnlinePbxWebRtcCredentials } from '../../services/onlinepbx';
import { VertoRpcClient, VertoTransportError, type VertoEvent } from './verto-rpc';

const execute = promisify(execFile);
const SAMPLE_RATE = 8_000;
const FRAME_BYTES = 160;
const FRAME_MILLISECONDS = 20;
const MAX_AUDIO_BYTES = VOICE_REMINDER_MAX_AUDIO_SECONDS * SAMPLE_RATE;

export type VertoReminderCallInput = Parameters<VoiceReminderLine['call']>[0] & {
  callId?: string;
  onStarted?: () => Promise<void>;
  signal?: AbortSignal;
};
export type VertoCallDependencies = {
  createSocket?: (url: string) => WebSocket;
  createPeer?: () => RTCPeerConnection;
  decodeAudio?: (filePath: string, signal: AbortSignal) => Promise<Buffer>;
  ringTimeoutMs?: number;
  mediaTimeoutMs?: number;
};

/** Decode only a local, previously inspected audio file into bounded G.711 μ-law. */
export const decodeReminderAudio = async (filePath: string, signal: AbortSignal): Promise<Buffer> => {
  if (!path.isAbsolute(filePath) || !(await fs.lstat(filePath)).isFile()) throw new VertoTransportError();
  const { stdout } = await execute('ffmpeg', [
    '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', filePath,
    '-vn', '-f', 'mulaw', '-ar', String(SAMPLE_RATE), '-ac', '1', '-acodec', 'pcm_mulaw', 'pipe:1',
  ], { encoding: 'buffer', timeout: 20_000, maxBuffer: MAX_AUDIO_BYTES, signal });
  if (!stdout.length || stdout.length > MAX_AUDIO_BYTES) throw new VertoTransportError();
  return stdout;
};

class CallStopped extends Error {
  constructor(readonly outcome: VoiceReminderCallOutcome) { super('Voice call stopped'); }
}

const eventCallId = (event: VertoEvent): unknown => {
  const dialog = event.params.dialogParams;
  return event.params.callID ?? (dialog && typeof dialog === 'object' ? (dialog as Record<string, unknown>).callID : null);
};

const singleAudioSection = (sdp: string): string[] => {
  const lines = sdp.split(/\r\n|\n|\r/);
  const mediaLines = lines.flatMap((line, index) => line.startsWith('m=') ? [index] : []);
  if (mediaLines.length !== 1 || !/^m=audio\s/.test(lines[mediaLines[0]])) throw new VertoTransportError();
  return lines.slice(mediaLines[0]);
};

/** Legacy PBX SDP omits MID. A sole audio answer can only match the sole audio offer. */
export const normalizeLegacyVertoAudioAnswer = (remoteSdp: string, offerSdp: string): string => {
  const offeredMids = singleAudioSection(offerSdp).filter((line) => line.startsWith('a=mid:'));
  const offeredMid = offeredMids[0]?.match(/^a=mid:(\S+)$/)?.[1];
  if (offeredMids.length !== 1 || !offeredMid) throw new VertoTransportError();
  const remoteMids = singleAudioSection(remoteSdp).filter((line) => line.startsWith('a=mid:'));
  if (remoteMids.length) {
    if (remoteMids.length !== 1 || remoteMids[0] !== `a=mid:${offeredMid}`) throw new VertoTransportError();
    return remoteSdp;
  }
  const bundleGroups = remoteSdp.split(/\r\n|\n|\r/).filter((line) => /^a=group:BUNDLE(?:\s|$)/.test(line));
  if (bundleGroups.length > 1 || (bundleGroups.length === 1 && bundleGroups[0] !== `a=group:BUNDLE ${offeredMid}`)) {
    throw new VertoTransportError();
  }
  // Insert one attribute; remote ICE, fingerprints, directions and line endings
  // remain intact. No rewrite is attempted for multiple or ambiguous m-lines.
  const audioLine = /(^|\r\n|\n|\r)(m=audio[^\r\n]*)(\r\n|\n|\r)/;
  if (!audioLine.test(remoteSdp)) throw new VertoTransportError();
  return remoteSdp.replace(audioLine, (_, prefix: string, media: string, newline: string) => (
    `${prefix}${media}${newline}a=mid:${offeredMid}${newline}`
  ));
};

const createAudioPeer = () => new RTCPeerConnection({
  codecs: { audio: [createPcmuCodec({ payloadType: 0, clockRate: SAMPLE_RATE, channels: 1 })], video: [] },
  iceServers: [], iceUseIpv6: false, iceUseTcp: false, pendingRtp: false,
});

/** No media is sent until this call has a final answer and an active DTLS sender. */
export async function performVertoReminderCall(
  credentials: OnlinePbxWebRtcCredentials,
  input: VertoReminderCallInput,
  dependencies: VertoCallDependencies = {},
): Promise<VoiceReminderCallResult> {
  const callId = input.callId ?? randomUUID();
  const lifecycle = new AbortController();
  const peer = (dependencies.createPeer ?? createAudioPeer)();
  const track = new MediaStreamTrack({ kind: 'audio' });
  const sender = peer.addTransceiver(track, { direction: 'sendonly' }).sender;
  // werift 0.25 falls back to a public STUN service even for iceServers: [].
  // This server calls the PBX directly; keep candidate gathering local and
  // leave the full ICE connectivity checks with the negotiated PBX enabled.
  for (const transport of peer.iceTransports) transport.connection.stunServer = undefined;
  let rpc: VertoRpcClient | undefined;
  let callStarted = false;
  let answered = false;
  let receivedBye = false;
  let ending = false;
  let stopped: VoiceReminderCallOutcome | null = null;
  let descriptions = Promise.resolve();
  let result: VoiceReminderCallResult = { outcome: 'failed', callStarted: false, callId: null };
  let monitor: Promise<void> | undefined;
  const unsubscribe: Array<() => void> = [];
  let interrupt!: (outcome: VoiceReminderCallOutcome) => void;
  const interrupted = new Promise<VoiceReminderCallOutcome>((resolve) => { interrupt = resolve; });
  const stop = (outcome: VoiceReminderCallOutcome) => {
    if (stopped || ending) return;
    stopped = outcome;
    lifecycle.abort();
    interrupt(outcome);
  };
  const aborted = () => stop('cancelled');
  input.signal?.addEventListener('abort', aborted, { once: true });
  if (input.signal?.aborted) aborted();

  const bounded = async <Value>(task: Promise<Value>, timeoutMs: number): Promise<Value> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task,
        interrupted.then((outcome) => { throw new CallStopped(outcome); }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new VertoTransportError()), timeoutMs); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  };
  const check = async () => {
    if (stopped) throw new CallStopped(stopped);
    const allowed = await bounded(input.shouldContinue().catch(() => false), 2_000).catch(() => false);
    if (stopped) throw new CallStopped(stopped);
    if (Date.now() >= input.deadline.getTime() || input.signal?.aborted || !allowed) {
      stop('cancelled');
      throw new CallStopped('cancelled');
    }
  };
  const mediaConnected = () => peer.connectionState === 'connected'
    && sender.transport?.state === 'connected' && !sender.stopped && sender.codec?.payloadType === 0;
  const unsubscribePeer = peer.connectionStateChange.subscribe((state) => {
    if (state === 'failed' || state === 'disconnected' || state === 'closed') stop('failed');
  });

  try {
    if (!/^\+?[1-9]\d{7,14}$/.test(input.phone) || !Number.isFinite(input.deadline.getTime())) {
      throw new VertoTransportError();
    }
    await check();
    const audio = await bounded((dependencies.decodeAudio ?? decodeReminderAudio)(input.audioPath, lifecycle.signal), 20_000);
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new VertoTransportError();
    await check();
    rpc = new VertoRpcClient(credentials.websocketUrl, dependencies.createSocket);
    unsubscribe.push(rpc.onFailure(() => stop('failed')));
    unsubscribe.push(rpc.onEvent((event) => {
      if (event.method === 'verto.punt') { stop('failed'); return; }
      // A shared extension may also receive the managers' inbound fork. ACK is
      // handled by the RPC client; answering or rejecting that fork is forbidden.
      if (eventCallId(event) !== callId || stopped || ending) return;
      if (event.method === 'verto.bye') {
        receivedBye = true;
        const cause = String(event.params.cause ?? '').toUpperCase();
        const unanswered = ['NO_ANSWER', 'NO_USER_RESPONSE', 'USER_BUSY', 'CALL_REJECTED'].includes(cause);
        stop(!answered && unanswered ? 'unanswered' : 'failed');
        return;
      }
      if (event.method !== 'verto.media' && event.method !== 'verto.answer') return;
      const final = event.method === 'verto.answer';
      descriptions = descriptions.then(async () => {
        if (stopped || answered) return;
        const sdp = typeof event.params.sdp === 'string' ? event.params.sdp : final ? peer.remoteDescription?.sdp : undefined;
        if (!sdp) throw new VertoTransportError();
        const offerSdp = peer.localDescription?.sdp;
        if (!offerSdp) throw new VertoTransportError();
        await peer.setRemoteDescription({
          type: final ? 'answer' : 'pranswer',
          sdp: normalizeLegacyVertoAudioAnswer(sdp, offerSdp),
        });
        if (final) answered = true;
      }).catch(() => { stop('failed'); });
    }));
    await bounded(rpc.login(credentials), 16_000);
    await bounded(peer.setLocalDescription(await peer.createOffer()), 8_000);
    const sdp = peer.localDescription?.sdp;
    if (!sdp || peer.iceGatheringState !== 'complete') throw new VertoTransportError();
    await check();
    if (input.onStarted) await bounded(input.onStarted(), 2_000);
    await check();
    // From this point a network failure is ambiguous. It counts as an attempted
    // call and may never be automatically retried as if nothing was dialled.
    callStarted = true;
    const startedAt = Date.now();
    monitor = (async () => {
      while (!ending && !stopped) {
        await delay(500, undefined, { signal: lifecycle.signal }).catch(() => undefined);
        if (ending || stopped) break;
        try { await check(); } catch { break; }
      }
    })();
    await bounded(rpc.request('verto.invite', {
      sdp,
      dialogParams: {
        callID: callId, destination_number: input.phone.replace(/\D/g, ''),
        caller_id_name: credentials.extension, caller_id_number: credentials.extension,
        useVideo: false, useStereo: false,
      },
    }), 8_000);
    const ringDeadline = startedAt + (dependencies.ringTimeoutMs ?? 45_000);
    while (!answered) {
      if (Date.now() >= ringDeadline) throw new CallStopped('unanswered');
      await bounded(delay(20), 1_000);
    }
    const mediaDeadline = Date.now() + (dependencies.mediaTimeoutMs ?? 8_000);
    while (!mediaConnected()) {
      if (Date.now() >= mediaDeadline) throw new VertoTransportError();
      await bounded(delay(20), 1_000);
    }
    await check();
    let sequenceNumber = randomBytes(2).readUInt16BE();
    let timestamp = randomBytes(4).readUInt32BE();
    const playbackStartedAt = Date.now();
    for (let offset = 0; offset < audio.length; offset += FRAME_BYTES) {
      if (stopped) throw new CallStopped(stopped);
      if (Date.now() >= input.deadline.getTime()) throw new CallStopped('cancelled');
      if (!mediaConnected()) throw new VertoTransportError();
      const payload = Buffer.alloc(FRAME_BYTES, 0xff);
      audio.copy(payload, 0, offset, Math.min(audio.length, offset + FRAME_BYTES));
      const packet = new RtpPacket(new RtpHeader({
        payloadType: 0, marker: offset === 0, sequenceNumber, timestamp, ssrc: sender.ssrc,
      }), payload);
      await bounded(sender.sendRtp(packet), 1_000);
      if (!mediaConnected()) throw new VertoTransportError();
      sequenceNumber = (sequenceNumber + 1) & 0xffff;
      timestamp = (timestamp + FRAME_BYTES) >>> 0;
      const nextFrameAt = playbackStartedAt + (Math.floor(offset / FRAME_BYTES) + 1) * FRAME_MILLISECONDS;
      await bounded(delay(Math.max(0, nextFrameAt - Date.now())), 1_000);
    }
    await check();
    result = { outcome: 'played', callStarted, callId };
  } catch (error) {
    result = {
      outcome: error instanceof CallStopped ? error.outcome : stopped ?? 'failed',
      callStarted, callId: callStarted ? callId : null,
    };
  } finally {
    ending = true;
    lifecycle.abort();
    interrupt(result.outcome);
    input.signal?.removeEventListener('abort', aborted);
    unsubscribe.forEach((remove) => remove());
    unsubscribePeer.unSubscribe();
    if (rpc && callStarted && !receivedBye) {
      try {
        await rpc.request('verto.bye', {
          dialogParams: { callID: callId }, cause: result.outcome === 'played' ? 'NORMAL_CLEARING' : 'ORIGINATOR_CANCEL',
        }, 1_500);
      } catch {
        if (result.outcome === 'played' || result.outcome === 'unanswered') result.outcome = 'failed';
      }
    }
    await rpc?.close();
    track.stop();
    await peer.close();
    await monitor;
  }
  return result;
}
