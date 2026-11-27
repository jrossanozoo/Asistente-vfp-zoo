import { CompletionItem, CompletionItemKind, CompletionItemTag, InsertTextFormat, InsertTextMode, MarkupKind } from 'vscode-languageserver-types';
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

const SEPARATOR = '*' + '-'.repeat(89);
const DEFINE_CLASS_RE = /^\s*define\s+class\b/i;
const ENDDEFINE_RE = /^\s*enddefine\b/i;
const IF_FALSE_RE = /^\s*#if\s+\.f\.\s*$/i;
const IF_RE = /^\s*#if\b/i;
const ELSE_RE = /^\s*#else\b/i;
const ENDIF_RE = /^\s*#endif\b/i;

/** Dónde está el cursor para las plantillas: dentro de una clase (con la indentación del `define class`) o no. */
interface TemplateContext {
  inClass: boolean;
  classIndent: string;
}

/**
 * Escanea desde el principio hasta la línea del cursor: el último `define class` / `enddefine` define el contexto.
 * No depende del rango del parser (mientras se escribe suele faltar el `enddefine`). Ignora comentarios, `NOTE …;`,
 * `TEXT … ENDTEXT` (ya marcados por el scanner) y bloques `#if .f. … #endif`. undefined = el cursor está en un bloque
 * desactivado.
 */
function templateContext(ctx: CursorContext): TemplateContext | undefined {
  let inClass = false;
  let classIndent = '';
  let disabledDepth = 0;
  for (let line = 0; line <= ctx.position.line && line < ctx.scanned.length; line++) {
    const s = ctx.scanned[line];
    if (s.isComment || s.isText) continue;
    const code = s.code;
    if (disabledDepth > 0) {
      if (IF_RE.test(code)) disabledDepth++;
      else if (ENDIF_RE.test(code)) disabledDepth--;
      else if (disabledDepth === 1 && ELSE_RE.test(code)) disabledDepth = 0;
      continue;
    }
    if (line === ctx.position.line) break;
    if (IF_FALSE_RE.test(code)) disabledDepth = 1;
    else if (DEFINE_CLASS_RE.test(code)) {
      inClass = true;
      classIndent = /^\s*/.exec(s.text)![0];
    } else if (ENDDEFINE_RE.test(code)) inClass = false;
  }
  return disabledDepth > 0 ? undefined : { inClass, classIndent };
}

interface Template {
  label: string;
  /** Palabras que lo ofrecen (lo escrito tiene que ser prefijo de alguna). */
  keywords: string[];
  /** Cuerpo sin indentar; cada línea se prefija con la indentación del contexto. */
  lines: string[];
  preselect?: boolean;
  sort: string;
}

/** Texto del snippet con los valores por defecto (para la vista previa). */
function snippetPreview(snippet: string): string {
  let out = snippet.replace(/\$\{\d+\|([^,|}]*)[^}]*\}/g, '$1').replace(/\$0/g, '');
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\$\{\d+:([^{}]*)\}/g, '$1');
  }
  return out;
}

function noteChoices(state: ZooState): string {
  // Las opciones de un choice de snippet no admiten `,` ni `|` sin escapar.
  return state.settings.noteCategories.map((c) => c.replace(/[,|\\]/g, (ch) => `\\${ch}`)).join(',');
}

function templatesFor(inClass: boolean, state: ZooState): Template[] {
  const fnBody = (kw: string, end: string) => [
    `${kw} \${1:Nombre}( \${2:tcParametro} as \${3:String} ) as \${4:Void}`,
    '\t$0',
    end,
  ];
  const note = [
    `NOTE\t[\${1|${noteChoices(state)}|}] \${2:Resumen}. ;`,
    '\t\tParametros: ;',
    '\t\t\t${4:tcParametro} - ${5:Descripción}. ;',
    '\t\tRetorna: ${6:Void} - ${7:Descripción}.',
    'function ${3:Nombre}( ${4:tcParametro} as String ) as ${6:Void}',
    '\t$0',
    'endfunc',
  ];
  if (!inClass) {
    return [
      {
        label: 'define class (Organic)',
        keywords: ['define', 'class'],
        lines: ['define class ${1:Nombre} as ${2:custom}${3: of ${4:archivo}.prg}', '', '\t$0', '', 'enddefine'],
        preselect: true,
        sort: '0_define_class',
      },
      { label: 'function (Organic)', keywords: ['function'], lines: fnBody('function', 'endfunc'), sort: '0_function' },
      { label: 'procedure (Organic)', keywords: ['procedure'], lines: fnBody('procedure', 'endproc'), sort: '0_procedure' },
      { label: 'funcnote (Organic)', keywords: ['funcnote'], lines: [SEPARATOR, ...note], sort: '0_funcnote' },
    ];
  }
  const method = (prefix: string, kw: string, end: string): string[] => [SEPARATOR, ...fnBody(`${prefix}${kw}`, end)];
  return [
    { label: 'function – método (Organic)', keywords: ['function'], lines: method('', 'function', 'endfunc'), preselect: true, sort: '0_function' },
    { label: 'protected function – método (Organic)', keywords: ['protected', 'function'], lines: method('protected ', 'function', 'endfunc'), sort: '0_function_protected' },
    { label: 'hidden function – método (Organic)', keywords: ['hidden', 'function'], lines: method('hidden ', 'function', 'endfunc'), sort: '0_function_hidden' },
    { label: 'procedure – método (Organic)', keywords: ['procedure'], lines: method('', 'procedure', 'endproc'), sort: '0_procedure' },
    { label: 'funcnote – método (Organic)', keywords: ['funcnote'], lines: [SEPARATOR, ...note], sort: '0_funcnote' },
  ];
}

/**
 * Plantillas Organic según el contexto (`define class`, `function`/`procedure` dentro o fuera de una clase,
 * `funcnote`), en minúsculas y con la indentación que corresponde. Solo cuando la línea tiene una palabra sola hasta
 * el cursor; nunca en strings, comentarios, TEXT o `#if .f.`.
 */
export function templateCompletion(ctx: CursorContext, state: ZooState): CompletionItem[] | undefined {
  const s = ctx.scanned[ctx.position.line];
  if (!s || s.isComment || s.isText) return undefined;
  const before = s.text.substring(0, ctx.position.character);
  const m = /^(\s*)(\w*)$/.exec(before);
  if (!m) return undefined;
  if (s.commentStart >= 0 && ctx.position.character > s.commentStart) return undefined;
  if (s.strings.some((st) => ctx.position.character > st.start && ctx.position.character < st.end)) return undefined;
  const where = templateContext(ctx);
  if (!where) return undefined;
  const typed = m[2].toLowerCase();
  const indent = where.inClass ? where.classIndent + '\t' : '';
  const range = { start: { line: ctx.position.line, character: 0 }, end: ctx.position };
  const items: CompletionItem[] = [];
  for (const t of templatesFor(where.inClass, state)) {
    const kw = t.keywords.find((k) => k.startsWith(typed));
    if (!kw) continue;
    const newText = t.lines.map((l) => (l === '' ? '' : indent + l)).join('\n');
    const preview = snippetPreview(newText);
    items.push({
      label: t.label,
      kind: CompletionItemKind.Snippet,
      // Lo escrito incluye la indentación de la línea: el filtro compara contra el rango completo.
      filterText: m[1] + kw,
      sortText: t.sort,
      preselect: t.preselect,
      insertTextFormat: InsertTextFormat.Snippet,
      insertTextMode: InsertTextMode.asIs,
      textEdit: { range, newText },
      detail: where.inClass ? 'Plantilla Organic (dentro de la clase)' : 'Plantilla Organic',
      documentation: { kind: MarkupKind.Markdown, value: '```foxpro\n' + preview + '\n```' },
    });
  }
  return items.length ? items : undefined;
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
