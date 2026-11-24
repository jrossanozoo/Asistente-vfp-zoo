import * as path from 'path';
import { CodeAction, CodeActionKind, Diagnostic, TextEdit } from 'vscode-languageserver-types';
import { splitLines, uriToPath, VFP_BASE_CLASSES } from 'asistente-vfp-core';
import type { FileEntry, HostApi, MemberDecl, ParseDiagnostic, ParsedFile, Rng } from 'asistente-vfp-core';
import type { ZooState } from '../state';
import { addParamRows, fullLinesRange, generateNote, leadingWhitespace, prependCategory } from './noteEditor';

const IGNORED_FOR_N6 = /^(init|destroy|error|load|unload|_access|_assign)$|_(access|assign)$/i;

function lineRange(lines: string[], line: number): Rng {
  const text = lines[line] ?? '';
  return { start: { line, character: text.length - text.trimStart().length }, end: { line, character: text.length } };
}

function baseName(p: string): string {
  return path.basename(p.replace(/\\/g, '/')).replace(/\.[^.]+$/, '').toLowerCase();
}

/** Reglas de NOTE (convención aprobada) y del framework (D3–D5). */
export function zooDiagnostics(file: FileEntry, lines: string[], state: ZooState, api: HostApi): ParseDiagnostic[] {
  const out: ParseDiagnostic[] = [];
  const s = state.settings;
  const parsed = file.parsed;
  const categories = s.noteCategories.map((c) => c.toLowerCase());
  const index = api.index;

  // ---- NOTE ----
  const documented: { decl: MemberDecl | undefined; doc: NonNullable<MemberDecl['doc']>; isClass: boolean }[] = [];
  for (const c of parsed.classes) {
    if (c.doc?.source === 'note') documented.push({ decl: undefined, doc: c.doc, isClass: true });
    for (const m of c.members) if (m.doc?.source === 'note') documented.push({ decl: m, doc: m.doc, isClass: false });
  }
  for (const p of parsed.procedures) if (p.doc?.source === 'note') documented.push({ decl: p, doc: p.doc, isClass: false });

  for (const { decl, doc } of documented) {
    if (!doc.range) continue;
    const first = doc.range.start.line;
    if (s.noteRequireCategory && (!doc.category || !categories.includes(doc.category.toLowerCase()))) {
      out.push({
        code: 'N1',
        severity: 'warning',
        message: doc.category
          ? `Categoría de NOTE desconocida: [${doc.category}]. Válidas: ${s.noteCategories.join(', ')}.`
          : `El NOTE debe empezar con una categoría: ${s.noteCategories.map((c) => `[${c}]`).join(' ')}.`,
        range: lineRange(lines, first),
        data: { kind: 'noteCategory', line: first },
      });
    }
    if (doc.deprecated && decl) {
      out.push({ code: 'N0', severity: 'hint', message: `${decl.name} está marcado como [Obsoleto].`, range: decl.nameRange, tags: [2] });
    }
    if (!decl || (decl.kind !== 'method' && decl.kind !== 'procedure' && decl.kind !== 'function')) continue;
    const sig = decl.params.map((p) => p.name.toLowerCase());
    const documentedParams = doc.params.map((p) => p.name.toLowerCase());
    const missing = decl.params.filter((p) => !documentedParams.includes(p.name.toLowerCase())).map((p) => p.name);
    const extra = doc.params.filter((p) => !sig.includes(p.name.toLowerCase())).map((p) => p.name);
    if (missing.length) {
      out.push({
        code: 'N2',
        severity: 'warning',
        message: `Faltan en "Parametros:" del NOTE: ${missing.join(', ')}.`,
        range: lineRange(lines, first),
        data: { kind: 'noteAddParams', start: first, end: doc.range.end.line, names: missing },
      });
    }
    if (extra.length) {
      out.push({
        code: 'N2',
        severity: 'warning',
        message: `"Parametros:" del NOTE nombra parámetros que no están en la firma de ${decl.name}: ${extra.join(', ')}.`,
        range: lineRange(lines, first),
      });
    }
    const ret = decl.returnType?.toLowerCase();
    if (ret === 'void' && doc.returns) {
      out.push({ code: 'N3', severity: 'info', message: `"Retorna:" en un método declarado "as Void".`, range: lineRange(lines, first) });
    } else if (ret && ret !== 'void' && !doc.returns) {
      out.push({ code: 'N3', severity: 'info', message: `Falta "Retorna:" (el método devuelve ${decl.returnType}).`, range: lineRange(lines, first) });
    }
  }
  for (const n of parsed.notes) {
    if (n.nonAscii && s.noteCheckAscii) {
      out.push({ code: 'N5', severity: 'info', message: 'El NOTE tiene caracteres fuera de ASCII (la convención pide solo ASCII).', range: lineRange(lines, n.range.start.line) });
    }
  }
  if (s.noteRequireOnPublic) {
    for (const c of parsed.classes) {
      if (!index.descendants(c.name, false).length) continue;
      for (const m of c.members) {
        if (m.kind !== 'method' || m.visibility !== 'public' || m.doc?.source === 'note' || IGNORED_FOR_N6.test(m.name)) continue;
        out.push({
          code: 'N6',
          severity: 'info',
          message: `Método público de una clase base sin NOTE: ${c.name}.${m.name}.`,
          range: m.nameRange,
          data: { kind: 'generateNote', line: m.range.start.line },
        });
      }
    }
  }

  // ---- D3: clase de producto inalcanzable por fábrica ----
  if (s.d3) {
    const rule = state.factories.ruleFor('CrearObjetoPorProducto');
    const products = state.products();
    const calls = state.callsByLiteral();
    for (const c of parsed.classes) {
      if (!rule) break;
      for (const { x, product } of state.factories.untemplate(rule, c.name, products)) {
        if (!product || !index.hasClass(x)) continue;
        const list = calls.get(x.toLowerCase()) ?? [];
        const byProduct = list.filter((ic) => state.factories.ruleFor(ic.call.callee)?.productAware);
        const plain = list.filter((ic) => {
          const r = state.factories.ruleFor(ic.call.callee);
          return r && !r.productAware;
        });
        if (byProduct.length === 0 && plain.length > 0) {
          out.push({
            code: 'D3',
            severity: 'info',
            message: `${c.name} no se alcanza por fábrica: ninguna llamada usa una fábrica por producto con "${x}", pero hay ${plain.length} ${plain[0].call.callee}("${x}") sin producto.`,
            range: c.nameRange,
            related: plain.slice(0, 10).map((ic) => ({ uri: ic.uri, range: ic.call.range, message: `${ic.call.callee}("${x}")` })),
          });
        }
      }
    }
  }

  // ---- D4: literal de fábrica sin candidatas ----
  if (s.d4 && index.fileCount > 0) {
    for (const call of parsed.calls) {
      const rule = state.factories.ruleFor(call.callee);
      if (!rule || rule.prefixListArg !== undefined) continue;
      const arg = call.args[rule.arg ?? 0];
      const lit = arg?.literal;
      if (!lit || lit.includes('.') || /[\s&+]/.test(lit) || VFP_BASE_CLASSES.has(lit.toLowerCase())) continue;
      const res = state.resolveFactory(rule, call.args.map((a) => a.literal));
      if (res.found.length === 0 && res.names.length) {
        out.push({
          code: 'D4',
          severity: 'warning',
          message: `${call.callee}("${lit}"): ninguna clase candidata existe en el índice (${res.names.join(', ')}).`,
          range: arg.range,
        });
      }
    }
  }

  // ---- D5: OF lib que no coincide ----
  if (s.d5) {
    for (const c of parsed.classes) {
      if (!c.parent || !c.parentLib || !c.parentLibRange) continue;
      const entries = index.classEntries(c.parent, { includeDownstream: true }).filter((e) => e.decl.uri !== c.uri);
      if (!entries.length) continue;
      const actual = entries.map((e) => {
        const f = index.getFile(e.fileUri ?? e.decl.uri);
        const src = e.decl.sourcePath ?? (typeof f?.lookupName === 'string' ? f.lookupName : uriToPath(e.decl.uri));
        return { base: baseName(src), shown: path.basename(src.replace(/\\/g, '/')) };
      });
      const lib = baseName(c.parentLib);
      if (!actual.some((a) => a.base === lib)) {
        out.push({
          code: 'D5',
          severity: 'warning',
          message: `"OF ${c.parentLib}" no coincide con el archivo de ${c.parent}: ${[...new Set(actual.map((a) => a.shown))].join(', ')}.`,
          range: c.parentLibRange,
        });
      }
    }
  }
  return out;
}

/** N4: el NOTE dentro del cuerpo reemplaza al D1 genérico de esa línea. */
export function reclassifyNoteDiagnostics(diags: ParseDiagnostic[], parsed: ParsedFile): ParseDiagnostic[] {
  const inside = new Set(parsed.notes.filter((n) => n.insideBody).map((n) => n.range.start.line));
  return diags.map((d) =>
    d.code === 'D1' && inside.has(d.range.start.line)
      ? { ...d, code: 'N4', message: 'NOTE dentro del cuerpo de una función: NOTE se reserva para documentar declaraciones. Dentro del cuerpo usar && o *!*.' }
      : d,
  );
}

/** Code actions de NOTE: categoría, parámetros faltantes y generar desde la firma. */
export async function zooCodeActions(uri: string, diagnostics: Diagnostic[], range: Rng, state: ZooState, api: HostApi): Promise<CodeAction[]> {
  const actions: CodeAction[] = [];
  const text = await api.getText(uri);
  if (text === undefined) return actions;
  const lines = splitLines(text);
  for (const d of diagnostics) {
    const data = d.data as { kind?: string; line?: number; start?: number; end?: number; names?: string[] } | undefined;
    if (data?.kind === 'noteCategory' && data.line !== undefined) {
      const line = lines[data.line];
      for (const cat of state.settings.noteCategories) {
        actions.push({
          title: `NOTE: usar categoría [${cat}]`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [d],
          edit: { changes: { [uri]: [TextEdit.replace(fullLinesRange(data.line, data.line, line.length), prependCategory(line, cat))] } },
        });
      }
    }
    if (data?.kind === 'noteAddParams' && data.start !== undefined && data.end !== undefined && data.names) {
      const block = lines.slice(data.start, data.end + 1);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      actions.push({
        title: `NOTE: agregar ${data.names.join(', ')} a Parametros`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [d],
        isPreferred: true,
        edit: {
          changes: { [uri]: [TextEdit.replace(fullLinesRange(data.start, data.end, lines[data.end].length), addParamRows(block, data.names).join(eol))] },
        },
      });
    }
  }
  // "Generar NOTE desde la firma" sobre una declaración sin NOTE.
  const ctx = await api.cursorContext(uri, range.start);
  if (ctx) {
    const line = range.start.line;
    const all = [...ctx.parsed.classes.flatMap((c) => c.members), ...ctx.parsed.procedures];
    const m = all.find(
      (mm) => (mm.kind === 'method' || mm.kind === 'procedure' || mm.kind === 'function') && mm.range.start.line === line && mm.doc?.source !== 'note',
    );
    if (m) {
      // El NOTE va antes de las etiquetas *-- @tag que preceden a la función.
      let at = line;
      while (at > 0 && /^\s*\*--\s*@/.test(lines[at - 1])) at--;
      const indent = leadingWhitespace(lines[line]);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const note = generateNote(m, indent, state.settings.noteCategories[0] ?? 'Categoria');
      actions.push({
        title: `Generar NOTE desde la firma de ${m.name}`,
        kind: CodeActionKind.RefactorRewrite,
        diagnostics: diagnostics.filter((d) => d.code === 'N6'),
        edit: { changes: { [uri]: [TextEdit.insert({ line: at, character: 0 }, note.join(eol) + eol)] } },
      });
    }
  }
  return actions;
}
