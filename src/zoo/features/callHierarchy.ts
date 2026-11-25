import * as fs from 'fs';
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, SymbolKind } from 'vscode-languageserver-types';
import { buildCursorContext, decodePrg, findEnclosingCall, logicalLineAt, splitLines, scanLines, toPosition, uriToPath } from 'asistente-vfp-core';
import type { CursorContext, HostApi, MemberEntry, ResolvedTarget, Rng } from 'asistente-vfp-core';
import type { ZooState } from '../state';
import { contextAt } from './context';
import { findReferences } from './references';

interface ItemData {
  uri: string;
  line: number;
  name: string;
  className?: string;
}

const CALL_RE = /([A-Za-z_]\w*)\s*\(/g;

function isCallable(m: MemberEntry): boolean {
  return m.decl.kind === 'method' || m.decl.kind === 'procedure' || m.decl.kind === 'function';
}

function contains(r: Rng, s: Rng): boolean {
  const before = (a: Rng['start'], b: Rng['start']) => a.line < b.line || (a.line === b.line && a.character <= b.character);
  return before(r.start, s.start) && before(s.end, r.end);
}

function toItem(m: MemberEntry): CallHierarchyItem {
  const d = m.decl;
  const owner = m.owner?.decl.name ?? d.className;
  const data: ItemData = { uri: d.uri, line: d.nameRange.start.line, name: d.name, className: owner };
  return {
    name: d.name,
    kind: d.kind === 'method' ? SymbolKind.Method : SymbolKind.Function,
    uri: d.uri,
    range: contains(d.range, d.nameRange) ? d.range : d.nameRange,
    selectionRange: d.nameRange,
    detail: owner ? `${owner} · ${m.layer.label}` : m.layer.label,
    data,
  };
}

function keyOf(m: MemberEntry): string {
  return `${m.decl.uri}#${m.decl.nameRange.start.line}#${m.decl.name.toLowerCase()}`;
}

/** Reconstruye el miembro de un item (por clase, archivo y línea). */
function entryOf(item: CallHierarchyItem, api: HostApi): MemberEntry | undefined {
  const d = item.data as ItemData | undefined;
  if (!d) return undefined;
  const lower = d.name.toLowerCase();
  if (d.className) {
    for (const c of api.index.classEntries(d.className, { includeDownstream: true })) {
      if (c.decl.uri !== d.uri) continue;
      const decl = c.decl.members.find((m) => m.name.toLowerCase() === lower && m.nameRange.start.line === d.line);
      if (decl) return { decl, owner: c, layer: c.layer };
    }
  }
  return api.index.procedures(d.name).find((p) => p.decl.uri === d.uri && p.decl.nameRange.start.line === d.line);
}

/** Método o procedimiento que contiene una línea de un archivo indexado. */
function containerAt(api: HostApi, uri: string, line: number): MemberEntry | undefined {
  const f = api.index.getFile(uri);
  if (!f) return undefined;
  for (const c of f.parsed.classes) {
    if (line < c.range.start.line || line > c.range.end.line) continue;
    const decl = c.members.find((m) => (m.kind === 'method' || m.kind === 'procedure' || m.kind === 'function') && m.range.start.line <= line && line <= m.range.end.line);
    if (!decl) return undefined;
    const owner = api.index.classEntries(c.name, { includeDownstream: true }).find((e) => e.decl.uri === uri);
    return { decl, owner, layer: owner?.layer ?? f.layer };
  }
  const p = f.parsed.procedures.find((m) => m.range.start.line <= line && line <= m.range.end.line);
  return p ? { decl: p, layer: f.layer } : undefined;
}

async function textOf(api: HostApi, uri: string): Promise<string | undefined> {
  const t = await api.getText(uri).catch(() => undefined);
  if (t !== undefined) return t;
  try {
    return decodePrg(await fs.promises.readFile(uriToPath(uri)));
  } catch {
    return undefined;
  }
}

/** Shift+Alt+H: método o procedimiento bajo el cursor (resuelto sin heurística). */
export function prepareCallHierarchy(ctx: CursorContext, api: HostApi): CallHierarchyItem[] {
  const t = api.resolver.resolveAt(ctx);
  if (!t || (t.kind !== 'member' && t.kind !== 'procedure') || t.heuristic || !t.members?.length) return [];
  const m = t.members[0];
  return isCallable(m) ? [toItem(m)] : [];
}

/** Quién llama: referencias exactas agrupadas por método, más los `dodefault()` de los overrides. */
export async function incomingCalls(item: CallHierarchyItem, state: ZooState, api: HostApi): Promise<CallHierarchyIncomingCall[]> {
  const m = entryOf(item, api);
  if (!m) return [];
  const groups = new Map<string, CallHierarchyIncomingCall>();
  const add = (from: MemberEntry, range: Rng) => {
    const k = keyOf(from);
    const g = groups.get(k);
    if (g) g.fromRanges.push(range);
    else groups.set(k, { from: toItem(from), fromRanges: [range] });
  };

  const target: ResolvedTarget = { kind: m.owner ? 'member' : 'procedure', word: m.decl.name, range: m.decl.nameRange, members: [m] };
  const refs = await findReferences(target, state, api, false);
  for (const loc of refs.exact) {
    const from = containerAt(api, loc.uri, loc.range.start.line);
    if (from) add(from, loc.range);
  }

  // dodefault() en los overrides cuyo método padre más cercano es este.
  if (m.owner) {
    for (const o of api.index.overrides(m.owner.decl.name, m.decl.name)) {
      if (!o.owner) continue;
      const parent = api.index.findInAncestors(o.owner, m.decl.name);
      if (!parent || keyOf(parent) !== keyOf(m)) continue;
      const text = await textOf(api, o.decl.uri);
      if (!text) continue;
      const lines = splitLines(text);
      const scanned = scanLines(lines);
      for (let line = o.decl.range.start.line; line <= o.decl.range.end.line && line < lines.length; line++) {
        const s = scanned[line];
        if (s.isComment || s.isText) continue;
        const re = /\bdodefault\s*\(/gi;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(s.code))) {
          if (s.commentStart >= 0 && mm.index >= s.commentStart) continue;
          add(o, { start: { line, character: mm.index }, end: { line, character: mm.index + 'dodefault'.length } });
        }
      }
    }
  }
  return [...groups.values()];
}

/** A quién llama: cada `nombre(` del cuerpo resuelto sin heurística (nativas y dudosas afuera). */
export async function outgoingCalls(item: CallHierarchyItem, api: HostApi): Promise<CallHierarchyOutgoingCall[]> {
  const m = entryOf(item, api);
  if (!m) return [];
  const f = api.index.getFile(m.fileUri ?? m.decl.uri);
  const text = await textOf(api, m.decl.uri);
  if (!f || !text) return [];
  const range = m.decl.range;
  const base = buildCursorContext(m.decl.uri, text, f.parsed, range.start, api.index, f.layer);
  const groups = new Map<string, CallHierarchyOutgoingCall>();
  const seenLl = new Set<number>();
  for (let line = range.start.line; line <= range.end.line && line < base.lines.length; line++) {
    const s = base.scanned[line];
    if (!s || s.isComment || s.isText) continue;
    const ll = logicalLineAt(base.scanned, line);
    if (!ll || seenLl.has(ll.startLine) || ll.startLine === m.decl.nameRange.start.line) continue;
    seenLl.add(ll.startLine);
    CALL_RE.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = CALL_RE.exec(ll.masked))) {
      const open = mm.index + mm[0].length - 1;
      const call = findEnclosingCall(ll, open + 1);
      if (!call || call.openIdx !== open) continue;
      const ctx = contextAt(base, toPosition(ll, call.calleeStart), ll, call.calleeStart, api.index, f);
      const candidates = api.resolver.resolveCall(call, ctx);
      if (!candidates.length) continue;
      const heuristic = candidates.length > 1 || !!(call.chain && !api.resolver.resolveChainType(call.chain, ctx));
      if (heuristic || !isCallable(candidates[0])) continue;
      const to = candidates[0];
      const r = { start: toPosition(ll, call.calleeStart), end: toPosition(ll, call.calleeStart + call.callee.length) };
      const k = keyOf(to);
      const g = groups.get(k);
      if (g) g.fromRanges.push(r);
      else groups.set(k, { to: toItem(to), fromRanges: [r] });
    }
  }
  return [...groups.values()];
}
