import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters, RtpHeader, RtpPacket, usePCMU as createPcmuCodec } from 'werift';
import type WebSocket from 'ws';
import { VOICE_REMINDER_MAX_AUDIO_SECONDS, VOICE_REMINDER_CONFIRMATION_WAIT_SECONDS, type VoiceReminderResponse } from '@shared/contracts/voice-reminders';
import type { VoiceReminderCallOutcome, VoiceReminderCallResult, VoiceReminderLine } from '../../modules/voice-reminders/application/ports';
import type { OnlinePbxWebRtcCredentials } from '../../services/onlinepbx';
import { VertoRpcClient, VertoTransportError, type VertoEvent, type VertoRpcDiagnostic } from './verto-rpc';
import { DtmfReceiver, type DtmfSignalSource } from './dtmf-receiver';

const execute = promisify(execFile);
const SAMPLE_RATE = 8_000;
const FRAME_BYTES = 160;
const FRAME_MILLISECONDS = 20;
const MAX_AUDIO_BYTES = VOICE_REMINDER_MAX_AUDIO_SECONDS * SAMPLE_RATE;

type WithoutConfirmation<Value> = Value extends unknown ? Omit<Value, 'confirmation'> : never;
export type VertoCallPhase = 'preflight' | 'audio_decode' | 'login' | 'offer' | 'authorize' | 'invite'
  | 'ringing' | 'media_connect' | 'playback' | 'confirmation' | 'acknowledgement' | 'hangup';
export type VertoCallDiagnostic = {
  event: 'phase' | 'peer_state' | 'early_media' | 'answer' | 'remote_description_failed' | 'remote_end'
    | 'session_replaced' | 'timeout' | 'failed' | 'finished' | 'response_listening' | 'dtmf' | 'response_save' | VertoRpcDiagnostic['event'];
  phase: VertoCallPhase;
  elapsedMs: number;
  callStarted: boolean;
  answered: boolean;
  finalAnswerReceived: boolean;
  peerState: string;
  iceState: string;
  dtlsState: string | null;
  cause?: string;
  method?: VertoRpcDiagnostic['method'];
  code?: number;
  outcome?: VoiceReminderCallOutcome;
  terminationConfirmed?: boolean;
  source?: DtmfSignalSource | 'verto_info';
  digit?: '1' | '2' | 'other';
  disposition?: 'accepted' | 'before_answer' | 'already_selected' | 'closed' | 'unsupported';
  saveStatus?: 'started' | 'saved' | 'rejected' | 'failed' | 'timeout';
};
export type VertoReminderCallInput = WithoutConfirmation<Parameters<VoiceReminderLine['call']>[0]> & {
  confirmation?: {
    yesAudioPath: string;
    noAudioPath: string;
    promptDurationSeconds: number;
    onResponse: (response: VoiceReminderResponse, callId: string) => Promise<boolean>;
  };
  callId?: string;
  onStarted?: () => Promise<void>;
  signal?: AbortSignal;
  onDiagnostic?: (event: VertoCallDiagnostic) => void;
};
export type VertoCallDependencies = {
  createSocket?: (url: string) => WebSocket;
  createPeer?: () => RTCPeerConnection;
  decodeAudio?: (filePath: string, signal: AbortSignal) => Promise<Buffer>;
  ringTimeoutMs?: number;
  mediaTimeoutMs?: number;
  confirmationWaitMs?: number;
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

const createAudioPeer = (receiveDigits: boolean) => new RTCPeerConnection({
  codecs: { audio: [createPcmuCodec({ payloadType: 0, clockRate: SAMPLE_RATE, channels: 1 }),
    ...(receiveDigits ? [new RTCRtpCodecParameters({ mimeType: 'audio/telephone-event', payloadType: 101, clockRate: SAMPLE_RATE, parameters: '0-16' })] : [])], video: [] },
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
  const peer = dependencies.createPeer ? dependencies.createPeer() : createAudioPeer(Boolean(input.confirmation));
  const track = new MediaStreamTrack({ kind: 'audio' });
  const sender = peer.addTransceiver(track, { direction: input.confirmation ? 'sendrecv' : 'sendonly' }).sender;
  // werift 0.25 falls back to a public STUN service even for iceServers: [].
  // This server calls the PBX directly; keep candidate gathering local and
  // leave the full ICE connectivity checks with the negotiated PBX enabled.
  for (const transport of peer.iceTransports) transport.connection.stunServer = undefined;
  let rpc: VertoRpcClient | undefined;
  let callStarted = false;
  let answered = false;
  let finalAnswerReceived = false;
  let remoteAudioApplied = false;
  let receivedBye = false;
  let acknowledgedBye = false;
  let ending = false;
  let stopped: VoiceReminderCallOutcome | null = null;
  let descriptions = Promise.resolve();
  let result: VoiceReminderCallResult = { outcome: 'failed', callStarted: false, callId: null };
  let monitor: Promise<void> | undefined;
  let pendingResponse: VoiceReminderResponse | undefined;
  let savedResponse: VoiceReminderResponse | undefined;
  let responseSave: Promise<void> | undefined;
  let saveFinished = false;
  let saveError: unknown;
  let fullPromptDelivered = false;
  let callDeadline = input.deadline.getTime();
  let acceptingResponse = false;
  const diagnosticStartedAt = Date.now();
  let phase: VertoCallPhase = 'preflight';
  const diagnose = (event: VertoCallDiagnostic['event'], details: Partial<Pick<VertoCallDiagnostic,
    'cause' | 'method' | 'code' | 'outcome' | 'terminationConfirmed' | 'source' | 'digit' | 'disposition' | 'saveStatus'>> = {}) => {
    try {
      input.onDiagnostic?.({ event, phase, elapsedMs: Date.now() - diagnosticStartedAt,
        callStarted, answered, finalAnswerReceived, peerState: peer.connectionState, iceState: peer.iceConnectionState,
        dtlsState: sender.transport?.state ?? null, ...details });
    } catch { /* Diagnostics must never change call delivery or termination. */ }
  };
  const enter = (next: VertoCallPhase) => { phase = next; diagnose('phase'); };
  const persistResponse = (response: VoiceReminderResponse) => {
    if (!input.confirmation) return;
    diagnose('response_save', { saveStatus: 'started' });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    // An accepted digit belongs to this exact call. Finish its bounded durable
    // write even if BYE arrives before playback/media setup can advance.
    responseSave = Promise.race([
      Promise.resolve().then(() => input.confirmation!.onResponse(response, callId)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new VertoTransportError());
        }, Math.max(1, Math.min(5_000, callDeadline - Date.now())));
      }),
    ]).then(stored => {
      if (stored) {
        savedResponse = response;
        diagnose('response_save', { saveStatus: 'saved' });
      } else {
        saveError = new VertoTransportError();
        diagnose('response_save', { saveStatus: 'rejected' });
      }
    }, error => {
      saveError = error;
      diagnose('response_save', { saveStatus: timedOut ? 'timeout' : 'failed' });
    }).finally(() => {
      saveFinished = true;
      if (timeout) clearTimeout(timeout);
    });
  };
  const collectDigit = (digit: string, source: DtmfSignalSource | 'verto_info') => {
    const disposition: VertoCallDiagnostic['disposition'] = !finalAnswerReceived ? 'before_answer'
      : pendingResponse ? 'already_selected' : !acceptingResponse || stopped || ending ? 'closed'
        : digit !== '1' && digit !== '2' ? 'unsupported' : 'accepted';
    diagnose('dtmf', { source, digit: digit === '1' || digit === '2' ? digit : 'other', disposition });
    if (disposition !== 'accepted') return;
    pendingResponse = digit === '1' ? 'yes' : 'no';
    acceptingResponse = false;
    digits.disarm();
    persistResponse(pendingResponse);
  };
  const digits = new DtmfReceiver(collectDigit);
  const unsubscribe: Array<() => void> = [];
  if (input.confirmation) {
    for (const transport of peer.dtlsTransports) {
      const subscription = transport.onRtp.subscribe(packet => { if (finalAnswerReceived && !stopped && !ending) digits.receive(packet); });
      unsubscribe.push(() => subscription.unSubscribe());
    }
  }
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
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { diagnose('timeout'); reject(new VertoTransportError()); }, timeoutMs);
        }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  };
  const check = async () => {
    if (stopped) throw new CallStopped(stopped);
    const allowed = await bounded(input.shouldContinue(!callStarted).catch(() => false), 2_000).catch(() => false);
    if (stopped) throw new CallStopped(stopped);
    if (Date.now() >= callDeadline || input.signal?.aborted || !allowed) {
      stop('cancelled');
      throw new CallStopped('cancelled');
    }
  };
  const mediaConnected = () => peer.connectionState === 'connected'
    && sender.transport?.state === 'connected' && !sender.stopped && sender.codec?.payloadType === 0;
  const unsubscribePeer = peer.connectionStateChange.subscribe((state) => {
    diagnose('peer_state');
    if (state === 'failed' || state === 'disconnected' || state === 'closed') stop('failed');
  });

  try {
    diagnose('phase');
    if (!/^\+?[1-9]\d{7,14}$/.test(input.phone) || !Number.isFinite(input.deadline.getTime())) {
      throw new VertoTransportError();
    }
    await check();
    enter('audio_decode');
    const audio = await bounded((dependencies.decodeAudio ?? decodeReminderAudio)(input.audioPath, lifecycle.signal), 20_000);
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new VertoTransportError();
    const replyAudio = input.confirmation ? await bounded(Promise.all([
      (dependencies.decodeAudio ?? decodeReminderAudio)(input.confirmation.yesAudioPath, lifecycle.signal),
      (dependencies.decodeAudio ?? decodeReminderAudio)(input.confirmation.noAudioPath, lifecycle.signal),
    ]), 20_000) : undefined;
    if (input.confirmation && (!Number.isFinite(input.confirmation.promptDurationSeconds)
      || input.confirmation.promptDurationSeconds <= 0
      || input.confirmation.promptDurationSeconds * SAMPLE_RATE > audio.length + FRAME_BYTES
      || !replyAudio || replyAudio.some(reply => !reply.length || reply.length > MAX_AUDIO_BYTES)
      || audio.length + Math.max(...replyAudio.map(reply => reply.length))
        + VOICE_REMINDER_CONFIRMATION_WAIT_SECONDS * SAMPLE_RATE > MAX_AUDIO_BYTES)) throw new VertoTransportError();
    await check();
    rpc = new VertoRpcClient(credentials.websocketUrl, dependencies.createSocket, ({ event, ...details }) => diagnose(event, details));
    unsubscribe.push(rpc.onFailure(() => stop('failed')));
    unsubscribe.push(rpc.onEvent((event) => {
      if (event.method === 'verto.punt') { diagnose('session_replaced'); stop('failed'); return; }
      // A shared extension may also receive the managers' inbound fork. ACK is
      // handled by the RPC client; answering or rejecting that fork is forbidden.
      if (eventCallId(event) !== callId || stopped || ending) return;
      if (input.confirmation && event.method === 'verto.info' && typeof event.params.dtmf === 'string') {
        for (const digit of event.params.dtmf.slice(0, 16)) collectDigit(digit, 'verto_info');
        return;
      }
      if (event.method === 'verto.bye') {
        receivedBye = true;
        const cause = String(event.params.cause ?? '').toUpperCase();
        diagnose('remote_end', { cause: /^[A-Z0-9_]{1,64}$/.test(cause) ? cause : 'UNSPECIFIED' });
        const unanswered = ['NO_ANSWER', 'NO_USER_RESPONSE', 'USER_BUSY', 'CALL_REJECTED'].includes(cause);
        stop(!finalAnswerReceived && unanswered ? 'unanswered'
          : input.confirmation && fullPromptDelivered && !pendingResponse ? 'delivered_no_response' : 'failed');
        return;
      }
      if (event.method !== 'verto.media' && event.method !== 'verto.answer') return;
      const final = event.method === 'verto.answer';
      diagnose(final ? 'answer' : 'early_media');
      if (final && !finalAnswerReceived) {
        // Telephone answer opens keypad input. Media readiness still gates all
        // outgoing audio; a fast caller's answer need not wait for SDP or speech.
        finalAnswerReceived = true;
        if (input.confirmation) {
          acceptingResponse = true;
          digits.arm();
          diagnose('response_listening');
        }
      }
      descriptions = descriptions.then(async () => {
        if (stopped || ending || answered) return;
        if (!remoteAudioApplied) {
          const sdp = typeof event.params.sdp === 'string' ? event.params.sdp : undefined;
          const offerSdp = peer.localDescription?.sdp;
          if (!sdp || !offerSdp) throw new VertoTransportError();
          // Verto's early media supplies a complete WebRTC answer, as in the
          // browser SDK. Werift starts ICE/DTLS only for an answer. This does
          // not establish a telephone answer or permit prompt/DTMF playback.
          await peer.setRemoteDescription({
            type: 'answer',
            sdp: normalizeLegacyVertoAudioAnswer(sdp, offerSdp),
          });
          if (stopped || ending) return;
          if (input.confirmation) digits.negotiate(sdp);
          remoteAudioApplied = true;
        }
        if (final) answered = true;
      }).catch(() => { diagnose('remote_description_failed'); stop('failed'); });
    }));
    enter('login');
    await bounded(rpc.login(credentials), 16_000);
    enter('offer');
    await bounded(peer.setLocalDescription(await peer.createOffer()), 8_000);
    const sdp = peer.localDescription?.sdp;
    if (!sdp || peer.iceGatheringState !== 'complete') throw new VertoTransportError();
    await check();
    enter('authorize');
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
    enter('invite');
    await bounded(rpc.request('verto.invite', {
      sdp,
      dialogParams: {
        callID: callId, destination_number: input.phone.replace(/\D/g, ''),
        caller_id_name: credentials.extension, caller_id_number: credentials.extension,
        useVideo: false, useStereo: false,
      },
    }), 8_000);
    enter('ringing');
    const ringDeadline = startedAt + (dependencies.ringTimeoutMs ?? 45_000);
    while (!answered) {
      if (Date.now() >= ringDeadline) throw new CallStopped(finalAnswerReceived ? 'failed' : 'unanswered');
      await bounded(delay(20), 1_000);
    }
    enter('media_connect');
    const mediaDeadline = Date.now() + (dependencies.mediaTimeoutMs ?? 8_000);
    while (!mediaConnected()) {
      if (Date.now() >= mediaDeadline) throw new VertoTransportError();
      await bounded(delay(20), 1_000);
    }
    callDeadline = Math.min(callDeadline, Date.now() + VOICE_REMINDER_MAX_AUDIO_SECONDS * 1_000);
    await check();
    let sequenceNumber = randomBytes(2).readUInt16BE();
    let timestamp = randomBytes(4).readUInt32BE();
    let firstFrame = true;
    const sendFrame = async (payload: Buffer) => {
      if (stopped) throw new CallStopped(stopped);
      if (Date.now() >= callDeadline) throw new CallStopped('cancelled');
      if (!mediaConnected()) throw new VertoTransportError();
      const packet = new RtpPacket(new RtpHeader({
        payloadType: 0, marker: firstFrame, sequenceNumber, timestamp, ssrc: sender.ssrc,
      }), payload);
      await bounded(sender.sendRtp(packet), 1_000);
      if (!mediaConnected()) throw new VertoTransportError();
      sequenceNumber = (sequenceNumber + 1) & 0xffff;
      timestamp = (timestamp + FRAME_BYTES) >>> 0;
      firstFrame = false;
    };
    const play = async (samples: Buffer, main = false): Promise<boolean> => {
      const startedAt = Date.now();
      for (let offset = 0; offset < samples.length; offset += FRAME_BYTES) {
        if (main && pendingResponse) return false;
        const payload = Buffer.alloc(FRAME_BYTES, 0xff);
        samples.copy(payload, 0, offset, Math.min(samples.length, offset + FRAME_BYTES));
        await sendFrame(payload);
        const nextFrameAt = startedAt + (Math.floor(offset / FRAME_BYTES) + 1) * FRAME_MILLISECONDS;
        await bounded(delay(Math.max(0, nextFrameAt - Date.now())), 1_000);
      }
      return true;
    };
    enter('playback');
    fullPromptDelivered = await play(audio, true);
    if (input.confirmation && replyAudio) {
      enter('confirmation');
      const waitUntil = Date.now() + (dependencies.confirmationWaitMs ?? VOICE_REMINDER_CONFIRMATION_WAIT_SECONDS * 1_000);
      while (!pendingResponse && Date.now() < waitUntil) {
        const frameStartedAt = Date.now();
        await sendFrame(Buffer.alloc(FRAME_BYTES, 0xff));
        await bounded(delay(Math.max(0, FRAME_MILLISECONDS - (Date.now() - frameStartedAt))), 1_000);
      }
      acceptingResponse = false;
      digits.disarm();
      if (pendingResponse) {
        // Maintain the RTP clock while the durable response is committed. A
        // database pause must not make the acknowledgement arrive as late RTP.
        while (!saveFinished) {
          const frameStartedAt = Date.now();
          await sendFrame(Buffer.alloc(FRAME_BYTES, 0xff));
          await bounded(delay(Math.max(0, FRAME_MILLISECONDS - (Date.now() - frameStartedAt))), 1_000);
        }
        await responseSave;
        if (saveError) throw saveError;
        if (!savedResponse) throw new VertoTransportError();
        await check();
        enter('acknowledgement');
        await play(replyAudio[savedResponse === 'yes' ? 0 : 1]);
      }
    }
    await check();
    result = { outcome: input.confirmation && !pendingResponse ? 'delivered_no_response' : 'played',
      callStarted, callId, ...(savedResponse ? { response: savedResponse } : {}) };
  } catch (error) {
    await responseSave;
    const stoppedOutcome = error instanceof CallStopped ? error.outcome : stopped ?? 'failed';
    const outcome = savedResponse ? 'played' : pendingResponse && stoppedOutcome === 'unanswered' ? 'failed' : stoppedOutcome;
    if (outcome !== 'delivered_no_response' && outcome !== 'played') diagnose('failed', { outcome });
    result = {
      outcome,
      callStarted, callId: callStarted ? callId : null,
      ...(savedResponse ? { response: savedResponse } : {}),
    };
  } finally {
    ending = true;
    digits.disarm();
    lifecycle.abort();
    interrupt(result.outcome);
    input.signal?.removeEventListener('abort', aborted);
    unsubscribe.forEach((remove) => remove());
    unsubscribePeer.unSubscribe();
    if (rpc && callStarted && !receivedBye) {
      enter('hangup');
      try {
        await rpc.request('verto.bye', {
          dialogParams: { callID: callId },
          cause: result.outcome === 'played' || result.outcome === 'delivered_no_response' ? 'NORMAL_CLEARING' : 'ORIGINATOR_CANCEL',
        }, 1_500);
        acknowledgedBye = true;
      } catch {
        if (!savedResponse && ['played', 'unanswered', 'delivered_no_response'].includes(result.outcome)) result.outcome = 'failed';
      }
    }
    await rpc?.close();
    track.stop();
    await peer.close();
    await monitor;
  }
  if (callStarted) result.terminationConfirmed = receivedBye || acknowledgedBye;
  diagnose('finished', { outcome: result.outcome, terminationConfirmed: result.terminationConfirmed });
  return result;
}
