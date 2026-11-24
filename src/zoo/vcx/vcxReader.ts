import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { normalizePath, parsePrg } from 'asistente-vfp-core';
import type { FileEntry, LayerInfo } from 'asistente-vfp-core';
import { DbfRecord, readDbf } from './dbf';

export const VCX_SCHEME = 'foxpro-vcx';

export interface VcxClass {
  name: string;
  parent: string;
  parentLib: string;
  baseClass: string;
  /** Código PRG equivalente (solo lectura). */
  text: string;
}

export function vcxClassUri(vcxPath: string, className: string): string {
  return URI.from({ scheme: VCX_SCHEME, path: '/' + normalizePath(vcxPath).replace(/\\/g, '/') + '/' + className + '.prg' }).toString();
}

export function parseVcxUri(uri: string): { vcxPath: string; className: string } | undefined {
  const u = URI.parse(uri);
  if (u.scheme !== VCX_SCHEME) return undefined;
  const p = u.path.replace(/^\//, '');
  const slash = p.lastIndexOf('/');
  if (slash < 0) return undefined;
  return { vcxPath: normalizePath(p.substring(0, slash)), className: p.substring(slash + 1).replace(/\.prg$/i, '') };
}

function indent(text: string, prefix: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((l) => (l.trim() ? prefix + l.replace(/^\s+/, '') : ''))
    .filter((l, i, arr) => !(l === '' && (i === 0 || arr[i - 1] === '')));
}

/** Descripciones de RESERVED3: `*metodo Descripción`, `propiedad Descripción`, `^arreglo[1,0] Descripción`. */
function customMembers(reserved3: string): { methods: Map<string, string>; props: Map<string, string>; arrays: string[] } {
  const methods = new Map<string, string>();
  const props = new Map<string, string>();
  const arrays: string[] = [];
  for (const raw of reserved3.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([*^]?)([\w.]+)(\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === '*') methods.set(m[2].toLowerCase(), m[4]);
    else if (m[1] === '^') arrays.push(m[2] + (m[3] ?? '[1]'));
    else props.set(m[2].toLowerCase(), m[4]);
  }
  return { methods, props, arrays };
}

function propertyLines(props: string): string[] {
  return props
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.]+\s*=/.test(l) && !/^name\s*=/i.test(l));
}

function methodBlock(methods: string, prefixName: string, descriptions: Map<string, string>): string[] {
  const out: string[] = [];
  for (const line of methods.split(/\r\n|\n|\r/)) {
    const m = /^(\s*)(procedure|function)\s+([\w.]+)(.*)$/i.exec(line);
    if (m) {
      const name = prefixName ? `${prefixName}.${m[3]}` : m[3];
      const desc = descriptions.get(m[3].toLowerCase());
      if (desc && !prefixName) out.push(`\t* ${desc}`);
      out.push(`\t${m[2].toUpperCase()} ${name}${m[4]}`);
    } else if (line.trim()) {
      out.push('\t' + line.replace(/^\t?/, ''));
    } else {
      out.push('');
    }
  }
  return out;
}

export function buildVcxClasses(vcxPath: string, records: DbfRecord[]): VcxClass[] {
  const result: VcxClass[] = [];
  const rows = records.filter((r) => (r.PLATFORM ?? '').toUpperCase() === 'WINDOWS');
  const classRows = rows.filter((r) => (r.RESERVED1 ?? '').toLowerCase() === 'class' && !r.PARENT);
  for (const cr of classRows) {
    const name = cr.OBJNAME;
    const lowerName = name.toLowerCase();
    const children = rows.filter((r) => {
      const p = (r.PARENT ?? '').toLowerCase();
      return p === lowerName || p.startsWith(lowerName + '.');
    });
    const custom = customMembers(cr.RESERVED3 ?? '');
    const lines: string[] = [];
    lines.push(`* Vista de solo lectura generada desde ${path.basename(vcxPath)} (Asistente VFP Zoo).`);
    const of = cr.CLASSLOC ? ` of ${cr.CLASSLOC}` : '';
    lines.push(`define class ${name} as ${cr.CLASS || cr.BASECLASS}${of}`);
    if (cr.RESERVED7) lines.push(`\t&& ${cr.RESERVED7.replace(/\s+/g, ' ').trim()}`);
    lines.push('');
    const protectedNames = (cr.PROTECTED ?? '')
      .split(/\r\n|\n|\r/)
      .map((s) => s.trim().replace(/\^$/, ''))
      .filter(Boolean);
    if (protectedNames.length) lines.push(`\tprotected ${protectedNames.join(', ')}`);
    const declared = new Set<string>();
    for (const p of propertyLines(cr.PROPERTIES ?? '')) {
      const pname = p.split('=')[0].trim();
      declared.add(pname.toLowerCase());
      const desc = custom.props.get(pname.toLowerCase());
      if (desc) lines.push(`\t* ${desc}`);
      lines.push(`\t${p}`);
    }
    for (const [pname, desc] of custom.props) {
      if (declared.has(pname)) continue;
      if (desc) lines.push(`\t* ${desc}`);
      lines.push(`\t${pname} = .F.`);
    }
    for (const a of custom.arrays) lines.push(`\tdimension ${a}`);
    for (const ch of children) {
      if ((ch.PARENT ?? '').toLowerCase() === lowerName) {
        lines.push(`\tadd object ${ch.OBJNAME} as ${ch.CLASS || ch.BASECLASS}`);
      }
    }
    lines.push('');
    lines.push(...methodBlock(cr.METHODS ?? '', '', custom.methods));
    for (const ch of children) {
      if (!ch.METHODS?.trim()) continue;
      const rel = (ch.PARENT ?? '').substring(name.length).replace(/^\./, '');
      const prefix = rel ? `${rel}.${ch.OBJNAME}` : ch.OBJNAME;
      lines.push(...methodBlock(ch.METHODS, prefix, new Map()));
    }
    lines.push('enddefine');
    result.push({
      name,
      parent: cr.CLASS || cr.BASECLASS,
      parentLib: cr.CLASSLOC,
      baseClass: cr.BASECLASS,
      text: lines.join('\r\n') + '\r\n',
    });
  }
  return result;
}

const cache = new Map<string, { mtime: number; classes: VcxClass[] }>();

export function readVcx(vcxPath: string): VcxClass[] {
  const stat = fs.statSync(vcxPath);
  const hit = cache.get(vcxPath);
  if (hit && hit.mtime === stat.mtimeMs) return hit.classes;
  const { records } = readDbf(vcxPath);
  const classes = buildVcxClasses(vcxPath, records);
  cache.set(vcxPath, { mtime: stat.mtimeMs, classes });
  return classes;
}

export function vcxContent(uri: string): string | undefined {
  const parsed = parseVcxUri(uri);
  if (!parsed) return undefined;
  try {
    const cls = readVcx(parsed.vcxPath).find((c) => c.name.toLowerCase() === parsed.className.toLowerCase());
    return cls?.text;
  } catch {
    return undefined;
  }
}

export function vcxEntries(vcxPath: string, layer: LayerInfo): FileEntry[] {
  return readVcx(vcxPath).map((c) => {
    const uri = vcxClassUri(vcxPath, c.name);
    const parsed = parsePrg(c.text, uri);
    for (const cls of parsed.classes) cls.fileType = 'vcx';
    return { uri, parsed, layer, lookupName: vcxPath };
  });
}
