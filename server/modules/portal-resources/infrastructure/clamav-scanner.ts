import { createReadStream } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';
import type { ResourceScanner } from '../application/ports';

const write = async (socket: Socket, bytes: Buffer) => {
  if (socket.destroyed) throw new Error('scanner_connection_closed');
  if (!socket.write(bytes)) await once(socket, 'drain');
};
/** INSTREAM sends bytes only; the daemon never receives a local path. */
export class ClamAvScanner implements ResourceScanner {
  constructor(private readonly options: { host: string; port: number; timeoutMs: number }) {}
  async scan(filePath: string): Promise<'ready' | 'rejected'> {
    const socket = createConnection({ host: this.options.host, port: this.options.port });
    const response = new Promise<string>((resolve, reject) => {
      let data = '';
      socket.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8');
        if (data.length > 8192) { socket.destroy(); reject(new Error('scanner_invalid_response')); }
        else if (data.includes('\0')) resolve(data.split('\0')[0]);
      });
      socket.once('error', reject);
      socket.once('close', () => { if (!data.includes('\0')) reject(new Error('scanner_connection_closed')); });
      socket.setTimeout(this.options.timeoutMs, () => socket.destroy(new Error('scanner_timeout')));
    });
    // Attach a handler immediately so an early socket failure is never unhandled.
    void response.catch(() => undefined);
    try {
      await once(socket, 'connect');
      await write(socket, Buffer.from('zINSTREAM\0'));
      for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length);
        await write(socket, length); await write(socket, chunk);
      }
      await write(socket, Buffer.alloc(4));
      const result = await response;
      if (result.endsWith(': OK')) return 'ready';
      if (result.endsWith(' FOUND')) return 'rejected';
      throw new Error('scanner_rejected_scan');
    } finally { socket.destroy(); }
  }
}
