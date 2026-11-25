import * as fs from 'fs';
import { Location } from 'vscode-languageserver-types';
import {
  buildCursorContext,
  decodePrg,
  findEnclosingCall,
  logicalLineAt,
  scanLines,
  splitLines,
  toOffset,
  uriToPath,
  wordAt,
} from 'asistente-vfp-core';
import type { ClassEntry, CursorContext, FileEntry, HostApi, LogicalLine, MemberEntry, ParsedFile, ResolvedTarget, SymbolIndex } from 'asistente-vfp-core';
import { isGeneratedPath, isMockPath, ZooState } from '../state';

export interface ReferenceResult {
  exact: Location[];
  heuristic: Location[];
}

/** Reutiliza el contexto de un archivo (líneas ya escaneadas) para otra posición. */
function contextAt(
  base: CursorContext,
  position: { line: number; character: number },
  ll: LogicalLine,
  offset: number,
  index: SymbolIndex,
  file: FileEntry,
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * F3: referencias a una clase o a un método.
 * Clase: `AS Clase`, `DEFINE CLASS … AS Clase`, literales de fábrica que la resuelven, createobject("Clase").
 * Método: llamadas `x.Metodo(` cuyo receptor se infiere de la jerarquía (exactas) o se desconoce (heurísticas).
 */
export async function findReferences(
  target: ResolvedTarget,
  state: ZooState,
  api: HostApi,
  includeDeclaration: boolean,
): Promise<ReferenceResult> {
  const result: ReferenceResult = { exact: [], heuristic: [] };
  const index = api.index;
  const settings = state.settings;
  let name: string;
  let classTarget: ClassEntry | undefined;
  let memberTarget: MemberEntry | undefined;
  if (target.kind === 'class' && target.classes?.length) {
    classTarget = target.classes[0];
    name = classTarget.decl.name;
    if (includeDeclaration) result.exact.push(Location.create(classTarget.decl.uri, classTarget.decl.nameRange));
  } else if (target.kind === 'member' && target.members?.length && target.members[0].owner && !target.heuristic) {
    memberTarget = target.members[0];
    name = memberTarget.decl.name;
    if (includeDeclaration) result.exact.push(Location.create(memberTarget.decl.uri, memberTarget.decl.nameRange));
  } else if ((target.kind === 'procedure' || target.kind === 'member') && target.members?.length) {
    memberTarget = target.members[0];
    name = memberTarget.decl.name;
  } else {
    return result;
  }

  // Jerarquía relevante para métodos: el dueño, sus ancestros y sus subclases.
  const related = new Set<string>();
  if (memberTarget?.owner) {
    related.add(memberTarget.owner.decl.name.toLowerCase());
    for (const a of index.ancestors(memberTarget.owner)) related.add(a.decl.name.toLowerCase());
    for (const d of index.descendants(memberTarget.owner.decl.name)) related.add(d.decl.name.toLowerCase());
  }

  const needle = name.toLowerCase();
  const wordRe = new RegExp(`\\b${escapeRe(name)}\\b`, 'gi');
  const files: FileEntry[] = [];
  for (const f of index.allFiles()) {
    if (!f.uri.startsWith('file:')) continue;
    if (f.parsed.headersOnly && !settings.referencesIncludeGenerated) continue;
    if (!settings.referencesIncludeGenerated && isGeneratedPath(uriToPath(f.uri))) continue;
    if (!settings.referencesIncludeMocks && isMockPath(uriToPath(f.uri))) continue;
    files.push(f);
  }

  for (const f of files) {
    let text = await api.getText(f.uri).catch(() => undefined);
    if (text === undefined) {
      try {
        text = decodePrg(await fs.promises.readFile(uriToPath(f.uri)));
      } catch {
        continue;
      }
    }
    if (!text.toLowerCase().includes(needle)) continue;
    const lines = splitLines(text);
    const scanned = scanLines(lines);
    const parsed: ParsedFile = f.parsed;
    let base: CursorContext | undefined;
    lines.forEach((lineText, lineNo) => {
      const s = scanned[lineNo];
      if (s.isComment || s.isText) return;
      wordRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(lineText))) {
        const ll = logicalLineAt(scanned, lineNo);
        if (!ll) continue;
        const offset = toOffset(ll, lineNo, m.index);
        if (s.commentStart >= 0 && m.index >= s.commentStart) continue;
        const range = { start: { line: lineNo, character: m.index }, end: { line: lineNo, character: m.index + name.length } };
        const loc = Location.create(f.uri, range);
        const inString = ll.strings.find((st) => offset > st.start && offset < st.end);
        const before = ll.masked.substring(0, offset);

        if (classTarget) {
          if (inString) {
            if (inString.value.toLowerCase() !== needle && !inString.value.toLowerCase().includes(needle)) continue;
            const call = findEnclosingCall(ll, inString.start);
            if (!call) continue;
            const rule = state.factories.ruleFor(call.callee);
            if (!rule) continue;
            // El literal puede ser el nombre corto (X) de la fábrica: se resuelve y se compara.
            const lits: (string | undefined)[] = [];
            lits[rule.arg ?? 0] = inString.value;
            const res = state.resolveFactory(rule, lits);
            const all = new Set([...res.found.map((x) => x.name.toLowerCase()), ...res.porProducto.map((p) => p.efectiva?.name.toLowerCase())]);
            if (all.has(needle)) result.exact.push(loc);
            continue;
          }
          if (/\b(as|of)\s+$/i.test(before) || /\bdefine\s+class\s+\w+\s+as\s+$/i.test(before)) {
            if (f.uri === classTarget.decl.uri && range.start.line === classTarget.decl.nameRange.start.line) continue;
            result.exact.push(loc);
          } else if (!/\.\s*$/.test(before) && !/^\s*define\s+class\s+$/i.test(before)) {
            result.heuristic.push(loc);
          }
          continue;
        }

        // Método / procedimiento
        if (inString) continue;
        if (memberTarget && f.uri === memberTarget.decl.uri && range.start.line === memberTarget.decl.nameRange.start.line) continue;
        const dot = /\.\s*$/.test(before);
        if (!dot) {
          // Declaración de un override, o llamada a un procedimiento suelto.
          if (/\b(function|procedure|func|proc)\s+$/i.test(before)) continue;
          if (!memberTarget?.owner && /^\s*\(/.test(ll.masked.substring(offset + name.length))) result.exact.push(loc);
          continue;
        }
        if (!memberTarget?.owner) continue;
        const position = { line: lineNo, character: m.index + 1 };
        if (!base) base = buildCursorContext(f.uri, text!, parsed, position, index, f.layer);
        const ctx = contextAt(base, position, ll, offset + 1, index, f);
        const w = wordAt(lineText, m.index + 1);
        if (!w) continue;
        const t = api.resolver.resolveAt(ctx);
        if (t?.kind === 'member' && !t.heuristic && t.members?.length) {
          const owner = t.members[0].owner?.decl.name.toLowerCase();
          if (owner && related.has(owner)) result.exact.push(loc);
        } else if (t?.kind === 'member' && t.heuristic) {
          if (t.receiverType) {
            // Tipo conocido pero sin el miembro: no es esta jerarquía.
            if (t.receiverType.classNames.some((cn) => related.has(cn.toLowerCase()))) result.exact.push(loc);
          } else if (settings.referencesIncludeHeuristic) {
            result.heuristic.push(loc);
          }
        }
      }
    });
  }
  return result;
}
