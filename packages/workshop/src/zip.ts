/**
 * Minimal ZIP writer.
 *
 * A generated job is a `.MPF` plus a couple of dozen `.SPF` subprograms, and
 * asking an operator to click twenty-one download links is not a workflow. A
 * whole archiving dependency for that would be disproportionate, so this
 * writes the format directly: Bun already provides DEFLATE, which is the only
 * hard part, and G-code is text that compresses about tenfold.
 *
 * Scope is deliberately narrow — no ZIP64, no encryption, no directory
 * entries. Job output is a flat list of small text files and always will be.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const DEFLATE = 8;
const STORE = 0;
/** ZIP's version-needed for DEFLATE, and the UTF-8 filename flag (bit 11). */
const VERSION_NEEDED = 20;
const UTF8_FLAG = 0x0800;

export interface ZipEntry {
  name: string;
  /** Backed by a plain ArrayBuffer, which is what Bun's DEFLATE accepts. */
  data: Uint8Array<ArrayBuffer>;
}

interface StagedEntry {
  nameBytes: Uint8Array<ArrayBuffer>;
  payload: Uint8Array<ArrayBuffer>;
  method: number;
  crc: number;
  uncompressedSize: number;
  offset: number;
}

export function createZip(
  entries: ZipEntry[],
  date = new Date(),
): Uint8Array<ArrayBuffer> {
  const { time, day } = toDosTime(date);
  const staged: StagedEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const deflated = Bun.deflateSync(entry.data);
    // Deflate can grow incompressible input. Storing it is both smaller and
    // cheaper for the reader, and every ZIP tool handles both methods.
    const useDeflate = deflated.byteLength < entry.data.byteLength;
    const payload = useDeflate ? deflated : entry.data;

    const staged1: StagedEntry = {
      nameBytes,
      payload,
      method: useDeflate ? DEFLATE : STORE,
      crc: crc32(entry.data),
      uncompressedSize: entry.data.byteLength,
      offset,
    };
    staged.push(staged1);

    const header = new Uint8Array(30 + nameBytes.byteLength);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, staged1.method, true);
    view.setUint16(10, time, true);
    view.setUint16(12, day, true);
    view.setUint32(14, staged1.crc, true);
    view.setUint32(18, payload.byteLength, true);
    view.setUint32(22, staged1.uncompressedSize, true);
    view.setUint16(26, nameBytes.byteLength, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    chunks.push(header, payload);
    offset += header.byteLength + payload.byteLength;
  }

  const centralStart = offset;
  for (const entry of staged) {
    const record = new Uint8Array(46 + entry.nameBytes.byteLength);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL_HEADER, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(6, VERSION_NEEDED, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, time, true);
    view.setUint16(14, day, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.payload.byteLength, true);
    view.setUint32(24, entry.uncompressedSize, true);
    view.setUint16(28, entry.nameBytes.byteLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    record.set(entry.nameBytes, 46);

    chunks.push(record);
    offset += record.byteLength;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, staged.length, true);
  endView.setUint16(10, staged.length, true);
  endView.setUint32(12, offset - centralStart, true);
  endView.setUint32(16, centralStart, true);
  endView.setUint16(20, 0, true);
  chunks.push(end);

  return concat(chunks, offset + end.byteLength);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.byteLength;
  }
  return output;
}

/** MS-DOS date/time, which is what the format stores. */
function toDosTime(date: Date): { time: number; day: number } {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    day:
      ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
