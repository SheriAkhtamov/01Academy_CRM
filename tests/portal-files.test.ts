import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalResourceFileStore, createResourceTokenCodec } from '../server/modules/portal-resources/infrastructure/file-store';
let directory: string, store: LocalResourceFileStore;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(),'lms-files-test-')); store = new LocalResourceFileStore(path.join(directory,'files'),directory); });
afterEach(async () => { await fs.rm(directory,{recursive:true,force:true}); });
const write = async (body: Buffer | string) => { const filename = path.join(directory,'upload'); await fs.writeFile(filename,body); return filename; };
const zip = (name: string, encrypted = false, body?: Buffer, declaredExpanded?: number) => {
  const value = Buffer.from(name), header = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  const compressed=body ? deflateRawSync(body):Buffer.alloc(0),expanded=declaredExpanded ?? body?.length ?? 0;
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4);header.writeUInt16LE(encrypted ? 1 : 0,6);header.writeUInt16LE(body ? 8 : 0,8);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(expanded,22);header.writeUInt16LE(value.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(encrypted ? 1 : 0,8);central.writeUInt16LE(body ? 8 : 0,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(expanded,24);central.writeUInt16LE(value.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+value.length,12); end.writeUInt32LE(header.length+value.length+compressed.length,16);
  return Buffer.concat([header,value,compressed,central,value,end]);
};
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
  it('rejects active, executable, unknown and nested archive entries including renamed binary payloads', async () => {
    for (const name of ['program.exe','page.html','image.svg','unknown.dat','nested.zip','xl/macrosheets/sheet1.xml','word/activeX/activeX1.xml','word/embeddings/oleObject.bin'])
      await expect(store.inspect(await write(zip(name,false,Buffer.from('inert'))),'work.zip')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
    for (const name of ['program.txt','image.png'])
      await expect(store.inspect(await write(zip(name,false,Buffer.from('MZ executable'))),'work.zip')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
    await expect(store.inspect(await write(zip('program.txt',false,Buffer.concat([Buffer.from(Array.from({length:2000},(_,index)=>String(index)).join(",")),Buffer.from([0])]))),'work.zip')).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
  });
  it('keeps OOXML text package entries supported and rejects legacy OLE formats', async () => {
    for (const name of ['work.docx','work.xlsx','work.pptx'])
      expect(await store.inspect(await write(zip('[Content_Types].xml',false,Buffer.from('<Types/>'))),name)).toMatchObject({size:expect.any(Number)});
    for (const name of ['legacy.doc','legacy.xls','legacy.ppt'])
      await expect(store.inspect(await write(Buffer.from([208,207,17,224,161,177,26,225])),name)).rejects.toMatchObject({code:'portalFileTypeUnsupported'});
  });
  it('requires a valid authentication tag when reopening an encrypted public token', () => {
    const codec = createResourceTokenCodec('fixture-secret'), token = codec.random(), envelope = codec.seal(token); expect(codec.open(envelope)).toBe(token); expect(codec.hash(token)).toMatch(/^[a-f0-9]{64}$/);
    const altered = Buffer.from(envelope,'base64url'); altered[altered.length-1] ^= 1; expect(() => codec.open(altered.toString('base64url'))).toThrow(); expect(() => createResourceTokenCodec('different-secret').open(envelope)).toThrow();
  });
});
