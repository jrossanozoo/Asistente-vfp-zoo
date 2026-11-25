import { DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver-types';
import { logicalLineAt, toOffset } from 'asistente-vfp-core';
import type { CursorContext, HostApi, ResolvedTarget, Rng } from 'asistente-vfp-core';
import type { ZooState } from '../state';
import { escapeRe } from './context';
import { findReferences } from './references';

const DECL_RE = /\b(local|public|private|lparameters|parameters)\b/i;

/**
 * E1.3: usos del símbolo bajo el cursor en el archivo actual.
 * Misma semántica que Find References (receptor de la jerarquía), limitada al documento.
 */
export async function documentHighlights(ctx: CursorContext, state: ZooState, api: HostApi): Promise<DocumentHighlight[]> {
  const target = api.resolver.resolveAt(ctx);
  if (!target || target.kind === 'none' || target.kind === 'file' || target.heuristic) return [];
  if (/^(this|thisform|thisformset)$/i.test(target.word)) return [];
  if (target.kind === 'variable') return variableHighlights(ctx, target);
  const refs = await findReferences(target, state, api, true, { onlyUri: ctx.uri });
  const seen = new Set<string>();
  const out: DocumentHighlight[] = [];
  for (const l of refs.exact) {
    if (l.uri !== ctx.uri) continue;
    const key = `${l.range.start.line}:${l.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(DocumentHighlight.create(l.range, kindAt(ctx, l.range)));
  }
  return out.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
}

/** `Write` si es el lado izquierdo de una asignación; `Text` en una declaración; `Read` en el resto. */
function kindAt(ctx: CursorContext, r: Rng): DocumentHighlightKind {
  const text = ctx.lines[r.start.line] ?? '';
  const before = text.substring(0, r.start.character);
  const after = text.substring(r.end.character);
  if (/^\s*=(?!=)/.test(after) && /^\s*((m|this)\s*\.\s*|\.\s*)?$/i.test(before)) return DocumentHighlightKind.Write;
  if (DECL_RE.test(before) && !/[=(]/.test(before)) return DocumentHighlightKind.Text;
  return DocumentHighlightKind.Read;
}

/** Variables: locales y parámetros dentro de su método; globales (`go*`) en todo el archivo. */
function variableHighlights(ctx: CursorContext, target: ResolvedTarget): DocumentHighlight[] {
  const word = target.word;
  const global = !target.variable && /^g/i.test(word);
  const scope = !global && ctx.member ? ctx.member.range : { start: { line: 0, character: 0 }, end: { line: ctx.lines.length - 1, character: 0 } };
  const re = new RegExp(`\\b${escapeRe(word)}\\b`, 'gi');
  const out: DocumentHighlight[] = [];
  for (let line = scope.start.line; line <= scope.end.line && line < ctx.lines.length; line++) {
    const s = ctx.scanned[line];
    if (s.isComment || s.isText) continue;
    const lineText = ctx.lines[line];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText))) {
      if (s.commentStart >= 0 && m.index >= s.commentStart) continue;
      const ll = logicalLineAt(ctx.scanned, line);
      if (!ll) continue;
      const offset = toOffset(ll, line, m.index);
      if (ll.strings.some((st) => offset > st.start && offset < st.end)) continue;
      const before = ll.masked.substring(0, offset);
      if (/\.\s*$/.test(before) && !/\bm\s*\.\s*$/i.test(before)) continue;
      const range = { start: { line, character: m.index }, end: { line, character: m.index + word.length } };
      out.push(DocumentHighlight.create(range, kindAt(ctx, range)));
    }
  }
  return out;
}
