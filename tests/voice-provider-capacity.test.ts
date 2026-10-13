import { describe, expect, it, vi } from 'vitest';
import { createPbxCapacityProvider } from '../server/infrastructure/voice-telephony/provider-capacity';
import type { OnlinePbxClient } from '../server/services/onlinepbx';
import { parseDialogDetails, parseSipMessage, SipDialogMonitor } from '../server/infrastructure/voice-telephony/sip-dialog-monitor';

const entity = 'sip:100@example.invalid';
const xml = (content = '', attributes = '') => `<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" state="full" entity="${entity}" version="1" ${attributes}>${content}</dialog-info>`;
const unknown = { state: 'unknown', activeDialogs: 0 };

describe('strict diagnostic SIP snapshots', () => {
  it('counts active dialogs and accepts a complete idle snapshot', () => {
    expect(parseDialogDetails(xml(), entity)).toEqual({ state: 'idle', activeDialogs: 0 });
    expect(parseDialogDetails(xml('<dialog id="a"><state>confirmed</state></dialog><dialog id="b"><state>early</state></dialog><dialog id="c"><state>terminated</state></dialog>'), entity))
      .toEqual({ state: 'busy', activeDialogs: 2 });
  });
  it.each([
    '<dialog-info', xml().replace('state="full"', 'state="partial"'),
    xml().replace('example.invalid', 'other.invalid'),
    xml().replace('urn:ietf:params:xml:ns:dialog-info', 'urn:foreign'),
    xml('<dialog id="a"><state xmlns="urn:foreign">terminated</state></dialog>'),
    xml('<dialog id="a"><state>unknown-value</state></dialog>'),
    xml('<dialog><state>terminated</state></dialog>'),
    '<!DOCTYPE dialog-info [<!ENTITY value "test">]>' + xml(),
    xml('<x>'.repeat(3500) + '</x>'.repeat(3500)),
  ])('treats malformed or incomplete provider data as unknown', body => {
    expect(parseDialogDetails(body, entity)).toEqual(unknown);
  });
  it('accepts compact SIP headers and rejects a mismatched body length', () => {
    const body = xml();
    const packet = Buffer.from(`NOTIFY sip:100@example.invalid SIP/2.0\r\ni: test\r\nc: application/dialog-info+xml\r\nl: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    expect(parseSipMessage(packet)?.headers.get('call-id')).toBe('test');
    expect(parseSipMessage(Buffer.concat([packet, Buffer.from('x')]))).toBeNull();
  });
  it('rejects invalid SIP destinations without opening a socket', async () => {
    expect(await new SipDialogMonitor().details({ extension: '100', username: '100', password: 'fixture', sipDomain: 'example.invalid:8082', websocketUrl: 'wss://example.invalid', aor: entity })).toEqual(unknown);
  });
});

describe('authoritative provider capacity admission', () => {
  const client = (configured = true) => ({
    isConfigured: () => configured, getWebRtcCredentials: vi.fn(async () => ({ extension: '100' })),
  }) as unknown as OnlinePbxClient;
  it('never infers idle from an absent global provider view', async () => {
    expect(await createPbxCapacityProvider(client()).snapshot()).toMatchObject({ known: false });
  });
  it('rejects an unconfigured provider and malformed occupancy', async () => {
    expect(await createPbxCapacityProvider(client(false), async () => ({ known: true, occupiedChannels: 0, busyExtensions: [] })).snapshot()).toMatchObject({ known: false });
    expect(await createPbxCapacityProvider(client(), async () => ({ known: true, occupiedChannels: -1, busyExtensions: [] })).snapshot()).toMatchObject({ known: false });
  });
  it('passes a verified global view and requests only the selected user credentials', async () => {
    const pbx = client();
    const provider = createPbxCapacityProvider(pbx, async () => ({ known: true, occupiedChannels: 1, busyExtensions: ['101'] }));
    expect(await provider.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['101'] });
    await provider.getCredentials('100');
    expect(pbx.getWebRtcCredentials).toHaveBeenCalledWith('100');
  });
});
