import { createReadStream,constants } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ResourceFileStore, ResourceTokenCodec } from '../application/ports';
import { PORTAL_MAX_FILE_BYTES } from '@shared/contracts/portal-resources';
import { PortalResourceError } from '../domain/policy';
import { reserveUploadSpace } from './storage-reservation';
import { removeCommittedUpload } from '../../../lib/retained-uploads';

const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.ipynb', '.py', '.js', '.ts', '.tsx', '.jsx', '.css', '.java', '.c', '.h', '.cpp', '.cs', '.sql', '.yaml', '.yml']);
const zipExtensions = new Set(['.zip', '.docx', '.xlsx', '.pptx']);
const mimeByExtension: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const validateZip = async (file: Awaited<ReturnType<typeof fs.open>>, size: number) => {
  const tailSize = Math.min(size, 65557), tail = Buffer.alloc(tailSize);
  await file.read(tail, 0, tailSize, size - tailSize);
  let end = tail.length - 22;
  while (end >= 0 && tail.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length) throw new PortalResourceError('portalFileTypeUnsupported');
  const count = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || count === 0xffff || count > 10000 || directorySize > 2 * 1024 * 1024 || offset + directorySize > size || offset === 0xffffffff) throw new PortalResourceError('portalArchiveTooLarge');
  const directory = Buffer.alloc(directorySize);
  await file.read(directory, 0, directorySize, offset);
  let cursor = 0, expandedBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) throw new PortalResourceError('portalFileTypeUnsupported');
    const flags = directory.readUInt16LE(cursor + 8), nameSize = directory.readUInt16LE(cursor + 28), extraSize = directory.readUInt16LE(cursor + 30), commentSize = directory.readUInt16LE(cursor + 32);
    const name = directory.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8').replace(/\\/g, '/');
    if (!name || /[\x00-\x1f\x7f]/.test(name) || flags & 0x41 || /(^|\/)\.\.(\/|$)|^\/|^[a-z]:|vbaProject\.bin$|\.docm$|\.xlsm$|\.pptm$/i.test(name)) throw new PortalResourceError('portalFileTypeUnsupported');
    const method = directory.readUInt16LE(cursor + 10), compressed = directory.readUInt32LE(cursor + 20), expanded = directory.readUInt32LE(cursor + 24), localOffset = directory.readUInt32LE(cursor + 42);
    expandedBytes += expanded;
    if (expanded > PORTAL_MAX_FILE_BYTES || expandedBytes > 2 * PORTAL_MAX_FILE_BYTES || expanded / Math.max(1, compressed) > 200 || localOffset === 0xffffffff) throw new PortalResourceError('portalArchiveTooLarge');
    if (![0, 8].includes(method) || localOffset + 30 > offset) throw new PortalResourceError('portalFileTypeUnsupported');
    const local = Buffer.alloc(30); await file.read(local, 0, 30, localOffset);
    const localNameSize = local.readUInt16LE(26), dataOffset = localOffset + 30 + localNameSize + local.readUInt16LE(28);
    if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || dataOffset + compressed > offset) throw new PortalResourceError('portalFileTypeUnsupported');
    const localName = Buffer.alloc(localNameSize); await file.read(localName, 0, localNameSize, localOffset + 30);
    if (!localName.equals(directory.subarray(cursor + 46, cursor + 46 + nameSize))) throw new PortalResourceError('portalFileTypeUnsupported');
    if (!(flags & 8) && (local.readUInt32LE(18) !== compressed || local.readUInt32LE(22) !== expanded)) throw new PortalResourceError('portalFileTypeUnsupported');
    if (method === 0 && compressed !== expanded) throw new PortalResourceError('portalFileTypeUnsupported');
    if (method === 8) {
      if (!compressed) throw new PortalResourceError('portalFileTypeUnsupported');
      let actual = 0;
      const countBytes = new Writable({ write(chunk: Buffer, _encoding, callback) {
        actual += chunk.length;
        callback(actual > expanded ? new PortalResourceError('portalArchiveTooLarge') : undefined);
      } });
      try { await pipeline(file.createReadStream({start:dataOffset,end:dataOffset+compressed-1,autoClose:false}), createInflateRaw(), countBytes); }
      catch (error) { if (error instanceof PortalResourceError) throw error; throw new PortalResourceError('portalFileTypeUnsupported'); }
      if (actual !== expanded) throw new PortalResourceError('portalFileTypeUnsupported');
    }
    cursor += 46 + nameSize + extraSize + commentSize;
    if (cursor > directory.length) throw new PortalResourceError('portalFileTypeUnsupported');
  }
  if (cursor !== directory.length) throw new PortalResourceError('portalFileTypeUnsupported');
};
export class LocalResourceFileStore implements ResourceFileStore {
  constructor(private readonly directory = path.resolve('uploads/lms/files'), private readonly uploadsDirectory = path.resolve('uploads')) {}
  location(storageKey: string) {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(storageKey)) throw new PortalResourceError('portalNotFound', 404);
    return path.join(this.directory, storageKey);
  }
  async commit(temporaryPath: string, storageKey: string) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o750 });
    await fs.rename(temporaryPath, this.location(storageKey));
    await fs.chmod(this.location(storageKey), 0o600);
  }
  async remove(storageKey: string) { await removeCommittedUpload(this.location(storageKey), this.uploadsDirectory); }
  async clone(sourceKey:string,targetKey:string) {
    await fs.mkdir(this.directory,{recursive:true,mode:0o750});
    const source=await fs.stat(this.location(sourceKey)),release=await reserveUploadSpace(this.directory,source.size,{uploadsDirectory:this.uploadsDirectory});
    let copied=false;
    try {await fs.copyFile(this.location(sourceKey),this.location(targetKey),constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);await fs.chmod(this.location(targetKey),0o600);copied=true;}
    finally {release(copied?{writtenBytes:source.size}:undefined);}
  }
  async inspect(temporaryPath: string, name: string) {
    if (!name || name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new PortalResourceError('portalFileNameInvalid');
    const stat = await fs.stat(temporaryPath);
    if (!stat.isFile() || stat.size > PORTAL_MAX_FILE_BYTES) throw new PortalResourceError('portalFileTooLarge', 413);
    const extension = path.extname(name).toLowerCase(), file = await fs.open(temporaryPath, 'r');
    let mime = mimeByExtension[extension];
    try {
      const probe = Buffer.alloc(Math.min(stat.size, 8192));
      await file.read(probe, 0, probe.length, 0);
      if (textExtensions.has(extension)) {
        if (probe.includes(0) || probe.subarray(0, 2).equals(Buffer.from('MZ'))) throw new PortalResourceError('portalFileTypeUnsupported');
        mime = 'text/plain';
      } else if (zipExtensions.has(extension)) {
        if (probe.length < 4 || ![0x04034b50, 0x06054b50].includes(probe.readUInt32LE(0))) throw new PortalResourceError('portalFileTypeUnsupported');
        await validateZip(file, stat.size);
      } else if (extension === '.pdf') {
        if (!probe.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new PortalResourceError('portalFileTypeUnsupported');
      } else if (extension === '.png') {
        if (!probe.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new PortalResourceError('portalFileTypeUnsupported');
      } else if (extension === '.jpg' || extension === '.jpeg') {
        if (!probe.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) throw new PortalResourceError('portalFileTypeUnsupported');
      } else if (extension === '.webp') {
        if (probe.subarray(0, 4).toString() !== 'RIFF' || probe.subarray(8, 12).toString() !== 'WEBP') throw new PortalResourceError('portalFileTypeUnsupported');
      } else throw new PortalResourceError('portalFileTypeUnsupported');
    } finally { await file.close(); }
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(temporaryPath)) hash.update(chunk);
    return { mime, size: stat.size, sha256: hash.digest('hex') };
  }
}
export const createResourceTokenCodec = (secret: string): ResourceTokenCodec => {
  const key = crypto.createHash('sha256').update(secret).digest();
  return {
    random: () => crypto.randomBytes(32).toString('base64url'), hash: (token) => crypto.createHash('sha256').update(token).digest('hex'),
    seal: (token) => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url'); },
    open: (envelope) => { const body = Buffer.from(envelope, 'base64url'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12)); cipher.setAuthTag(body.subarray(12, 28)); return Buffer.concat([cipher.update(body.subarray(28)), cipher.final()]).toString('utf8'); },
  };
};
