import { crc32, inflateRawSync } from "node:zlib";

/**
 * A minimal, defensive ZIP reader for skill uploads, on Node's zlib (no dependency). Reads the central directory,
 * then each wanted entry with its declared size as a hard output cap (zip bombs stop there) and a CRC check.
 * Rejects ZIP64, encryption, multi-disk archives and compression other than stored/deflate. Symlinks are reported
 * (from the Unix mode in the external attributes) so the caller can refuse them; their targets are never read.
 */

export class ZipError extends Error {}

export type ZipEntry = {
  path: string;
  kind: "file" | "directory" | "symlink";
  method: number;
  compressedSize: number;
  /** Declared uncompressed size; reading never produces more. */
  size: number;
  crc: number;
  localOffset: number;
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 5000;

function findEndOfCentralDirectory(buf: Buffer) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= min; p--) {
    if (buf.readUInt32LE(p) === EOCD) return p;
  }
  throw new ZipError("This isn't a valid .zip file.");
}

/** Every entry of the archive, from its central directory. */
export function listZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new ZipError("This isn't a valid .zip file.");
  const end = findEndOfCentralDirectory(buf);
  const disk = buf.readUInt16LE(end + 4);
  const cdDisk = buf.readUInt16LE(end + 6);
  const onDisk = buf.readUInt16LE(end + 8);
  const total = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 archives aren't supported.");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new ZipError("Split (multi-part) archives aren't supported.");
  if (total > MAX_ENTRIES) throw new ZipError("The archive has too many entries.");
  if (cdOffset + cdSize > end) throw new ZipError("This .zip file is damaged.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > end || buf.readUInt32LE(p) !== CENTRAL) throw new ZipError("This .zip file is damaged.");
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const external = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLength > end) throw new ZipError("This .zip file is damaged.");
    const rawName = buf.subarray(p + 46, p + 46 + nameLength);
    if (rawName.includes(0)) throw new ZipError("The archive has a file name with a NUL character.");
    const path = rawName.toString("utf8");
    if (flags & 0x1) throw new ZipError("Encrypted archives aren't supported.");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError("ZIP64 archives aren't supported.");

    const unixMode = madeBy >> 8 === 3 ? external >>> 16 : 0;
    const type = unixMode & 0o170000;
    const kind: ZipEntry["kind"] =
      type === 0o120000 ? "symlink" : path.endsWith("/") || type === 0o040000 || (!unixMode && external & 0x10) ? "directory" : "file";
    entries.push({ path, kind, method, compressedSize, size, crc, localOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One file's bytes: exactly its declared size, CRC-checked. */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL) throw new ZipError("This .zip file is damaged.");
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  if (start + entry.compressedSize > buf.length) throw new ZipError("This .zip file is damaged.");
  const data = buf.subarray(start, start + entry.compressedSize);

  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(data);
  } else if (entry.method === 8) {
    try {
      out = entry.size === 0 ? Buffer.alloc(0) : inflateRawSync(data, { maxOutputLength: entry.size });
    } catch {
      throw new ZipError(`${entry.path} is damaged or bigger than the archive says.`);
    }
  } else {
    throw new ZipError(`${entry.path} uses a compression method that isn't supported (only stored and deflate).`);
  }
  if (out.length !== entry.size || crc32(out) >>> 0 !== entry.crc >>> 0) throw new ZipError(`${entry.path} is damaged (size or checksum mismatch).`);
  return out;
}
