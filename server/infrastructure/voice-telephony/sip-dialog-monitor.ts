import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { isIP } from 'node:net';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { OnlinePbxWebRtcCredentials } from '../../services/onlinepbx';

export type ExtensionDialogState = 'idle' | 'busy' | 'unknown';
type SipMessage = { start: string; headers: Map<string, string>; body: string };
export type ExtensionDialogSnapshot = { state: ExtensionDialogState; activeDialogs: number };
const unknownSnapshot = (): ExtensionDialogSnapshot => ({ state: 'unknown', activeDialogs: 0 });
const aliases: Record<string, string> = {
  v: 'via', f: 'from', t: 'to', i: 'call-id', m: 'contact',
  c: 'content-type', l: 'content-length', o: 'event',
};

export const parseSipMessage = (packet: Buffer): SipMessage | null => {
  if (packet.length > 64 * 1024) return null;
  const boundary = packet.indexOf('\r\n\r\n');
  if (boundary < 0) return null;
  const [start, ...lines] = packet.subarray(0, boundary).toString('utf8').split('\r\n');
  const headers = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 1) return null;
    const name = line.slice(0, separator).toLowerCase().trim();
    headers.set(aliases[name] ?? name, line.slice(separator + 1).trim());
  }
  const length = Number(headers.get('content-length'));
  if (!Number.isInteger(length) || length < 0 || length !== packet.length - boundary - 4) return null;
  return { start, headers, body: packet.subarray(boundary + 4).toString('utf8') };
};

/** Only a complete, correctly scoped NOTIFY can declare an extension idle. */
export const parseDialogDetails = (body: string, entity: string): ExtensionDialogSnapshot => {
  try {
  if (body.length > 32 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) return unknownSnapshot();
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, ignoreDeclaration: true });
  const document = parser.parse(body) as Record<string, unknown>;
  const names = Object.keys(document).filter(name => !name.startsWith('?'));
  if (names.length !== 1 || names[0].split(':').at(-1) !== 'dialog-info') return unknownSnapshot();
  const root = document[names[0]] as Record<string, unknown>;
  if (!root || typeof root !== 'object' || root['@_state'] !== 'full'
    || String(root['@_entity']).toLowerCase() !== entity.toLowerCase()
    || !/^\d+$/.test(String(root['@_version']))) return unknownSnapshot();
  const prefix = names[0].includes(':') ? names[0].split(':')[0] : '';
  if (root[prefix ? `@_xmlns:${prefix}` : '@_xmlns'] !== 'urn:ietf:params:xml:ns:dialog-info') return unknownSnapshot();
  const dialogName = prefix ? `${prefix}:dialog` : 'dialog';
  const children = Object.keys(root).filter(name => !name.startsWith('@_') && name !== '#text');
  if (children.some(name => name !== dialogName) || (root['#text'] && String(root['#text']).trim())) return unknownSnapshot();
  const rawDialogs = root[dialogName];
  const dialogs = rawDialogs === undefined ? [] : Array.isArray(rawDialogs) ? rawDialogs : [rawDialogs];
  let activeDialogs = 0;
  for (const raw of dialogs) {
    if (!raw || typeof raw !== 'object') return unknownSnapshot();
    const dialog = raw as Record<string, unknown>;
    if (!dialog['@_id'] || dialog['@_xmlns'] || dialog[`@_xmlns:${prefix}`]) return unknownSnapshot();
    const state = dialog[prefix ? `${prefix}:state` : 'state'];
    if (state && typeof state === 'object' && Object.keys(state).some(name => name.startsWith('@_xmlns'))) return unknownSnapshot();
    const value = typeof state === 'object' && state ? (state as Record<string, unknown>)['#text'] : state;
    if (!['trying', 'proceeding', 'early', 'confirmed', 'terminated'].includes(String(value))) return unknownSnapshot();
    if (value !== 'terminated') activeDialogs += 1;
  }
  return { state: activeDialogs ? 'busy' : 'idle', activeDialogs };
  } catch { return unknownSnapshot(); }
};

export const parseDialogSnapshot = (body: string, entity: string): ExtensionDialogState => parseDialogDetails(body, entity).state;

const digestAuthorization = (
  challenge: string, credentials: OnlinePbxWebRtcCredentials, uri: string, proxy: boolean,
): string | null => {
  const values = Object.fromEntries([...challenge.matchAll(/([\w-]+)=(?:"([^"]*)"|([^,\s]+))/g)]
    .map(match => [match[1].toLowerCase(), match[2] || match[3]]));
  if (!values.realm || !values.nonce || (values.algorithm ?? 'MD5').toUpperCase() !== 'MD5') return null;
  const qop = values.qop?.split(',').map(value => value.trim()).includes('auth') ? 'auth' : null;
  if (values.qop && !qop) return null;
  const md5 = (value: string) => crypto.createHash('md5').update(value).digest('hex');
  const first = md5(`${credentials.username}:${values.realm}:${credentials.password}`);
  const second = md5(`SUBSCRIBE:${uri}`);
  const cnonce = crypto.randomBytes(16).toString('hex');
  const response = md5(`${first}:${values.nonce}:${qop ? `00000001:${cnonce}:auth:` : ''}${second}`);
  const fields = [
    `username="${credentials.username}"`, `realm="${values.realm}"`, `nonce="${values.nonce}"`,
    `uri="${uri}"`, `response="${response}"`, 'algorithm=MD5',
    ...(qop ? ['qop=auth', 'nc=00000001', `cnonce="${cnonce}"`] : []),
    ...(values.opaque ? [`opaque="${values.opaque}"`] : []),
  ];
  return `${proxy ? 'Proxy-Authorization' : 'Authorization'}: Digest ${fields.join(', ')}`;
};

export type SipDialogMonitorOptions = { contactAddress?: string; timeoutMs?: number };

/**
 * SUBSCRIBE is deliberately separate from REGISTER: observing BLF must never
 * replace a manager's phone registration or change inbound routing.
 */
export class SipDialogMonitor {
  constructor(private readonly options: SipDialogMonitorOptions = {}) {}

  snapshot(credentials: OnlinePbxWebRtcCredentials): Promise<ExtensionDialogState> {
    return this.details(credentials).then(value => value.state);
  }

  details(credentials: OnlinePbxWebRtcCredentials): Promise<ExtensionDialogSnapshot> {
    if (!/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(credentials.sipDomain)
      || !/^\d{2,10}$/.test(credentials.extension) || !/^[a-z\d_.-]+$/i.test(credentials.username)) return Promise.resolve(unknownSnapshot());
    const socket = dgram.createSocket('udp4');
    const uri = `sip:${credentials.extension}@${credentials.sipDomain}`;
    const callId = crypto.randomUUID();
    const tag = crypto.randomBytes(12).toString('hex');
    let sequence = 1;
    let authorization: string | null = null;
    let remoteTo = `<${uri}>`;
    let subscribed = false;
    let finished = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastRequest: Buffer | undefined;

    return new Promise(resolve => {
      const timeout = setTimeout(() => finish(unknownSnapshot()), this.options.timeoutMs ?? 4_000);
      const request = (expires: number) => {
        const address = socket.address();
        const configured = this.options.contactAddress;
        const contact = configured && isIP(configured) === 4 ? configured : address.address;
        const headers = [
          `SUBSCRIBE ${uri} SIP/2.0`,
          `Via: SIP/2.0/UDP ${contact}:${address.port};rport;branch=z9hG4bK${crypto.randomUUID().replace(/-/g, '')}`,
          'Max-Forwards: 70', `From: <${uri}>;tag=${tag}`, `To: ${remoteTo}`, `Call-ID: ${callId}`,
          `CSeq: ${sequence} SUBSCRIBE`, `Contact: <sip:${credentials.username}@${contact}:${address.port}>`,
          'Event: dialog', 'Accept: application/dialog-info+xml', `Expires: ${expires}`,
          ...(authorization ? [authorization] : []), 'Content-Length: 0', '', '',
        ];
        return Buffer.from(headers.join('\r\n'));
      };
      const finish = (state: ExtensionDialogSnapshot) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (retry) clearTimeout(retry);
        if (subscribed) {
          sequence += 1;
          try { socket.send(request(0), () => { try { socket.close(); } catch { /* Already closed after a socket error. */ } }); }
          catch { try { socket.close(); } catch { /* No connected socket. */ } }
        } else { try { socket.close(); } catch { /* A failed DNS lookup may not bind a socket. */ } }
        resolve(state);
      };
      socket.on('error', () => finish(unknownSnapshot()));
      socket.on('message', packet => {
        if (finished) return;
        const message = parseSipMessage(packet);
        if (!message || message.headers.get('call-id') !== callId) return;
        if (message.start.startsWith('SIP/2.0 ')) {
          const status = Number(message.start.split(' ')[1]);
          if ([200, 202].includes(status)) {
            subscribed = true;
            remoteTo = message.headers.get('to') ?? remoteTo;
          } else if ([401, 407].includes(status) && sequence < 3) {
            const challenge = message.headers.get(status === 407 ? 'proxy-authenticate' : 'www-authenticate');
            authorization = challenge ? digestAuthorization(challenge, credentials, uri, status === 407) : null;
            if (!authorization) { finish(unknownSnapshot()); return; }
            sequence += 1;
            lastRequest = request(10);
            socket.send(lastRequest);
          } else if (status >= 300) finish(unknownSnapshot());
          return;
        }
        if (!message.start.startsWith('NOTIFY ') || message.headers.get('event') !== 'dialog') return;
        const required = ['via', 'from', 'to', 'call-id', 'cseq'];
        if (required.some(name => !message.headers.has(name))) { finish(unknownSnapshot()); return; }
        subscribed = true;
        remoteTo = message.headers.get('from') ?? remoteTo;
        socket.send(Buffer.from([
          'SIP/2.0 200 OK', ...required.map(name => `${name}: ${message.headers.get(name)}`),
          'Content-Length: 0', '', '',
        ].join('\r\n')));
        if (message.headers.get('content-type')?.split(';')[0] !== 'application/dialog-info+xml'
          || !/^\d+ NOTIFY$/.test(message.headers.get('cseq') ?? '')
          || !message.headers.get('to')?.includes(`;tag=${tag}`)
          || !/^active(?:;|$)/.test(message.headers.get('subscription-state') ?? '')) {
          finish(unknownSnapshot()); return;
        }
        finish(parseDialogDetails(message.body, uri));
      });
      socket.connect(5060, credentials.sipDomain, (error?: Error) => {
        if (finished) return;
        if (error) { finish(unknownSnapshot()); return; }
        lastRequest = request(10);
        socket.send(lastRequest);
        retry = setTimeout(() => { if (!finished && lastRequest) socket.send(lastRequest); }, 700);
      });
    });
  }
}
