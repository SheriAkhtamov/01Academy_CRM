import { createServer, type Server } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClamAvScanner } from '../server/modules/portal-resources/infrastructure/clamav-scanner';
import { LocalResourceFileStore, createResourceTokenCodec } from '../server/modules/portal-resources/infrastructure/file-store';
let directory: string, store: LocalResourceFileStore;
const servers: Server[] = [];
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(),'lms-files-test-')); store = new LocalResourceFileStore(path.join(directory,'files'),directory); });
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory,{recursive:true,force:true}); });
const write = async (body: Buffer | string) => { const filename = path.join(directory,'upload'); await fs.writeFile(filename,body); return filename; };
const zip = (name: string, encrypted = false, body?: Buffer, declaredExpanded?: number) => {
  const value = Buffer.from(name), header = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  const compressed=body ? deflateRawSync(body):Buffer.alloc(0),expanded=declaredExpanded ?? body?.length ?? 0;
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4);header.writeUInt16LE(encrypted ? 1 : 0,6);header.writeUInt16LE(body ? 8 : 0,8);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(expanded,22);header.writeUInt16LE(value.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(encrypted ? 1 : 0,8);central.writeUInt16LE(body ? 8 : 0,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(expanded,24);central.writeUInt16LE(value.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+value.length,12); end.writeUInt32LE(header.length+value.length+compressed.length,16);
  return Buffer.concat([header,value,compressed,central,value,end]);
};
async function scanner(reply: string | null, receive?: (body: Buffer) => void) {
  const server = createServer(socket => { let value = Buffer.alloc(0); socket.on('data',chunk => { value = Buffer.concat([value,chunk]); if (value.length < 10) return;
    let cursor = 10; const chunks: Buffer[] = []; while (cursor + 4 <= value.length) { const length = value.readUInt32BE(cursor); cursor += 4; if (!length) { receive?.(Buffer.concat(chunks)); if (reply !== null) socket.end(reply); else socket.destroy(); return; } if (cursor + length > value.length) return; chunks.push(value.subarray(cursor,cursor+length)); cursor += length; }
  }); }); servers.push(server); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No scanner address'); return new ClamAvScanner({host:'127.0.0.1',port:address.port,timeoutMs:1000});
}
describe('Learning file content and quarantine safeguards', () => {
  it('rejects executable content and fake image signatures regardless of the filename', async () => {
    await expect(store.inspect(await write('MZ executable'),'homework.py')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
    await expect(store.inspect(await write('<svg onload="alert(1)"/>'),'image.png')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
    await expect(store.inspect(await write('<html>hello</html>'),'page.html')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
    await expect(store.inspect(await write('safe'),'../work.txt')).rejects.toMatchObject({code:'portalFileNameInvalid'});
  });
  it('accepts source code as text and confirms the actual byte size and hash', async () => {
    const value = await store.inspect(await write('print("hello")'),'work.py'); expect(value).toMatchObject({mime:'text/plain',size:14}); expect(value.sha256).toMatch(/^[a-f0-9]{64}$/);
    const token = createResourceTokenCodec('test-fixture-secret').random(); await store.commit(path.join(directory,'upload'),token); expect((await fs.stat(store.location(token))).mode & 0o777).toBe(0o600);
    expect(() => store.location('../escape')).toThrow();
  });
  it('rejects macro, encrypted and traversal archives without extracting or executing their content', async () => {
    for (const [name,encrypted] of [['word/vbaProject.bin',false],['../escape.py',false],['work.txt',true]] as const) await expect(store.inspect(await write(zip(name,encrypted)),'archive.zip')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
    expect(await store.inspect(await write(zip('folder/work.py')),'archive.zip')).toMatchObject({mime:'application/zip'});
  });
  it('bounds expanded archive content and rejects forged size declarations before treating it as a safe upload', async () => {
    expect(await store.inspect(await write(zip('work.txt',false,Buffer.from('Hello learning archive'))),'work.zip')).toMatchObject({mime:'application/zip'});
    await expect(store.inspect(await write(zip('oversize.txt',false,Buffer.from('small'),101*1024*1024)),'work.zip')).rejects.toMatchObject({code:'portalArchiveTooLarge'});
    await expect(store.inspect(await write(zip('bomb.txt',false,Buffer.alloc(1024*1024))),'work.zip')).rejects.toMatchObject({code:'portalArchiveTooLarge'});
    await expect(store.inspect(await write(zip('forged.txt',false,Buffer.from('Content is longer than declared'),2)),'work.zip')).rejects.toMatchObject({code:'portalArchiveTooLarge'});
  });
  it('streams bytes to the scanner and only accepts its explicit clean result', async () => {
    const filename = await write('safe text'); let body: Buffer | null = null; const clean = await scanner('stream: OK\0',value => { body = value; }); expect(await clean.scan(filename)).toBe('ready'); expect(body!.toString()).toBe('safe text');
    expect(await (await scanner('stream: Eicar-Test-Signature FOUND\0')).scan(filename)).toBe('rejected');
  });
  it('treats an incomplete or error scanner reply as failure rather than safe content', async () => {
    const filename = await write('safe text'); await expect((await scanner('stream: ERROR\0')).scan(filename)).rejects.toThrow(); await expect((await scanner(null)).scan(filename)).rejects.toThrow();
  });
  it('requires a valid authentication tag when reopening an encrypted public token', () => {
    const codec = createResourceTokenCodec('fixture-secret'), token = codec.random(), envelope = codec.seal(token); expect(codec.open(envelope)).toBe(token); expect(codec.hash(token)).toMatch(/^[a-f0-9]{64}$/);
    const altered = Buffer.from(envelope,'base64url'); altered[altered.length-1] ^= 1; expect(() => codec.open(altered.toString('base64url'))).toThrow(); expect(() => createResourceTokenCodec('different-secret').open(envelope)).toThrow();
  });
});
