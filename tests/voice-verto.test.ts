import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RTCPeerConnection, usePCMU as createPcmuCodec } from 'werift';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnlinePbxWebRtcCredentials } from '../server/services/onlinepbx';
import { decodeReminderAudio, normalizeLegacyVertoAudioAnswer, performVertoReminderCall, type VertoCallDependencies, type VertoReminderCallInput } from '../server/infrastructure/voice-telephony/verto-call';
import { VertoRpcClient } from '../server/infrastructure/voice-telephony/verto-rpc';

type Message = { id?: number | string; method?: string; params?: Record<string, any>; result?: unknown };
type InviteHandler = (socket: WebSocket, message: Message) => Promise<void> | void;
const cleanups: Array<() => Promise<void>> = [];

const localPeer = () => new RTCPeerConnection({
  codecs: { audio: [createPcmuCodec({ payloadType: 0, clockRate: 8_000, channels: 1 })], video: [] },
  iceServers: [], iceUseIpv4: false, iceUseIpv6: false, iceUseTcp: false,
  iceAdditionalHostAddresses: ['127.0.0.1'], iceInterfaceAddresses: { udp4: '127.0.0.1' },
});

async function fakeVerto(onInvite?: InviteHandler) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const messages: Message[] = [];
  const errors: unknown[] = [];
  server.on('connection', (socket) => {
    socket.on('error', () => undefined);
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Message;
      messages.push(message);
      if (!message.method) return;
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { method: message.method } }));
      if (message.method === 'verto.invite') {
        void Promise.resolve(onInvite?.(socket, message)).catch((error) => { errors.push(error); socket.terminate(); });
      }
    });
  });
  cleanups.push(async () => {
    server.clients.forEach((socket) => socket.terminate());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('No local WebSocket address');
  const credentials: OnlinePbxWebRtcCredentials = {
    extension: '100', username: 'test-user', password: 'test-password', sipDomain: 'pbx.test',
    websocketUrl: `ws://127.0.0.1:${address.port}`, aor: 'sip:test-user@pbx.test',
  };
  return { credentials, messages, errors, server };
}

const event = (socket: WebSocket, method: string, params: Record<string, unknown>, id: string) => {
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
};

const callInput = (overrides: Partial<VertoReminderCallInput> = {}): VertoReminderCallInput => ({
  jobId: 1, phone: '+998901234567', audioPath: '/test/reminder.wav',
  deadline: new Date(Date.now() + 60_000), shouldContinue: async () => true,
  ...overrides,
});
const dependencies = (audio = Buffer.alloc(640, 0xcd)): VertoCallDependencies => ({
  createPeer: localPeer, decodeAudio: async () => audio,
});

async function answeringPeer(socket: WebSocket, invite: Message) {
  const peer = localPeer();
  cleanups.push(() => peer.close());
  const packets: Buffer[] = [];
  const headers: Array<{ payloadType: number; timestamp: number; sequenceNumber: number }> = [];
  peer.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe((packet) => {
      packets.push(Buffer.from(packet.payload));
      headers.push({ ...packet.header });
    });
  });
  await peer.setRemoteDescription({ type: 'offer', sdp: invite.params!.sdp });
  for (const transport of peer.iceTransports) transport.connection.stunServer = undefined;
  await peer.setLocalDescription(await peer.createAnswer());
  return { peer, packets, headers, sdp: peer.localDescription!.sdp, callID: invite.params!.dialogParams.callID as string };
}

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});

describe('Verto reminder signalling and real Node WebRTC audio', () => {
  it('adds only the known audio MID and preserves remote security, ICE and direction attributes byte for byte', () => {
    const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:audio-main\r\na=sendonly\r\n';
    const legacy = 'v=0\r\na=group:BUNDLE audio-main\r\nm=audio 54321 UDP/TLS/RTP/SAVPF 0\r\n'
      + 'a=ice-ufrag:remote-ufrag\r\na=ice-pwd:remote-secret\r\na=fingerprint:sha-256 AA:BB:CC\r\n'
      + 'a=setup:active\r\na=recvonly\r\na=rtcp-mux\r\na=candidate:1 1 udp 123 127.0.0.1 54321 typ host\r\n';
    const normalized = normalizeLegacyVertoAudioAnswer(legacy, offer);
    expect(normalized).toContain('\r\nm=audio 54321 UDP/TLS/RTP/SAVPF 0\r\na=mid:audio-main\r\n');
    expect(normalized.replace('a=mid:audio-main\r\n', '')).toBe(legacy);
    expect(normalizeLegacyVertoAudioAnswer(normalized, offer)).toBe(normalized);
  });

  it.each([
    ['multiple remote m-lines', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:0\r\n'],
    ['multiple offered m-lines', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\n'],
    ['missing offered MID', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n'],
    ['mismatched remote MID', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:1\r\n', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:0\r\n'],
    ['mismatched bundle MID', 'a=group:BUNDLE 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:0\r\n'],
    ['multiple offered MIDs', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n', 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:0\r\na=mid:1\r\n'],
  ])('rejects %s rather than guessing a media mapping', (_case, remote, offer) => {
    expect(() => normalizeLegacyVertoAudioAnswer(remote, offer)).toThrow();
  });

  it('plays all PCMU RTP bytes only after the final answer and ignores unrelated incoming forks', async () => {
    const expectedAudio = Buffer.from(Array.from({ length: 640 }, (_, index) => index & 0xff));
    const robot = localPeer();
    let received!: Awaited<ReturnType<typeof answeringPeer>>;
    let earlyPacketCount = -1;
    const harness = await fakeVerto(async (socket, invite) => {
      received = await answeringPeer(socket, invite);
      event(socket, 'verto.invite', { callID: 'manager-incoming-fork', sdp: received.sdp }, 'incoming-event');
      event(socket, 'verto.media', { callID: received.callID, sdp: received.sdp }, 'early-event');
      await vi.waitFor(() => expect(robot.signalingState).toBe('have-remote-pranswer'), { timeout: 5_000 });
      await delay(100);
      earlyPacketCount = received.packets.length;
      event(socket, 'verto.bye', { callID: 'manager-incoming-fork', cause: 'NORMAL_CLEARING' }, 'other-bye-event');
      // Verto may omit SDP from its final answer after supplying early media.
      event(socket, 'verto.answer', { callID: received.callID }, 'answer-event');
    });
    const onStarted = vi.fn(async () => undefined);
    const result = await performVertoReminderCall(harness.credentials, callInput({ onStarted }), {
      ...dependencies(expectedAudio), createPeer: () => robot,
    });
    expect(harness.errors).toEqual([]);
    expect(result.outcome).toBe('played');
    expect(result.callStarted).toBe(true);
    expect(onStarted).toHaveBeenCalledOnce();
    expect(earlyPacketCount).toBe(0);
    expect(Buffer.concat(received.packets)).toEqual(expectedAudio);
    expect(received.packets.map((packet) => packet.length)).toEqual([160, 160, 160, 160]);
    expect(received.headers.every((header) => header.payloadType === 0)).toBe(true);
    expect((received.headers[1].timestamp - received.headers[0].timestamp) >>> 0).toBe(160);
    expect((received.headers[1].sequenceNumber - received.headers[0].sequenceNumber) & 0xffff).toBe(1);
    expect(harness.messages.filter((message) => message.method === 'verto.bye')).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ dialogParams: { callID: result.callId }, cause: 'NORMAL_CLEARING' }) }),
    ]);
    expect(harness.messages.some((message) => message.method === 'verto.answer')).toBe(false);
    for (const id of ['incoming-event', 'other-bye-event', 'early-event', 'answer-event']) {
      expect(harness.messages.some((message) => message.id === id && message.result)).toBe(true);
    }
    await vi.waitFor(() => expect(harness.server.clients.size).toBe(0));
  }, 15_000);

  it('uses unique robot sessions and sends credentials only in login', async () => {
    const harness = await fakeVerto();
    const first = new VertoRpcClient(harness.credentials.websocketUrl);
    const second = new VertoRpcClient(harness.credentials.websocketUrl);
    try {
      await Promise.all([first.login(harness.credentials), second.login(harness.credentials)]);
      expect(first.sessionId).not.toBe(second.sessionId);
      expect(first.sessionId).toMatch(/^[a-f0-9-]{36}$/);
      const logins = harness.messages.filter((message) => message.method === 'login');
      expect(logins.map((message) => message.params?.sessid)).toEqual(expect.arrayContaining([first.sessionId, second.sessionId]));
      expect(logins.every((message) => message.params?.login === 'test-user@pbx.test')).toBe(true);
      await first.request('verto.bye', { dialogParams: { callID: 'test-call' } });
      const bye = harness.messages.find((message) => message.method === 'verto.bye')!;
      expect(JSON.stringify(bye)).not.toContain('test-password');
      expect(harness.messages.some((message) => ['echo', 'fsapi', 'jsapi'].includes(message.method ?? ''))).toBe(false);
    } finally { await Promise.all([first.close(), second.close()]); }
  });

  it('plays real RTP through a legacy MID-less provisional answer followed by an answer without SDP', async () => {
    const expectedAudio = Buffer.from(Array.from({ length: 640 }, (_, index) => (index * 7) & 0xff));
    const robot = localPeer();
    let received!: Awaited<ReturnType<typeof answeringPeer>>;
    let earlyPacketCount = -1;
    const harness = await fakeVerto(async (socket, invite) => {
      received = await answeringPeer(socket, invite);
      const legacySdp = received.sdp.replace(/^a=mid:[^\r\n]*(?:\r\n|\n|\r)/gm, '');
      expect(legacySdp).not.toMatch(/^a=mid:/m);
      event(socket, 'verto.media', { callID: received.callID, sdp: legacySdp }, 'legacy-early');
      await vi.waitFor(() => expect(robot.signalingState).toBe('have-remote-pranswer'), { timeout: 5_000 });
      await delay(80);
      earlyPacketCount = received.packets.length;
      event(socket, 'verto.answer', { callID: received.callID }, 'legacy-final');
    });
    const result = await performVertoReminderCall(harness.credentials, callInput(), {
      ...dependencies(expectedAudio), createPeer: () => robot, mediaTimeoutMs: 2_000,
    });
    expect(harness.errors).toEqual([]);
    expect(result).toMatchObject({ outcome: 'played', callStarted: true });
    expect(earlyPacketCount).toBe(0);
    expect(Buffer.concat(received.packets)).toEqual(expectedAudio);
    expect(received.headers.every((header) => header.payloadType === 0)).toBe(true);
    expect(harness.messages.some((message) => message.id === 'legacy-early' && message.result)).toBe(true);
    expect(harness.messages.some((message) => message.id === 'legacy-final' && message.result)).toBe(true);
  }, 15_000);

  it.each(['USER_BUSY', 'NO_ANSWER', 'NO_USER_RESPONSE', 'CALL_REJECTED'])('counts a client %s as an unanswered attempt', async (cause) => {
    const harness = await fakeVerto((socket, invite) => {
      event(socket, 'verto.bye', { callID: invite.params!.dialogParams.callID, cause }, 'client-bye');
    });
    const result = await performVertoReminderCall(harness.credentials, callInput(), dependencies());
    expect(result.outcome).toBe('unanswered');
    expect(result.callStarted).toBe(true);
    expect(harness.messages.filter((message) => message.method === 'verto.invite')).toHaveLength(1);
  });

  it('hangs up its own call on cancellation while ringing', async () => {
    const harness = await fakeVerto();
    const abort = new AbortController();
    const calling = performVertoReminderCall(harness.credentials, callInput({ signal: abort.signal }), dependencies());
    await vi.waitFor(() => expect(harness.messages.some((message) => message.method === 'verto.invite')).toBe(true));
    abort.abort();
    const result = await calling;
    expect(result).toMatchObject({ outcome: 'cancelled', callStarted: true });
    expect(harness.messages.find((message) => message.method === 'verto.bye')?.params?.dialogParams.callID).toBe(result.callId);
  });

  it('fails conservatively when signalling disconnects after sending the invite', async () => {
    const harness = await fakeVerto((socket) => socket.terminate());
    const result = await performVertoReminderCall(harness.credentials, callInput(), dependencies());
    expect(result).toMatchObject({ outcome: 'failed', callStarted: true });
    expect(harness.messages.filter((message) => message.method === 'verto.invite')).toHaveLength(1);
  });

  it('times out unanswered ringing and sends a hangup before closing', async () => {
    const harness = await fakeVerto();
    const result = await performVertoReminderCall(harness.credentials, callInput(), {
      ...dependencies(), ringTimeoutMs: 80,
    });
    expect(result).toMatchObject({ outcome: 'unanswered', callStarted: true });
    expect(harness.messages.some((message) => message.method === 'verto.bye')).toBe(true);
    await vi.waitFor(() => expect(harness.server.clients.size).toBe(0));
  });

  it('stops playback after the reminder is cancelled rather than reporting it played', async () => {
    let allowed = true;
    let received!: Awaited<ReturnType<typeof answeringPeer>>;
    const harness = await fakeVerto(async (socket, invite) => {
      received = await answeringPeer(socket, invite);
      event(socket, 'verto.answer', { callID: received.callID, sdp: received.sdp }, 'answer');
    });
    const calling = performVertoReminderCall(harness.credentials, callInput({ shouldContinue: async () => allowed }), dependencies(Buffer.alloc(8_000, 0x80)));
    await vi.waitFor(() => expect(received?.packets.length).toBeGreaterThan(0), { timeout: 5_000 });
    allowed = false;
    const result = await calling;
    expect(result).toMatchObject({ outcome: 'cancelled', callStarted: true });
    expect(Buffer.concat(received.packets).length).toBeLessThan(8_000);
  }, 15_000);

  it('does not report playback success when awaited RTP sending rejects', async () => {
    const harness = await fakeVerto(async (socket, invite) => {
      const remote = await answeringPeer(socket, invite);
      event(socket, 'verto.answer', { callID: remote.callID, sdp: remote.sdp }, 'answer');
    });
    const peer = localPeer();
    const addTransceiver = peer.addTransceiver.bind(peer);
    vi.spyOn(peer, 'addTransceiver').mockImplementation((...args) => {
      const transceiver = addTransceiver(...args);
      vi.spyOn(transceiver.sender, 'sendRtp').mockRejectedValue(new Error('Synthetic send failure'));
      return transceiver;
    });
    const result = await performVertoReminderCall(harness.credentials, callInput(), {
      ...dependencies(), createPeer: () => peer,
    });
    expect(result).toMatchObject({ outcome: 'failed', callStarted: true });
    expect(harness.messages.some((message) => message.method === 'verto.bye')).toBe(true);
  }, 15_000);

  it('does not open a socket when the reminder is already invalid', async () => {
    const harness = await fakeVerto();
    const createSocket = vi.fn((url: string) => new WebSocket(url));
    const decodeAudio = vi.fn(async () => Buffer.alloc(160));
    const result = await performVertoReminderCall(harness.credentials, callInput({ shouldContinue: async () => false }), {
      createSocket, decodeAudio, createPeer: localPeer,
    });
    expect(result).toEqual({ outcome: 'cancelled', callStarted: false, callId: null });
    expect(createSocket).not.toHaveBeenCalled();
    expect(decodeAudio).not.toHaveBeenCalled();
  });

  it('decodes a local WAV into the expected bounded PCMU sample count with ffmpeg', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-verto-'));
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
    const sampleCount = 320;
    const wav = Buffer.alloc(44 + sampleCount * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(16_000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
    wav.writeUInt32LE(sampleCount * 2, 40);
    const filePath = path.join(directory, 'recording.wav');
    await fs.writeFile(filePath, wav);
    const decoded = await decodeReminderAudio(filePath, new AbortController().signal);
    expect(decoded).toEqual(Buffer.alloc(sampleCount, 0xff));
    await expect(decodeReminderAudio('https://example.invalid/a.wav', new AbortController().signal)).rejects.toThrow();
  });
});
