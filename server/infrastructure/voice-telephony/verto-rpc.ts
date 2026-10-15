import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { OnlinePbxWebRtcCredentials } from '../../services/onlinepbx';

export type VertoEvent = { method: string; params: Record<string, unknown> };
type VertoMethod = 'login' | 'verto.invite' | 'verto.bye';
export type VertoRpcDiagnostic = {
  event: 'rpc_error' | 'rpc_timeout' | 'socket_error' | 'socket_closed';
  method?: VertoMethod;
  code?: number;
};
type PendingRequest = {
  method: VertoMethod;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class VertoTransportError extends Error {
  constructor() { super('Voice call transport unavailable'); }
}

/** A robot owns a fresh Verto session and only acknowledges other call forks. */
export class VertoRpcClient {
  readonly sessionId = randomUUID();
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventListeners = new Set<(event: VertoEvent) => void>();
  private readonly failureListeners = new Set<() => void>();
  private nextId = 1;
  private closing = false;
  private failed = false;

  constructor(url: string, createSocket: (url: string) => WebSocket = (address) => new WebSocket(address, {
    handshakeTimeout: 8_000, maxPayload: 256 * 1024,
  }), private readonly onDiagnostic?: (event: VertoRpcDiagnostic) => void) {
    this.socket = createSocket(url);
    this.socket.on('message', (data) => this.receive(data.toString()));
    this.socket.on('error', () => { this.diagnose({ event: 'socket_error' }); this.fail(); });
    this.socket.on('close', (code) => { this.diagnose({ event: 'socket_closed', code }); this.fail(); });
  }

  private diagnose(event: VertoRpcDiagnostic): void {
    // Diagnostic failures cannot affect the call. Never include request
    // parameters, provider error messages, socket reasons or credentials.
    try { this.onDiagnostic?.(event); } catch { /* Observability only. */ }
  }

  onEvent(listener: (event: VertoEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onFailure(listener: () => void): () => void {
    this.failureListeners.add(listener);
    if (this.failed) listener();
    return () => this.failureListeners.delete(listener);
  }

  async login(credentials: OnlinePbxWebRtcCredentials): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { done(); reject(new VertoTransportError()); }, 8_000);
        const opened = () => { done(); resolve(); };
        const failed = () => { done(); reject(new VertoTransportError()); };
        const done = () => {
          clearTimeout(timeout);
          this.socket.off('open', opened);
          this.socket.off('error', failed);
          this.socket.off('close', failed);
        };
        this.socket.once('open', opened);
        this.socket.once('error', failed);
        this.socket.once('close', failed);
        if (this.failed || this.socket.readyState > WebSocket.OPEN) failed();
      });
    }
    await this.request('login', {
      login: `${credentials.username}@${credentials.sipDomain}`,
      passwd: credentials.password, loginParams: {}, userVariables: {},
    });
    // OnlinePBX's legacy gateway closes client-initiated control pings and
    // does not expose the newer verto.ping RPC. Answer server pings instead
    // (ws automatically answers native ones). Requests and the call/media
    // lifecycle remain bounded; a failed/closed socket still fails the call.
  }

  request(method: VertoMethod, params: Record<string, unknown>, timeoutMs = 8_000): Promise<unknown> {
    if (this.closing || this.failed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new VertoTransportError());
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.diagnose({ event: 'rpc_timeout', method });
        reject(new VertoTransportError());
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params: { ...params, sessid: this.sessionId }, id }), (error) => {
        if (error) this.fail();
      });
    });
  }

  private receive(text: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch { return; }
    if (message.jsonrpc !== '2.0') return;
    if (typeof message.method === 'string') {
      if (message.id !== undefined && this.socket.readyState === WebSocket.OPEN) {
        const result = message.method === 'verto.ping' ? { message: 'PONG' } : { method: message.method };
        this.socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      }
      const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
        ? message.params as Record<string, unknown> : {};
      for (const listener of this.eventListeners) listener({ method: message.method, params });
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error || !('result' in message)) {
      const error = message.error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      this.diagnose({ event: 'rpc_error', method: pending.method,
        ...(typeof code === 'number' && Number.isSafeInteger(code) ? { code } : {}) });
      pending.reject(new VertoTransportError());
    }
    else pending.resolve(message.result);
  }

  private fail(): void {
    if (this.closing || this.failed) return;
    this.failed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new VertoTransportError());
    }
    this.pending.clear();
    for (const listener of this.failureListeners) listener();
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new VertoTransportError());
    }
    this.pending.clear();
    this.eventListeners.clear();
    this.failureListeners.clear();
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => { this.socket.terminate(); done(); }, 1_000);
      this.socket.once('close', done);
      if (this.socket.readyState === WebSocket.CONNECTING) this.socket.terminate();
      else this.socket.close();
    });
  }
}
