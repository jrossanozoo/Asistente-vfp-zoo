import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { decodePrg, parseNoteRows, pathToUri } from 'asistente-vfp-core';
import type { ClassDecl, DocInfo, FileEntry, LayerInfo, MemberDecl, Param, ParsedFile, Rng, SymbolIndex } from 'asistente-vfp-core';

/**
 * Lector de `.symbols` de dovfp.
 *   v2.5: Nombre|Tipo|ClasePadre|TipoArchivo|RutaFuente|Fecha|TipoDato|Firma
 *   v2.6: + |Línea|Doc   (Doc con `\|` y `\n` escapados)
 * Tolera columnas extra y líneas con menos de 5 columnas (las descarta).
 */

export interface SymbolRow {
  name: string;
  type: string;
  parent: string;
  fileType: string;
  sourceFile: string;
  modified: string;
  dataType: string;
  signature: string;
  line?: number;
  doc?: string;
  /** Línea en el archivo .symbols (0-based). */
  rowLine: number;
}

export interface SymbolsFile {
  version: string;
  project?: string;
  rows: SymbolRow[];
}

const DATA_TYPES: Record<string, string> = {
  C: 'String',
  N: 'Number',
  L: 'Logical',
  D: 'Date',
  T: 'DateTime',
  Y: 'Currency',
  O: 'Object',
};

export function splitColumns(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cols.push(cur);
      cur = '';
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}

export function unescapeDoc(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

export function parseSymbolsText(text: string): SymbolsFile {
  const lines = text.split(/\r\n|\n|\r/);
  let version = 'v?';
  let project: string | undefined;
  const rows: SymbolRow[] = [];
  lines.forEach((line, idx) => {
    if (line.startsWith('#')) {
      const v = /DOVFP Symbols (v[\d.]+)/i.exec(line);
      if (v) version = v[1];
      const p = /^#\s*Project:\s*(.+)$/i.exec(line);
      if (p) project = p[1].trim();
      return;
    }
    if (!line.trim()) return;
    const c = splitColumns(line);
    if (c.length < 5) return;
    const lineNo = c[8] !== undefined && /^\d+$/.test(c[8].trim()) ? parseInt(c[8], 10) : undefined;
    rows.push({
      name: c[0].trim(),
      type: (c[1] ?? '').trim().toUpperCase(),
      parent: (c[2] ?? '').trim(),
      fileType: (c[3] ?? '').trim().toLowerCase(),
      sourceFile: (c[4] ?? '').trim(),
      modified: (c[5] ?? '').trim(),
      dataType: (c[6] ?? '').trim(),
      signature: (c[7] ?? '').trim(),
      line: lineNo,
      doc: c[9] ? unescapeDoc(c[9]) : undefined,
      rowLine: idx,
    });
  });
  return { version, project, rows };
}

export function readSymbolsFile(p: string): SymbolsFile {
  return parseSymbolsText(decodePrg(fs.readFileSync(p)));
}

/** Parámetros de la firma: `tcA as String, tnB`. */
export function parseSignature(sig: string): Param[] {
  if (!sig) return [];
  return sig
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^@?(\w+)(?:\s+as\s+([\w.]+)(?:\s+(?:of|as)\s+(\S+))?)?/i.exec(s);
      return m ? { name: m[1], type: m[2], lib: m[3] } : { name: s };
    });
}

function rangeAt(line: number, start = 0, end = 0): Rng {
  return { start: { line, character: start }, end: { line, character: end } };
}

function docFrom(row: SymbolRow): DocInfo | undefined {
  if (!row.doc) return undefined;
  const doc = parseNoteRows(row.doc.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()));
  doc.source = 'symbols';
  return doc;
}

export interface SymbolsLocator {
  /** Ruta del fuente real si existe en disco. */
  sourcePath(row: SymbolRow): string | undefined;
  /** Ubicación en el stub de una clase (y opcionalmente un miembro), si existe. */
  stubLocation(className: string, member?: string): { uri: string; range: Rng } | undefined;
}

/**
 * Convierte un .symbols en archivos "sintéticos" para el índice (uno por fuente de origen).
 * Ubicación de cada símbolo, en orden: fuente real (con línea v2.6), stub dovfp, la fila del .symbols.
 */
export function symbolsToEntries(symbolsPath: string, file: SymbolsFile, layer: LayerInfo, locator: SymbolsLocator): FileEntry[] {
  const symbolsUri = pathToUri(symbolsPath);
  const bySource = new Map<string, ParsedFile>();
  const classes = new Map<string, ClassDecl>();
  const seen = new Set<string>();

  const parsedFor = (row: SymbolRow): ParsedFile => {
    const key = row.sourceFile.toLowerCase();
    let p = bySource.get(key);
    if (!p) {
      const syntheticUri = URI.from({ scheme: 'vfp-symbols', path: `/${path.basename(symbolsPath)}/${row.sourceFile.replace(/\\/g, '/')}` }).toString();
      p = { uri: syntheticUri, classes: [], procedures: [], calls: [], notes: [], referencedClasses: [], diagnostics: [] };
      bySource.set(key, p);
    }
    return p;
  };

  const locate = (row: SymbolRow, className: string | undefined, member: string | undefined): { uri: string; range: Rng; approximate: boolean } => {
    const src = locator.sourcePath(row);
    if (src) {
      const line = row.line !== undefined ? Math.max(0, row.line - 1) : 0;
      return { uri: pathToUri(src), range: rangeAt(line), approximate: row.line === undefined };
    }
    if (className) {
      const stub = locator.stubLocation(className, member);
      if (stub) return { uri: stub.uri, range: stub.range, approximate: !member || stub.range.start.line === 0 };
    }
    return { uri: symbolsUri, range: rangeAt(row.rowLine, 0, row.name.length), approximate: false };
  };

  // Primero las clases, después los miembros.
  for (const row of file.rows) {
    if (row.type !== 'CLASS') continue;
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = locate(row, row.name, undefined);
    const decl: ClassDecl = {
      name: row.name,
      parent: row.parent || undefined,
      uri: loc.uri,
      nameRange: loc.range,
      range: loc.range,
      olepublic: false,
      members: [],
      doc: docFrom(row),
      fileType: row.fileType || 'prg',
      approximate: loc.approximate,
      sourcePath: row.sourceFile,
    };
    classes.set(key, decl);
    parsedFor(row).classes.push(decl);
  }
  for (const row of file.rows) {
    if (row.type === 'CLASS') continue;
    const dot = row.name.indexOf('.');
    const params = parseSignature(row.signature);
    const returnType = DATA_TYPES[row.dataType.toUpperCase()];
    if (dot > 0 && (row.type === 'METHOD' || row.type === 'PROPERTY')) {
      const className = row.name.substring(0, dot);
      const memberName = row.name.substring(dot + 1);
      const cls = classes.get(className.toLowerCase());
      if (!cls) continue;
      if (cls.members.some((m) => m.name.toLowerCase() === memberName.toLowerCase())) continue;
      const loc = locate(row, className, memberName);
      const member: MemberDecl = {
        kind: row.type === 'METHOD' ? 'method' : 'property',
        name: memberName,
        className: cls.name,
        uri: loc.uri,
        nameRange: loc.range,
        range: loc.range,
        params: row.type === 'METHOD' ? params : [],
        keyword: 'function',
        returnType: row.type === 'METHOD' ? returnType : undefined,
        visibility: 'public',
        doc: docFrom(row),
        approximate: loc.approximate,
      };
      cls.members.push(member);
    } else if (row.type === 'PROCEDURE' || row.type === 'FUNCTION') {
      const loc = locate(row, undefined, undefined);
      parsedFor(row).procedures.push({
        kind: row.type === 'FUNCTION' ? 'function' : 'procedure',
        name: row.name,
        uri: loc.uri,
        nameRange: loc.range,
        range: loc.range,
        params,
        keyword: row.type.toLowerCase(),
        returnType,
        visibility: 'public',
        doc: docFrom(row),
        approximate: loc.approximate,
      });
    }
  }
  return [...bySource.values()].map((parsed) => ({ uri: parsed.uri, parsed, layer, lookupName: null }));
}

/** Localiza fuentes (rutas relativas a `<repo>/Organic.BusinessLogic/bin/App`) y stubs (indexados como T4). */
export function makeLocator(index: SymbolIndex, sourceRoot: string | undefined, stubsDir: string | undefined): SymbolsLocator {
  return {
    sourcePath(row) {
      if (!sourceRoot || !row.sourceFile) return undefined;
      const rel = row.sourceFile.replace(/\\/g, path.sep);
      const candidates = [
        path.resolve(sourceRoot, 'Organic.BusinessLogic', 'bin', 'App', rel),
        path.resolve(sourceRoot, 'Organic.BusinessLogic', rel.replace(/^(\.\.[\\/])+/, '')),
      ];
      return candidates.find((p) => fs.existsSync(p));
    },
    stubLocation(className, member) {
      if (!stubsDir) return undefined;
      const stubUriPrefix = pathToUri(stubsDir).toLowerCase();
      const entry = index.classEntries(className, { includeDownstream: true }).find((e) => e.decl.uri.toLowerCase().startsWith(stubUriPrefix));
      if (!entry) return undefined;
      if (member) {
        const m = entry.decl.members.find((mm) => mm.name.toLowerCase() === member.toLowerCase());
        if (m) return { uri: m.uri, range: m.nameRange };
      }
      return { uri: entry.decl.uri, range: entry.decl.nameRange };
    },
  };
}
