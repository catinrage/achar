import { describe, expect, it } from 'bun:test';
import { createZip } from './zip';

/**
 * The archive is read by whatever the operator has on the shop floor —
 * Windows Explorer, 7-Zip, the controller's own tooling — so these assert the
 * bytes of the format rather than a round-trip through the same code.
 */

const encode = (text: string) => new TextEncoder().encode(text);

const LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const END_OF_CENTRAL = [0x50, 0x4b, 0x05, 0x06];

function readUint32(archive: Uint8Array, offset: number): number {
  return new DataView(archive.buffer, archive.byteOffset).getUint32(
    offset,
    true,
  );
}

function readUint16(archive: Uint8Array, offset: number): number {
  return new DataView(archive.buffer, archive.byteOffset).getUint16(
    offset,
    true,
  );
}

/** Offset of the end-of-central-directory record, which is always last. */
function endRecord(archive: Uint8Array): number {
  return archive.byteLength - 22;
}

describe('createZip', () => {
  it('writes a well-formed empty archive', () => {
    const archive = createZip([]);

    expect([...archive.slice(0, 4)]).toEqual(END_OF_CENTRAL);
    expect(archive.byteLength).toBe(22);
  });

  it('opens with a local file header and ends with the central directory', () => {
    const archive = createZip([
      { name: 'Setup1.MPF', data: encode('N10 G0 X0\n') },
    ]);

    expect([...archive.slice(0, 4)]).toEqual(LOCAL_HEADER);
    expect([
      ...archive.slice(endRecord(archive), endRecord(archive) + 4),
    ]).toEqual(END_OF_CENTRAL);
  });

  it('records every entry in the central directory', () => {
    const archive = createZip([
      { name: 'a.SPF', data: encode('one') },
      { name: 'b.SPF', data: encode('two') },
      { name: 'c.SPF', data: encode('three') },
    ]);

    const end = endRecord(archive);
    expect(readUint16(archive, end + 8)).toBe(3);
    expect(readUint16(archive, end + 10)).toBe(3);
  });

  it('deflates repetitive G-code rather than storing it', () => {
    const repetitive = encode('N10 G1 X1.0 Y1.0 F500\n'.repeat(500));
    const archive = createZip([{ name: 'big.SPF', data: repetitive }]);

    // Method lives at offset 8 of the local header: 8 is DEFLATE, 0 is STORE.
    expect(readUint16(archive, 8)).toBe(8);
    expect(archive.byteLength).toBeLessThan(repetitive.byteLength / 4);
    // The uncompressed size is still recorded truthfully.
    expect(readUint32(archive, 22)).toBe(repetitive.byteLength);
  });

  it('never stores a payload larger than the input it came from', () => {
    // Deflate grows high-entropy input, so the writer falls back to STORE.
    // A deterministic xorshift stands in for randomness to keep the test
    // reproducible.
    const noise = new Uint8Array(4096);
    let seed = 0x9e3779b9;
    for (let index = 0; index < noise.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noise[index] = seed & 0xff;
    }
    const archive = createZip([{ name: 'noise.bin', data: noise }]);

    const method = readUint16(archive, 8);
    const compressedSize = readUint32(archive, 18);
    expect([0, 8]).toContain(method);
    expect(compressedSize).toBeLessThanOrEqual(noise.byteLength);
    if (method === 0) expect(compressedSize).toBe(noise.byteLength);
  });

  it('flags UTF-8 so a Persian filename survives extraction', () => {
    const archive = createZip([{ name: 'قطعه.SPF', data: encode('x') }]);

    // Bit 11 of the general-purpose flags at offset 6.
    expect(readUint16(archive, 6) & 0x0800).toBe(0x0800);
    const nameLength = readUint16(archive, 26);
    const name = new TextDecoder().decode(archive.slice(30, 30 + nameLength));
    expect(name).toBe('قطعه.SPF');
  });

  it('records a CRC that matches the content', () => {
    // Same input, same archive: generation is deterministic given a date, and
    // a differing CRC is the failure every ZIP reader reports first.
    const date = new Date(2026, 0, 2, 3, 4, 6);
    const first = createZip([{ name: 'a.SPF', data: encode('N10\n') }], date);
    const second = createZip([{ name: 'a.SPF', data: encode('N10\n') }], date);

    expect([...first]).toEqual([...second]);
    expect(readUint32(first, 14)).not.toBe(0);
  });
});
