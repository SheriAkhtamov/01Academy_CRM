import { deflateRawSync } from "node:zlib";

/** Tiny inert ZIP fixtures exercise metadata and expansion checks without allocating the declared oversized payload. */
export function acceptanceArchive(
  body: Buffer,
  declaredExpanded = body.length,
  entryName = "practice.txt",
  encrypted = false,
) {
  const name = Buffer.from(entryName);
  const compressed = deflateRawSync(body),
    header = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(encrypted ? 1 : 0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(declaredExpanded, 22);
  header.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(encrypted ? 1 : 0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredExpanded, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(header.length + name.length + compressed.length, 16);
  return Buffer.concat([header, name, compressed, central, name, end]);
}
