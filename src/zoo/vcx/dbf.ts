import * as fs from 'fs';
import { decodePrg } from 'asistente-vfp-core';

/**
 * Lector mínimo de tablas DBF de Visual FoxPro con memos FPT (formato de .vcx/.vct y .scx/.sct).
 * Solo lectura. Campos de texto en Windows-1252.
 */

export interface DbfField {
  name: string;
  type: string;
  offset: number;
  length: number;
}

export type DbfRecord = Record<string, string>;

function memoPath(dbfPath: string): string | undefined {
  const candidates = [
    dbfPath.replace(/\.vcx$/i, '.vct').replace(/\.scx$/i, '.sct').replace(/\.dbf$/i, '.fpt'),
    dbfPath.replace(/\.vcx$/i, '.VCT').replace(/\.scx$/i, '.SCT').replace(/\.dbf$/i, '.FPT'),
  ];
  return candidates.find((p) => p !== dbfPath && fs.existsSync(p));
}

export class FptReader {
  private readonly blockSize: number;

  constructor(private readonly buf: Buffer) {
    this.blockSize = buf.length >= 8 ? buf.readUInt16BE(6) || 64 : 64;
  }

  read(block: number): string {
    if (block <= 0) return '';
    const pos = block * this.blockSize;
    if (pos + 8 > this.buf.length) return '';
    const len = this.buf.readUInt32BE(pos + 4);
    const end = Math.min(this.buf.length, pos + 8 + len);
    return decodePrg(this.buf.subarray(pos + 8, end));
  }
}

export function readDbf(dbfPath: string): { fields: DbfField[]; records: DbfRecord[] } {
  const buf = fs.readFileSync(dbfPath);
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields: DbfField[] = [];
  let pos = 32;
  let offset = 1;
  while (pos + 32 <= headerLen && buf[pos] !== 0x0d) {
    const rawName = buf.subarray(pos, pos + 11);
    const zero = rawName.indexOf(0);
    const name = rawName.subarray(0, zero < 0 ? 11 : zero).toString('latin1').toUpperCase();
    const type = String.fromCharCode(buf[pos + 11]);
    const length = buf[pos + 16];
    fields.push({ name, type, offset, length });
    offset += length;
    pos += 32;
  }
  const mp = memoPath(dbfPath);
  const fpt = mp ? new FptReader(fs.readFileSync(mp)) : undefined;
  const records: DbfRecord[] = [];
  for (let i = 0; i < count; i++) {
    const start = headerLen + i * recordLen;
    if (start + recordLen > buf.length) break;
    if (buf[start] === 0x2a) continue; // borrado
    const rec: DbfRecord = {};
    for (const f of fields) {
      const raw = buf.subarray(start + f.offset, start + f.offset + f.length);
      if (f.type === 'M' || f.type === 'G' || f.type === 'W') {
        const block = f.length === 4 ? raw.readInt32LE(0) : parseInt(raw.toString('latin1').trim() || '0', 10);
        rec[f.name] = fpt ? fpt.read(block) : '';
      } else if (f.type === 'C' || f.type === 'N' || f.type === 'L' || f.type === 'D') {
        rec[f.name] = decodePrg(raw).trim();
      } else {
        rec[f.name] = '';
      }
    }
    records.push(rec);
  }
  return { fields, records };
}
