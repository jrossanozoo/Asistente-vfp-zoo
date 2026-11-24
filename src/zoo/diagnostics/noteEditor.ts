import type { MemberDecl, Rng } from 'asistente-vfp-core';

/** Edición de bloques NOTE respetando la regla de `;`: todas las líneas menos la última terminan en `;`. */

const HEADER_PARAMS = /^\s*(?:par[aá]metros|parameters|params)\s*:/i;
const HEADER_OTHER = /^\s*(?:retorna|retorno|devuelve|returns?|ejemplo|example)\s*:/i;

function stripSemicolon(line: string): string {
  return line.replace(/\s*;\s*$/, '');
}

export function normalizeContinuations(lines: string[]): string[] {
  return lines.map((l, i) => {
    const base = stripSemicolon(l).replace(/\s+$/, '');
    return i < lines.length - 1 ? `${base} ;` : base;
  });
}

export function leadingWhitespace(line: string): string {
  return /^\s*/.exec(line)![0];
}

/** Genera un NOTE a partir de la firma. */
export function generateNote(member: MemberDecl, indent: string, category = 'Categoria'): string[] {
  const rows: string[] = [`${indent}NOTE\t[${category}] Resumen de qué hace.`];
  const cont = `${indent}\t\t`;
  if (member.params.length) {
    rows.push(`${cont}Parametros:`);
    for (const p of member.params) rows.push(`${cont}\t${p.name} - Descripción.`);
  }
  if (member.returnType && member.returnType.toLowerCase() !== 'void') {
    rows.push(`${cont}Retorna: ${member.returnType} - Descripción.`);
  }
  return normalizeContinuations(rows);
}

/** Agrega filas de parámetros faltantes a un bloque existente. */
export function addParamRows(blockLines: string[], names: string[]): string[] {
  const lines = blockLines.map(stripSemicolon);
  const indent = leadingWhitespace(lines[0]);
  const cont = lines.length > 1 ? leadingWhitespace(lines[1]) || `${indent}\t\t` : `${indent}\t\t`;
  const headerIdx = lines.findIndex((l) => HEADER_PARAMS.test(l));
  if (headerIdx >= 0) {
    let last = headerIdx;
    for (let i = headerIdx + 1; i < lines.length && !HEADER_OTHER.test(lines[i]); i++) last = i;
    const rowIndent = last > headerIdx ? leadingWhitespace(lines[last]) : `${leadingWhitespace(lines[headerIdx])}\t`;
    lines.splice(last + 1, 0, ...names.map((n) => `${rowIndent}${n} - Descripción.`));
  } else {
    const otherIdx = lines.findIndex((l, i) => i > 0 && HEADER_OTHER.test(l));
    const at = otherIdx >= 0 ? otherIdx : lines.length;
    lines.splice(at, 0, `${cont}Parametros:`, ...names.map((n) => `${cont}\t${n} - Descripción.`));
  }
  return normalizeContinuations(lines);
}

/** Antepone `[Categoría]` en la primera línea. */
export function prependCategory(firstLine: string, category: string): string {
  const m = /^(\s*note\s+)(\[[^\]]*\]\s*)?(.*)$/i.exec(firstLine);
  if (!m) return firstLine;
  return `${m[1]}[${category}] ${m[3]}`;
}

export function fullLinesRange(start: number, end: number, lastLineLength: number): Rng {
  return { start: { line: start, character: 0 }, end: { line: end, character: lastLineLength } };
}
