import { CompletionItem, CompletionItemKind, CompletionItemTag, InsertTextFormat, MarkupKind } from 'vscode-languageserver-types';
import { chainBefore, docToMarkdown, findEnclosingCall, memberSignature, splitTopLevel } from 'asistente-vfp-core';
import type { CursorContext, HostApi, MemberEntry } from 'asistente-vfp-core';
import type { ZooState } from '../state';

function kindOf(m: MemberEntry): CompletionItemKind {
  switch (m.decl.kind) {
    case 'method':
      return CompletionItemKind.Method;
    case 'object':
      return CompletionItemKind.Field;
    default:
      return CompletionItemKind.Property;
  }
}

/** Visibilidad: `protected` solo dentro de la jerarquía; `hidden` solo en la propia clase. */
function visible(m: MemberEntry, ctx: CursorContext, api: HostApi): boolean {
  if (m.decl.visibility === 'public') return true;
  if (!ctx.cls) return false;
  const owner = m.owner?.decl.name.toLowerCase();
  if (m.decl.visibility === 'hidden') return owner === ctx.cls.decl.name.toLowerCase();
  return api.index.hierarchyNames(ctx.cls).some((n) => n.toLowerCase() === owner);
}

/** F9: miembros después de `.` cuando se conoce el tipo del receptor. */
export function memberCompletion(ctx: CursorContext, api: HostApi): CompletionItem[] | undefined {
  const ll = ctx.ll;
  if (!ll || ctx.offset < 0) return undefined;
  const before = ll.masked.substring(0, ctx.offset);
  const m = /\.\s*(\w*)$/.exec(before);
  if (!m) return undefined;
  const dot = before.length - m[0].length;
  let chain = chainBefore(ll.masked, dot);
  if (chain && chain.length === 0) chain = api.resolver.withChain(ctx);
  if (!chain || chain.length === 0) return undefined;
  if (chain.length === 1 && chain[0].toLowerCase() === 'm') return undefined;
  const type = api.resolver.resolveChainType(chain, ctx);
  if (!type) return undefined;
  const after = ll.masked.substring(ctx.offset);
  const parenFollows = /^\w*\s*\(/.test(after);
  const items = new Map<string, CompletionItem>();
  type.classNames.forEach((cn, typeIdx) => {
    api.index.allMembers(cn, { fromUri: ctx.uri }).forEach((entry) => {
      if (!visible(entry, ctx, api)) return;
      const key = entry.decl.name.toLowerCase();
      if (items.has(key) || /_(access|assign)$/i.test(entry.decl.name)) return;
      const { doc, inheritedFrom } = api.index.effectiveDoc(entry);
      const docParts: string[] = [];
      if (doc) docParts.push(docToMarkdown(doc));
      if (inheritedFrom) docParts.push(`_Doc heredada de ${inheritedFrom}._`);
      docParts.push(`_${entry.owner?.decl.name ?? ''} · ${entry.layer.label}_`);
      const isMethod = entry.decl.kind === 'method';
      const ownerIsType = entry.owner?.decl.name.toLowerCase() === cn.toLowerCase();
      const item: CompletionItem = {
        label: entry.decl.name,
        kind: kindOf(entry),
        detail: memberSignature(entry.decl),
        documentation: { kind: MarkupKind.Markdown, value: docParts.join('\n\n') },
        sortText: `${typeIdx}${ownerIsType ? 0 : 1}${entry.decl.visibility === 'public' ? 0 : 1}${entry.decl.name.toLowerCase()}`,
        tags: doc?.deprecated ? [CompletionItemTag.Deprecated] : undefined,
      };
      if (isMethod && !parenFollows) {
        item.insertText = `${entry.decl.name}($0)`;
        item.insertTextFormat = InsertTextFormat.Snippet;
        item.command = { title: 'Parámetros', command: 'editor.action.triggerParameterHints' };
      }
      items.set(key, item);
    });
  });
  return [...items.values()];
}

/** F9b: nombres válidos dentro del literal de una fábrica. */
export function factoryLiteralCompletion(ctx: CursorContext, state: ZooState): CompletionItem[] | undefined {
  const ll = ctx.ll;
  if (!ll || ctx.offset < 0) return undefined;
  const str = ll.strings.find((s) => ctx.offset > s.start && ctx.offset <= s.end);
  if (!str) return undefined;
  const call = findEnclosingCall(ll, str.start);
  if (!call) return undefined;
  const rule = state.factories.ruleFor(call.callee);
  if (!rule || (rule.arg ?? 0) !== call.argIndex || rule.prefixListArg !== undefined) return undefined;
  const products = state.products();
  const values = state.factories.completionValues(rule, products);
  const closeIdx = call.closeIdx < 0 ? ll.masked.length : call.closeIdx;
  const literals = splitTopLevel(ll.masked, call.openIdx + 1, closeIdx).map(() => undefined as string | undefined);
  const start = { line: ctx.position.line, character: ctx.position.character - (ctx.offset - str.start - 1) };
  const contentEnd = str.end - (ll.code[str.end - 1] === ll.code[str.start] || ll.code[str.end - 1] === ']' ? 1 : 0);
  const end = { line: ctx.position.line, character: ctx.position.character + (contentEnd - ctx.offset) };
  return values.slice(0, 2000).map((x) => {
    literals[rule.arg ?? 0] = x;
    const res = state.resolveFactory(rule, literals);
    const efectiva = res.efectiva;
    return {
      label: x,
      kind: CompletionItemKind.Class,
      detail: efectiva ? `→ ${efectiva.name} (${efectiva.entries[0].layer.label})` : undefined,
      textEdit: { range: { start, end }, newText: x },
      filterText: x,
    };
  });
}
