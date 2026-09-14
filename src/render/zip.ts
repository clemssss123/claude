/**
 * A minimal store-only ZIP writer.
 *
 * PNG frames are already compressed, so deflating them again would cost time
 * and save nothing — storing them is both faster and simpler than pulling in a
 * compression library.
 */

interface Entry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipWriter {
  private entries: Entry[] = [];

  private chunks: Uint8Array[] = [];

  private offset = 0;

  add(name: string, data: Uint8Array): void {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true); // local file header
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // stored, no compression
    view.setUint16(10, 0, true); // modification time
    view.setUint16(12, 0, true); // modification date
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    this.entries.push({ name, data, crc, offset: this.offset });
    this.chunks.push(header, data);
    this.offset += header.length + data.length;
  }

  finish(): Blob {
    const directoryStart = this.offset;
    for (const entry of this.entries) {
      const nameBytes = new TextEncoder().encode(entry.name);
      const record = new Uint8Array(46 + nameBytes.length);
      const view = new DataView(record.buffer);

      view.setUint32(0, 0x02014b50, true); // central directory header
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 0, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.data.length, true);
      view.setUint32(24, entry.data.length, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint32(42, entry.offset, true);
      record.set(nameBytes, 46);

      this.chunks.push(record);
      this.offset += record.length;
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); // end of central directory
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, this.offset - directoryStart, true);
    view.setUint32(16, directoryStart, true);
    this.chunks.push(end);

    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' });
  }
}
