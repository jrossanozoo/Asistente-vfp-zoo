import { InlayHint, InlayHintKind, InlayHintLabelPart, Location, MarkupKind } from 'vscode-languageserver-types';
import { findEnclosingCall, logicalLineAt, splitTopLevel, toPosition } from 'asistente-vfp-core';
import type { CursorContext, HostApi, LayerInfo, LogicalLine, Rng } from 'asistente-vfp-core';
import type { ZooState } from '../state';
import { contextAt } from './context';

const FALLBACK_LAYER: LayerInfo = { id: 'workspace', label: 'Workspace', priority: 0, role: 'source' };

/** Lado izquierdo de una asignación: `loX`, `m.loX`, `this.oX`, `.oX` (WITH). */
const ASSIGN_RE = /^(\s*)((?:m\.)?\w+|this\.\w+|\.\w+)\s*=(?!=)/i;
const CALL_RE = /([A-Za-z_]\w*)\s*\(/g;

/**
 * E1.2: inlay hints del rango visible.
 * - Tipo deducido después del lado izquierdo de una asignación (`this.oMensajes‹: Mensajes›`).
 * - Nombre de parámetro antes de cada argumento (opcional), solo con el método resuelto sin heurística.
 */
export function inlayHints(base: CursorContext, range: Rng, state: ZooState, api: HostApi): InlayHint[] {
  const s = state.settings;
  const out: InlayHint[] = [];
  if (!s.inlayHintsTypes && !s.inlayHintsParameterNames) return out;
  const file = { layer: api.index.getFile(base.uri)?.layer ?? FALLBACK_LAYER };
  const seen = new Set<number>();
  const last = Math.min(range.end.line, base.lines.length - 1);
  for (let line = Math.max(0, range.start.line); line <= last; line++) {
    const sc = base.scanned[line];
    if (!sc || sc.isComment || sc.isText) continue;
    const ll = logicalLineAt(base.scanned, line);
    if (!ll || seen.has(ll.startLine)) continue;
    seen.add(ll.startLine);
    if (s.inlayHintsTypes) {
      const h = typeHint(base, ll, api, file);
      if (h) out.push(h);
    }
    if (s.inlayHintsParameterNames) out.push(...parameterHints(base, ll, api, file));
  }
  return out;
}

function typeHint(base: CursorContext, ll: LogicalLine, api: HostApi, file: { layer: LayerInfo }): InlayHint | undefined {
  const m = ASSIGN_RE.exec(ll.masked);
  if (!m) return undefined;
  const end = m[1].length + m[2].length;
  const ctx = contextAt(base, toPosition(ll, end - 1), ll, end - 1, api.index, file);
  const type = api.resolver.typeAt(ctx);
  if (!type?.classNames.length) return undefined;
  const classes = type.classNames.map((n) => api.index.getClass(n, { fromUri: base.uri })).filter((c) => !!c);
  if (!classes.length) return undefined;
  const first = classes[0]!;
  const tooltip = {
    kind: MarkupKind.Markdown,
    value: [
      `**Tipo deducido:** ${classes.map((c) => `\`${c!.decl.name}\``).join(' | ')}`,
      type.note ? `_${type.note}_` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
  const label: InlayHintLabelPart[] = [
    { value: ': ' },
    { value: first.decl.name, location: Location.create(first.decl.uri, first.decl.nameRange), tooltip },
  ];
  if (classes.length > 1) label.push({ value: ` +${classes.length - 1}`, tooltip });
  return { position: toPosition(ll, end), label, kind: InlayHintKind.Type };
}

function parameterHints(base: CursorContext, ll: LogicalLine, api: HostApi, file: { layer: LayerInfo }): InlayHint[] {
  const out: InlayHint[] = [];
  const masked = ll.masked;
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const call = findEnclosingCall(ll, open + 1);
    if (!call || call.openIdx !== open) continue;
    const ctx = contextAt(base, toPosition(ll, call.calleeStart), ll, call.calleeStart, api.index, file);
    const candidates = api.resolver.resolveCall(call, ctx);
    if (!candidates.length) continue;
    const heuristic = candidates.length > 1 || !!(call.chain && !api.resolver.resolveChainType(call.chain, ctx));
    if (heuristic) continue;
    const params = candidates[0].decl.params;
    if (!params.length) continue;
    const close = call.closeIdx < 0 ? masked.length : call.closeIdx;
    const args = splitTopLevel(masked, open + 1, close);
    args.forEach((part, i) => {
      if (i >= params.length) return;
      const raw = ll.code.substring(part.start, part.end);
      const text = raw.trim();
      if (!text) return;
      const pname = params[i].name;
      if (text.toLowerCase().endsWith(pname.toLowerCase())) return;
      const start = part.start + (raw.length - raw.trimStart().length);
      out.push({ position: toPosition(ll, start), label: `${pname}:`, kind: InlayHintKind.Parameter, paddingRight: true });
    });
  }
  return out;
}
