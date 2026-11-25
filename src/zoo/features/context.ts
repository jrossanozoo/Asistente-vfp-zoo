import type { CursorContext, FileEntry, LayerInfo, LogicalLine, SymbolIndex } from 'asistente-vfp-core';

/**
 * Reutiliza el contexto de un archivo (líneas ya escaneadas) para otra posición.
 * Evita re-escanear el archivo por cada palabra (References, Inlay Hints, Highlight, Call Hierarchy).
 */
export function contextAt(
  base: CursorContext,
  position: { line: number; character: number },
  ll: LogicalLine,
  offset: number,
  index: SymbolIndex,
  file: FileEntry | { layer: LayerInfo },
): CursorContext {
  const line = position.line;
  const clsDecl = base.parsed.classes.find((c) => c.range.start.line <= line && line <= c.range.end.line);
  const cls = clsDecl
    ? (index.classEntries(clsDecl.name, { includeDownstream: true }).find((e) => e.decl.uri === base.uri) ?? { decl: clsDecl, layer: file.layer })
    : undefined;
  const pool = clsDecl ? clsDecl.members : base.parsed.procedures;
  const member = pool.find((mm) => mm.kind !== 'property' && mm.kind !== 'object' && mm.range.start.line <= line && line <= mm.range.end.line);
  return { ...base, position, ll, offset, cls, member };
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
