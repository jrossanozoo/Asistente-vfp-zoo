import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  activeFolderIndex,
  buildCursorContext,
  declarationLocations,
  definitionWithLocals,
  hoverMarkdown,
  implementationLocations,
  parsePrg,
  pathToUri,
  readPrgSync,
  signatureHelp,
  toLspDiagnostic,
  typeDefinitionLocations,
  typedObjectSection,
  uriToPath,
} from 'asistente-vfp-core';
import { inlayHints } from '../src/zoo/features/inlayHints';
import { documentHighlights } from '../src/zoo/features/documentHighlight';
import { incomingCalls, outgoingCalls, prepareCallHierarchy } from '../src/zoo/features/callHierarchy';
import type { CursorContext } from 'asistente-vfp-core';
import { createHeadless, Headless } from '../src/zoo/headless';
import { memberCompletion, factoryLiteralCompletion, templateCompletion } from '../src/zoo/features/completion';
import { findReferences } from '../src/zoo/features/references';
import { codeLenses } from '../src/zoo/features/codeLens';
import { reclassifyNoteDiagnostics, zooCodeActions, zooDiagnostics } from '../src/zoo/diagnostics/zooDiagnostics';
import { vcxContent } from '../src/zoo/vcx/vcxReader';
import { parseSymbolsText, splitColumns } from '../src/zoo/layers/symbolsReader';

const ROOT = path.join(__dirname, 'fixtures', 'organic');
const abs = (rel: string): string => path.join(ROOT, rel);

function posOf(text: string, needle: string, delta = 0, occurrence = 1): { line: number; character: number } {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = text.indexOf(needle, idx + 1);
    if (idx < 0) throw new Error(`No se encontró "${needle}"`);
  }
  const before = text.substring(0, idx + delta).split(/\r\n|\n/);
  return { line: before.length - 1, character: before[before.length - 1].length };
}

function ctxAt(h: Headless, rel: string, needle: string, delta = 0, override?: string): CursorContext {
  const p = abs(rel);
  const uri = pathToUri(p);
  const text = override ?? readPrgSync(p);
  const f = h.index.getFile(uri)!;
  const parsed = override ? parsePrg(text, uri, { callNames: h.zoo.plugin.callNames }) : f.parsed;
  return buildCursorContext(uri, text, parsed, posOf(text, needle, delta), h.index, f.layer);
}

let dragon: Headless;
let drawing: Headless;
let feline: Headless;
let sinCore: Headless;

beforeAll(async () => {
  [dragon, drawing, feline, sinCore] = await Promise.all([
    createHeadless({ roots: [abs('Organic.Dragonfish')] }),
    createHeadless({ roots: [abs('Organic.Drawing')], zoo: { downstreamRoots: ['../Organic.Feline', '../Organic.Dragonfish', '../Organic.ZL'] } }),
    createHeadless({ roots: [abs('Organic.Feline')] }),
    createHeadless({ roots: [abs('FelineSinCore')], zoo: { autoSourceRoots: false } }),
  ]);
}, 60_000);

describe('H4: proyecto activo', () => {
  const entCliente = 'Organic.Feline/Organic.BusinessLogic/CENTRALSS/Felino/altas/ent_cliente.prg';
  const dinDe = (h: Headless) => {
    const target = h.resolver.resolveAt(ctxAt(h, entCliente, 'dodefault()', 2))!;
    const m = target.members?.[0];
    expect(m?.owner?.decl.name).toBe('Din_EntidadCliente');
    return path.relative(ROOT, uriToPath(m!.decl.uri)).split(path.sep)[0];
  };

  it('activeFolderIndex: la carpeta del .code-workspace, si no la primera', () => {
    const folders = ['c:\\LinceV3\\Organic.Feline', 'c:\\LinceV3\\Organic.Dragonfish'];
    expect(activeFolderIndex(folders, 'C:\\LinceV3\\Organic.Dragonfish\\settings.dragonfish.code-workspace').index).toBe(1);
    expect(activeFolderIndex(folders, undefined)).toEqual({ index: 0 });
    const otro = activeFolderIndex(folders, 'c:\\otro\\x.code-workspace');
    expect(otro.index).toBe(0);
    expect(otro.note).toContain('Organic.Feline');
  });

  for (const mode of ['none', 'headers'] as const) {
    it(`F12 en dodefault() de Feline va al Din_* del proyecto activo (indexGenerated ${mode})`, async () => {
      const zoo = { indexGenerated: mode };
      const [dfActivo, felActivo] = await Promise.all([
        createHeadless({ roots: [abs('Organic.Dragonfish'), abs('Organic.Feline')], zoo }),
        createHeadless({ roots: [abs('Organic.Feline'), abs('Organic.Dragonfish')], zoo }),
      ]);
      expect(dinDe(dfActivo)).toBe('Organic.Dragonfish');
      expect(dinDe(felActivo)).toBe('Organic.Feline');
    }, 60_000);
  }

  it('workspace con solo Dragonfish: el Din_* local gana al de las fuentes de Feline', () => {
    expect(dinDe(dragon)).toBe('Organic.Dragonfish');
  });
});

describe('H1: archivo homónimo y clases de test', () => {
  const uso = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/UsoTests.prg';
  const ayudantes = 'Organic.Dragonfish/Organic.Tests.Unit/ayudantes.prg';
  const f12 = (rel: string, needle: string, delta: number) => {
    const ctx = ctxAt(dragon, rel, needle, delta);
    return definitionWithLocals(dragon.resolver.resolveAt(ctx), ctx).map((l) => path.basename(uriToPath(l.uri)));
  };

  it('detecta los archivos de test: proyecto Test, nombre test*/ztest*, mocks; los stubs no', () => {
    const st = dragon.zoo.state()!;
    expect(st.isTestUri(pathToUri(abs(ayudantes)))).toBe(true);
    expect(st.isTestUri(pathToUri(abs('Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/ztestAyuda.prg')))).toBe(true);
    expect(st.isTestUri(pathToUri(abs('Organic.Dragonfish/Organic.Mocks/Generados/Mock_Mensajes.prg')))).toBe(true);
    expect(st.isTestUri(pathToUri(abs(uso)))).toBe(false);
    expect(st.isTestUri(pathToUri(abs('FelineSinCore/Organic.Tests.Unit/obj/Test/_dovfp_stubs/Organic.Core/mensajes.prg')))).toBe(false);
  });

  it('desde la aplicación, F12 en una clase va a la definición de la aplicación, no a la del test', () => {
    expect(f12(uso, 'as Mensajes', 4)).toEqual(['mensajes.prg']);
    expect(dragon.index.getClass('Mensajes', { fromUri: pathToUri(abs(uso)) })?.decl.uri).not.toContain('Tests.Unit');
  });

  it('desde la aplicación, una clase que solo está en tests no se resuelve', () => {
    expect(f12(uso, 'as SoloEnTest', 4)).toEqual([]);
    expect(dragon.index.classEntries('SoloEnTest', { fromUri: pathToUri(abs(uso)) })).toEqual([]);
    // Sin origen (Ctrl+T, MCP) sigue existiendo.
    expect(dragon.index.classEntries('SoloEnTest')).toHaveLength(1);
  });

  it('desde el propio test se ve su clase', () => {
    expect(f12(ayudantes, 'as Mensajes', 4)).toEqual(['ayudantes.prg']);
  });

  it('la clase del archivo homónimo gana aunque otra esté en una capa de mayor prioridad', () => {
    expect(f12(uso, 'as Planilla', 4)).toEqual(['planilla.prg']);
  });
});

describe('H3: indentación y plantillas según el contexto', () => {
  const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/UsoMensajes.prg';
  /** `|` marca el cursor. */
  const tpl = (src: string) => {
    const text = src.replace('|', '');
    const uri = pathToUri(abs(rel));
    const ctx = buildCursorContext(uri, text, parsePrg(text, uri, {}), posOf(src, '|'), dragon.index, dragon.index.getFile(uri)!.layer);
    return templateCompletion(ctx, dragon.zoo.state()!);
  };
  const edit = (items: ReturnType<typeof tpl>, label: string) => {
    const it = items!.find((i) => i.label === label)!;
    expect(it, label).toBeDefined();
    const te = it.textEdit as { range: { start: { character: number } }; newText: string };
    expect(te.range.start.character).toBe(0);
    return te.newText;
  };
  const SEP = '*' + '-'.repeat(89);

  it('language-configuration.json es JSON válido y sus patrones indentan lo esperado', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'language-configuration.json'), 'utf8'));
    const inc = new RegExp(cfg.indentationRules.increaseIndentPattern.pattern, cfg.indentationRules.increaseIndentPattern.flags);
    const dec = new RegExp(cfg.indentationRules.decreaseIndentPattern.pattern, cfg.indentationRules.decreaseIndentPattern.flags);
    for (const l of ['define class X as custom', '\tFUNCTION Algo()', '\tprotected procedure P', 'if llX', 'do case', '\tcase x = 1', 'otherwise', 'try', 'catch to loEx', 'text to lcX noshow', 'with this', 'for each loX in loY'])
      expect(inc.test(l), l).toBe(true);
    for (const l of ['iif( llX, 1, 2 )', 'lcX = textmerge( lcY )', 'text = "hola"', 'formato = 1', 'endfunc', 'withdraw()'])
      expect(inc.test(l), l).toBe(false);
    for (const l of ['enddefine', '\tendfunc', 'endif', 'else', 'case x', 'otherwise', 'endcase', 'catch', 'endtry', 'endtext', 'endwith'])
      expect(dec.test(l), l).toBe(true);
    expect(dec.test('endifx = 1')).toBe(false);
  });

  it('archivo vacío + class → define class en minúsculas, columna 0', () => {
    const items = tpl('cla|');
    expect(items![0].label).toBe('define class (Organic)');
    expect(items![0].preselect).toBe(true);
    expect(edit(items, 'define class (Organic)')).toBe('define class ${1:Nombre} as ${2:custom}${3: of ${4:archivo}.prg}\n\n\t$0\n\nenddefine');
  });

  it('function dentro de una clase sin enddefine → separador y método con un tab, cuerpo con dos', () => {
    const items = tpl('define class X as custom\n\tfunc|');
    expect(edit(items, 'function – método (Organic)')).toBe(
      `\t${SEP}\n\tfunction \${1:Nombre}( \${2:tcParametro} as \${3:String} ) as \${4:Void}\n\t\t$0\n\tendfunc`,
    );
    expect(items!.some((i) => i.label === 'define class (Organic)')).toBe(false);
  });

  it('cursor entre métodos de una clase cerrada → mismo resultado', () => {
    const items = tpl('define class X as custom\n\tfunction A()\n\tendfunc\n\tfunction|\n\tfunction B()\n\tendfunc\nenddefine\n');
    expect(edit(items, 'function – método (Organic)')).toContain(`\t${SEP}\n\tfunction `);
    expect(items!.map((i) => i.label)).toContain('protected function – método (Organic)');
  });

  it('después de enddefine, function → función en la columna 0 sin separador', () => {
    const items = tpl('define class X as custom\nenddefine\nfunction|');
    const text = edit(items, 'function (Organic)');
    expect(text.startsWith('function ${1:Nombre}')).toBe(true);
    expect(text).not.toContain(SEP);
  });

  it('class dentro de una clase → no se ofrece define class', () => {
    expect(tpl('define class X as custom\n\tclass|')).toBeUndefined();
  });

  it('comentario &&, comentario *, TEXT…ENDTEXT y #if .f. → sin items', () => {
    expect(tpl('\t&& func|')).toBeUndefined();
    expect(tpl('* func|')).toBeUndefined();
    expect(tpl('text to lcX noshow\nfunc|\nendtext')).toBeUndefined();
    expect(tpl('lcX = "func|"')).toBeUndefined();
    expect(tpl('#if .f.\nfunc|\n#endif')).toBeUndefined();
    expect(tpl('#if .f.\n#else\nfunc|\n#endif')).toBeDefined();
  });

  it('define class precedido por un NOTE con continuación → dentro de la clase', () => {
    const items = tpl('NOTE\t[Contrato] Algo. ;\n\t\tdefine class no es esto ;\n\t\tsigue el NOTE.\ndefine class X as custom\n\tfunc|');
    expect(items!.some((i) => i.label === 'function – método (Organic)')).toBe(true);
  });

  it('procedure dentro de una clase → procedure/endproc; funcnote con NOTE indentado', () => {
    const items = tpl('define class X as custom\n\tproc|');
    const text = edit(items, 'procedure – método (Organic)');
    expect(text).toContain('\tprocedure ${1:Nombre}');
    expect(text.endsWith('\tendproc')).toBe(true);
    const note = edit(tpl('define class X as custom\n\tfuncn|'), 'funcnote – método (Organic)');
    expect(note).toContain(`\t${SEP}\n\tNOTE\t[\${1|Dependencia,Extension,Generacion,Contrato,Gotcha,Obsoleto|}]`);
    expect(note.endsWith('\tendfunc')).toBe(true);
  });

  it('funcnote ya no está en los snippets estáticos', () => {
    const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'snippets', 'foxpro.json'), 'utf8'));
    expect(Object.values(snippets).map((s) => (s as { prefix: string }).prefix)).toEqual(['note', 'notes']);
  });
});

describe('workspace y producto', () => {
  it('detecta el producto de la clase Aplicacion* del workspace', () => {
    expect(dragon.zoo.state()!.product()).toBe('ColoryTalle');
    expect(feline.zoo.state()!.product()).toBe('FELINO');
    expect(drawing.zoo.state()!.product()).toBe('');
  });

  it('lee los AppReference en orden y ubica fuentes hermanas', () => {
    const sol = dragon.zoo.state()!.solutions[0];
    expect(sol.apps.map((a) => a.name)).toEqual(['Organic.AdnImplant', 'Organic.Core', 'Organic.Drawing', 'Organic.Generator', 'Organic.Feline']);
    expect(sol.apps.find((a) => a.name === 'Organic.Feline')!.sourceRoot).toBeDefined();
    expect(sol.apps.find((a) => a.name === 'Organic.AdnImplant')!.sourceRoot).toBeUndefined();
  });

  it('tabla de servicios extraída de Core', () => {
    const svc = dragon.zoo.state()!.services;
    expect(svc.source).toBe('core');
    expect(svc.services.find((s) => s.prop === 'Mensajes')?.x).toBe('Mensajes');
    expect(svc.globals.find((g) => g.global === 'goFormularios')?.x).toBe('ManagerFormularios');
  });
});

describe('fábricas (F1/F4)', () => {
  it('Dragonfish: InstanciarEntidad("Cliente") → EntColorYTalle_Cliente con candidatas', () => {
    const ctx = ctxAt(dragon, 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Uso.prg', '"Cliente"', 2);
    const target = dragon.resolver.resolveAt(ctx)!;
    const locs = definitionWithLocals(target, ctx);
    expect(locs.map((l) => path.basename(l.uri))).toEqual(['entColorYTalle_Cliente.prg', 'ent_cliente.prg', 'Din_EntidadCliente.prg']);
    const md = hoverMarkdown(dragon.index, target)!;
    expect(md).toContain('| ColoryTalle | `EntColorYTalle_Cliente` |');
    expect(md).toContain('| FELINO | `Ent_Cliente` |');
  });

  it('Drawing: CrearObjetoPorProducto("ColaboradorListaDinamica") → base + tabla por producto con consumidores', () => {
    const ctx = ctxAt(drawing, 'Organic.Drawing/Organic.BusinessLogic/CENTRALSS/Dibujante/_Base/ComboListaDinamica.prg', '"ColaboradorListaDinamica"', 2);
    expect(ctx.position.line).toBe(31);
    const target = drawing.resolver.resolveAt(ctx)!;
    const locs = definitionWithLocals(target, ctx);
    expect(path.basename(locs[0].uri)).toBe('ColaboradorListaDinamica.prg');
    const md = hoverMarkdown(drawing.index, target)!;
    expect(md).toContain('| FELINO | `Felino_ColaboradorListaDinamica` |');
    expect(md).toContain('| ColoryTalle | `ColorYTalle_ColaboradorListaDinamica` |');
    expect(md).toContain('| ZL | `ZL_ColaboradorListaDinamica` |');
  });

  it('Drawing: variable asignada desde un método tipado → F12 a la clase y hover con métodos', () => {
    const ctx = ctxAt(drawing, 'Organic.Drawing/Organic.BusinessLogic/CENTRALSS/Dibujante/_Base/ComboListaDinamica.prg', 'loColaborador.ObtenerColeccion( tcEntidad', 2);
    const target = drawing.resolver.resolveAt(ctx)!;
    expect(target.kind).toBe('variable');
    expect(path.basename(definitionWithLocals(target, ctx)[0].uri)).toBe('ColaboradorListaDinamica.prg');
    const md = hoverMarkdown(drawing.index, target)!;
    expect(md).toContain('define class ColaboradorListaDinamica');
    expect(md).toMatch(/\*\*Métodos\*\*[\s\S]*ObtenerColeccion\(/);
  });

  it('Dragonfish: variable sin tipo creada con CrearObjeto → F12/hover a la clase (en el lado izquierdo y en usos posteriores)', () => {
    const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Ventas/entcolorytalle_comprobantedecaja.PRG';
    const lhs = ctxAt(dragon, rel, 'loColaborador = _screen', 2);
    const t1 = dragon.resolver.resolveAt(lhs)!;
    expect(t1.kind).toBe('variable');
    expect(definitionWithLocals(t1, lhs).map((l) => path.basename(l.uri).toLowerCase())).toContain('colaboradorcheques.prg');
    const md = hoverMarkdown(dragon.index, t1)!;
    expect(md).toContain('→ ColaboradorCheques');
    expect(md).toContain('CrearObjeto("ColaboradorCheques")');

    const text = readPrgSync(abs(rel)).replace(/(CrearObjeto\( "ColaboradorCheques" \))/, '$1\r\n\t\tloColaborador.Release()');
    const use = ctxAt(dragon, rel, 'loColaborador.Release', 2, text);
    const t2 = dragon.resolver.resolveAt(use)!;
    expect(definitionWithLocals(t2, use).map((l) => path.basename(l.uri).toLowerCase())).toContain('colaboradorcheques.prg');
  });

  it('Feline: InstanciarComponente("ComponenteCajero") → ComponenteCajero y su padre generado', () => {
    const ctx = ctxAt(feline, 'Organic.Feline/Organic.BusinessLogic/CENTRALSS/Felino/Ventas/Uso.prg', '"ComponenteCajero"', 2);
    const target = feline.resolver.resolveAt(ctx)!;
    const names = target.classes!.map((c) => c.decl.name);
    expect(names[0]).toBe('ComponenteCajero');
    expect(names).toContain('Din_ComponenteCajero');
    expect(feline.index.getClass('ComponenteCajero')!.decl.parent).toBe('Din_ComponenteCajero');
  });
});

describe('inferencia, completion y signature help (F8/F9)', () => {
  it('loEnt = InstanciarEntidad("Valor") → loEnt. ofrece miembros de Ent_Valor y Din_EntidadValor', () => {
    const rel = 'Organic.Feline/Organic.BusinessLogic/CENTRALSS/Felino/Ventas/Uso.prg';
    const ctx = ctxAt(feline, rel, 'loEnt.ObtenerCotizacion', 'loEnt.'.length);
    const items = memberCompletion(ctx, feline.api)!;
    const labels = items.map((i) => i.label);
    expect(labels).toContain('ObtenerCotizacion');
    expect(labels).toContain('ObtenerSimbolo');
    expect(labels).toContain('Grabar');
    // Hay '(' a la derecha: no se duplican paréntesis.
    expect(items.find((i) => i.label === 'ObtenerCotizacion')!.insertText).toBeUndefined();
    const text = readPrgSync(abs(rel)).replace('loEnt.ObtenerCotizacion()', 'loEnt.');
    const ctx2 = ctxAt(feline, rel, 'loEnt.\r', 'loEnt.'.length, text);
    const item = memberCompletion(ctx2, feline.api)!.find((i) => i.label === 'ObtenerCotizacion')!;
    expect(item.insertText).toBe('ObtenerCotizacion($0)');
    expect(item.command?.command).toBe('editor.action.triggerParameterHints');
  });

  it('literal de fábrica: InstanciarEntidad("Cli|") ofrece Cliente → EntColoryTalle_Cliente', () => {
    const ctx = ctxAt(dragon, 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Uso.prg', '"Cli"', 4);
    const items = factoryLiteralCompletion(ctx, dragon.zoo.state()!)!;
    const cliente = items.find((i) => i.label.toLowerCase() === 'cliente')!;
    expect(cliente.detail).toContain('EntColorYTalle_Cliente');
  });

  it('goServicios.X, globales go* y receptor con tipo', () => {
    const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Uso.prg';
    const adv = dragon.resolver.resolveAt(ctxAt(dragon, rel, 'Advertir(', 2))!;
    expect(adv.heuristic).toBeFalsy();
    expect(adv.members![0].owner!.decl.name).toBe('Mensajes');
    expect(dragon.resolver.resolveAt(ctxAt(dragon, rel, 'Loguear(', 2))!.members![0].owner!.decl.name).toBe('ManagerErrores');
    expect(dragon.resolver.resolveAt(ctxAt(dragon, rel, 'Mostrar(', 2))!.members![0].owner!.decl.name).toBe('ManagerFormularios');
    expect(dragon.resolver.resolveAt(ctxAt(dragon, rel, 'ValidarCuit(', 2))!.members![0].owner!.decl.name).toBe('Ent_Cliente');
  });

  it('signature help con receptor inferido y funciones nativas', () => {
    const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Uso.prg';
    const sh = signatureHelp(dragon.index, dragon.resolver, ctxAt(dragon, rel, 'ObtenerLista( ', 'ObtenerLista( '.length), dragon.zoo.plugin.signatureFallback)!;
    const p0 = sh.signatures[0].parameters![0];
    expect((p0.documentation as { value: string }).value).toContain('Entidad del combo');
    const nat = signatureHelp(dragon.index, dragon.resolver, ctxAt(dragon, rel, '"a",  )', 6), dragon.zoo.plugin.signatureFallback)!;
    expect(nat.signatures[0].label).toMatch(/^STRTRAN\(/);
    expect(nat.activeParameter).toBe(2);
  });
});

describe('Go to Type Definition, globales go* y mocks (R1/R2/R3)', () => {
  const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/UsoMensajes.prg';
  const at = (needle: string, delta: number, r = rel) => ctxAt(dragon, r, needle, delta);
  const names = (locs: { uri: string }[]) => locs.map((l) => path.basename(l.uri));
  const f12 = (needle: string, delta: number, r = rel) => {
    const ctx = at(needle, delta, r);
    return definitionWithLocals(dragon.resolver.resolveAt(ctx), ctx);
  };
  const declaration = (needle: string, delta: number, r = rel) => {
    const ctx = at(needle, delta, r);
    return declarationLocations(dragon.resolver.resolveAt(ctx), ctx);
  };
  const typeDef = (needle: string, delta: number, r = rel) => {
    const ctx = at(needle, delta, r);
    return names(typeDefinitionLocations(dragon.index, dragon.resolver.typeAt(ctx), ctx));
  };

  it('tabla de globales: goMensajes y goLibrerias salen de su servicio', () => {
    const svc = dragon.zoo.state()!.services;
    expect(svc.globals.find((g) => g.global === 'goMensajes')).toMatchObject({ appProp: 'oMensajes', service: 'Mensajes' });
    expect(svc.globals.find((g) => g.global === 'goLibrerias')).toBeUndefined(); // no hay servicio Librerias en la fixture
  });

  it('this.oMensajes (asignada con _Screen.Zoo.CrearObjeto): F12 → clase (como una local), Go to Declaration → propiedad', () => {
    expect(names(f12('this.oMensajes.Advertir', 'this.o'.length))).toEqual(['mensajes.prg']);
    expect(names(f12('this.oMensajes = _Screen', 'this.o'.length))).toEqual(['mensajes.prg']);
    const decl = declaration('this.oMensajes.Advertir', 'this.o'.length);
    expect(names(decl)).toEqual(['UsoMensajes.prg']);
    expect(decl[0].range.start.line).toBe(1);
    // Sobre la propia declaración, F12 se queda en la propiedad.
    expect(names(f12('oMensajes = null', 2))).toEqual(['UsoMensajes.prg']);
    expect(typeDef('this.oMensajes.Advertir', 'this.o'.length)).toEqual(['mensajes.prg']);
    const md = hoverMarkdown(dragon.index, dragon.resolver.resolveAt(at('this.oMensajes.Advertir', 'this.o'.length)))!;
    expect(md).toContain('**Tipo deducido:** `Mensajes`');
  });

  it('propiedad asignada dentro de WITH this (.oErrores = CrearObjeto(…)) → ManagerErrores', () => {
    expect(names(f12('this.oErrores.Loguear', 'this.o'.length))).toEqual(['managererrores.prg']);
    expect(typeDef('this.oErrores.Loguear', 'this.o'.length)).toEqual(['managererrores.prg']);
    const log = dragon.resolver.resolveAt(at('Loguear(', 2))!;
    expect(log.heuristic).toBeFalsy();
    expect(log.members![0].owner!.decl.name).toBe('ManagerErrores');
  });

  it('this.oMensajes asignada en el Init de la clase padre (otro archivo) → Mensajes', () => {
    const hija = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Ventas/UsoMensajesHija.prg';
    expect(typeDef('this.oMensajes.Advertir', 'this.o'.length, hija)).toEqual(['mensajes.prg']);
    const adv = dragon.resolver.resolveAt(at('Advertir( "y"', 2, hija))!;
    expect(adv.heuristic).toBeFalsy();
    expect(adv.members![0].owner!.decl.name).toBe('Mensajes');
  });

  it('goServicios.Mensajes: F12 y Type Definition → ColorYTalle_Mensajes y Mensajes (precedencia por producto), Declaration → propiedad', () => {
    expect(names(f12('goServicios.Mensajes.', 'goServicios.M'.length))).toEqual(['colorytalle_mensajes.prg', 'mensajes.prg']);
    expect(names(declaration('goServicios.Mensajes.', 'goServicios.M'.length))).toEqual(['serviciosaplicacion.PRG']);
    expect(typeDef('goServicios.Mensajes.', 'goServicios.M'.length)).toEqual(['colorytalle_mensajes.prg', 'mensajes.prg']);
  });

  it('goMensajes (sin declaración en la fuente): F12 y Type Definition → la clase', () => {
    expect(names(f12('goMensajes.', 2))).toEqual(['colorytalle_mensajes.prg', 'mensajes.prg']);
    expect(typeDef('goMensajes.', 2)).toEqual(['colorytalle_mensajes.prg', 'mensajes.prg']);
  });

  it('F12 sobre Advertir en las tres formas → solo Mensajes.Advertir', () => {
    for (const needle of ['this.oMensajes.Advertir', 'goServicios.Mensajes.Advertir', 'goMensajes.Advertir']) {
      const locs = f12(needle, needle.length - 3);
      expect(names(locs), needle).toEqual(['mensajes.prg']);
    }
  });

  it('receptor desconocido: la búsqueda por nombre excluye Organic.Mocks salvo con includeMocks', () => {
    const settings = dragon.zoo.state()!.settings;
    const sinMocks = names(f12('loNada.Advertir', 'loNada.A'.length));
    expect(sinMocks).toContain('mensajes.prg');
    expect(sinMocks).not.toContain('Mock_Mensajes.prg');
    settings.referencesIncludeMocks = true;
    try {
      expect(names(f12('loNada.Advertir', 'loNada.A'.length))).toContain('Mock_Mensajes.prg');
    } finally {
      settings.referencesIncludeMocks = false;
    }
  });

  it('Type Definition: local AS, this, _screen.zoo(.app) y tipo no deducible', () => {
    expect(typeDef('loForm.Probar', 2)).toEqual(['UsoMensajes.prg']);
    expect(typeDef('this.Probar()', 2)).toEqual(['UsoMensajes.prg']);
    expect(typeDef('_screen.zoo.app', '_screen.z'.length)).toEqual(['zoo.prg']);
    expect(typeDef('_screen.zoo.app', '_screen.zoo.a'.length)).toEqual(['aplicacioncolorytalle.prg', 'aplicacionbase.prg']);
    expect(typeDef('loNada.Advertir', 2)).toEqual([]);
    expect(typeDef('"Mensajes"', 2)).toEqual(['mensajes.prg']);
  });
});

describe('Etapa 1: hover uniforme, inlay hints, document highlight, call hierarchy', () => {
  const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/UsoMensajes.prg';
  const text = () => readPrgSync(abs(rel));
  const lineOf = (needle: string) => posOf(text(), needle).line;
  const at = (needle: string, delta: number) => ctxAt(dragon, rel, needle, delta);
  const labelOf = (h: { label: string | { value: string }[] }) => (typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join(''));
  const qualified = (i: { name: string; detail?: string }) => `${(i.detail ?? '').split(' · ')[0]}.${i.name}`;

  it('E1.1: el hover de una propiedad tipada muestra lo mismo que el de una variable del mismo tipo', () => {
    const prop = dragon.resolver.resolveAt(at('this.oMensajes.Advertir', 'this.o'.length))!;
    const local = dragon.resolver.resolveAt(at('loMensajes.Advertir', 2))!;
    const section = typedObjectSection(dragon.index, [dragon.index.getClass('Mensajes')!]).join('\n\n');
    expect(section).toContain('define class Mensajes');
    expect(section).toMatch(/\*\*Métodos\*\*[\s\S]*Advertir\(/);
    expect(hoverMarkdown(dragon.index, prop)).toContain(section);
    expect(hoverMarkdown(dragon.index, local)).toContain(section);
  });

  it('E1.2: inlay hints de tipo en asignaciones (this.oX, .oX en WITH, local) y nada si no se deduce', () => {
    const base = at('define class UsoMensajes', 0);
    const all = inlayHints(base, { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } }, dragon.zoo.state()!, dragon.api);
    const byLine = all.map((h) => `${h.position.line}:${labelOf(h)}`);
    expect(byLine).toContain(`${lineOf('this.oMensajes = _Screen')}:: Mensajes`);
    expect(byLine).toContain(`${lineOf('.oErrores = _Screen')}:: ManagerErrores`);
    expect(byLine).toContain(`${lineOf('loMensajes = _Screen')}:: Mensajes`);
    expect(all.every((h) => h.kind === 1)).toBe(true); // sin hints de parámetro por defecto
    const hint = all.find((h) => h.position.line === lineOf('this.oMensajes = _Screen'))!;
    expect(hint.position.character).toBe('\t\tthis.oMensajes'.length);
    // Solo el rango pedido.
    const one = inlayHints(base, { start: { line: lineOf('loMensajes = _Screen'), character: 0 }, end: { line: lineOf('loMensajes = _Screen'), character: 0 } }, dragon.zoo.state()!, dragon.api);
    expect(one).toHaveLength(1);
  });

  it('H2: asignaciones cíclicas no desbordan la pila (inlay hints, hover, F12)', () => {
    const ciclos = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/CiclosDeTipo.prg';
    const src = readPrgSync(abs(ciclos));
    const cat = (needle: string, delta: number) => ctxAt(dragon, ciclos, needle, delta);
    const settings = dragon.zoo.state()!.settings;
    settings.inlayHintsParameterNames = true;
    try {
      const all = inlayHints(cat('define class CiclosDeTipo', 0), { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } }, dragon.zoo.state()!, dragon.api);
      expect(Array.isArray(all)).toBe(true);
    } finally {
      settings.inlayHintsParameterNames = false;
    }
    for (const [needle, delta] of [
      ['this.oA = this.oB', 6],
      ['this.oX = this.oX', 6],
      ['.oA = .oA.Otro', 2],
      ['loX.Advertir( "y"', 5],
      ['loB.Advertir( "z"', 5],
      ['\tloY.Algo()', 5],
      ['this.oA.Advertir', 9],
      ['this.oX.Advertir', 9],
    ] as const) {
      const ctx = cat(needle, delta);
      expect(() => dragon.resolver.resolveAt(ctx)).not.toThrow();
      expect(() => dragon.resolver.typeAt(ctx)).not.toThrow();
    }
    // El lado derecho de `loX = loX.Advertir(…)` ve el loX anterior (Mensajes), y F12 sobre Advertir llega.
    expect(src).toContain('loX = loX.Advertir');
    expect(dragon.resolver.resolveChainType(['loX'], cat('loX = loX.Advertir', 6))?.classNames).toEqual(['Mensajes']);
    const adv = dragon.resolver.resolveAt(cat('loX = loX.Advertir', 10))!;
    expect(adv.members?.[0]?.owner?.decl.name).toBe('Mensajes');
    // Después, loX es lo que devuelve Advertir (sin tipo declarado): no se inventa un tipo.
    expect(dragon.resolver.resolveChainType(['loX'], cat('loX = loX.Advertir', 0))).toBeUndefined();
  });

  it('E1.2: inlay hints de nombre de parámetro solo con la configuración activa y sin heurística', () => {
    const settings = dragon.zoo.state()!.settings;
    settings.inlayHintsParameterNames = true;
    try {
      const base = at('define class UsoMensajes', 0);
      const all = inlayHints(base, { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } }, dragon.zoo.state()!, dragon.api);
      const params = all.filter((h) => h.kind === 2).map((h) => `${h.position.line}:${labelOf(h)}`);
      expect(params).toContain(`${lineOf('goMensajes.Advertir')}:tvMensaje:`);
      expect(params).toContain(`${lineOf('loMensajes.Advertir')}:tvMensaje:`);
      expect(params.filter((p) => p.startsWith(`${lineOf('loMensajes.Advertir')}:`))).toHaveLength(1); // tnBotones se llama igual
      expect(params.some((p) => p.startsWith(`${lineOf('loNada.Advertir')}:`))).toBe(false); // receptor desconocido
    } finally {
      settings.inlayHintsParameterNames = false;
    }
  });

  it('E1.3: document highlight de una propiedad (Write en la asignación, Read en el uso)', async () => {
    const hl = await documentHighlights(at('this.oMensajes.Advertir', 'this.o'.length), dragon.zoo.state()!, dragon.api);
    const lines = hl.map((h) => `${h.range.start.line}:${h.kind}`);
    expect(lines).toContain(`${lineOf('oMensajes = null')}:3`);
    expect(lines).toContain(`${lineOf('this.oMensajes = _Screen')}:3`);
    expect(lines).toContain(`${lineOf('this.oMensajes.Advertir')}:2`);
  });

  it('E1.3: document highlight de una local queda en su método; de un método, solo receptores de la jerarquía', async () => {
    const loc = await documentHighlights(at('loMensajes.Advertir', 2), dragon.zoo.state()!, dragon.api);
    expect(loc.map((h) => h.range.start.line)).toEqual([lineOf('local loMensajes'), lineOf('loMensajes = _Screen'), lineOf('loMensajes.Advertir')]);
    expect(loc[1].kind).toBe(3);
    const adv = await documentHighlights(at('goMensajes.Advertir', 'goMensajes.A'.length), dragon.zoo.state()!, dragon.api);
    const advLines = adv.map((h) => h.range.start.line);
    for (const n of ['this.oMensajes.Advertir', 'goServicios.Mensajes.Advertir', 'goMensajes.Advertir', 'loMensajes.Advertir']) expect(advLines, n).toContain(lineOf(n));
    expect(advLines).not.toContain(lineOf('loNada.Advertir'));
  });

  it('E1.4: call hierarchy de Mensajes.Advertir (entrantes con dodefault de overrides) y salientes de Probar', async () => {
    const st = dragon.zoo.state()!;
    const [item] = prepareCallHierarchy(at('goMensajes.Advertir', 'goMensajes.A'.length), dragon.api);
    expect(qualified(item)).toBe('Mensajes.Advertir');
    const incoming = await incomingCalls(item, st, dragon.api);
    const from = incoming.map((c) => qualified(c.from));
    expect(from).toEqual(expect.arrayContaining(['UsoMensajes.Probar', 'UsoMensajes.UsarLocal', 'UsoMensajesHija.Otra', 'MensajesHijo.Advertir', 'UsoDragonfish.ConNote']));
    expect(incoming.find((c) => qualified(c.from) === 'UsoMensajes.Probar')!.fromRanges).toHaveLength(3);

    const [probar] = prepareCallHierarchy(at('function Probar', 'function P'.length), dragon.api);
    expect(qualified(probar)).toBe('UsoMensajes.Probar');
    const outgoing = await outgoingCalls(probar, dragon.api);
    const to = outgoing.map((c) => qualified(c.to));
    expect(to).toContain('Mensajes.Advertir');
    expect(to).toContain('UsoMensajes.Probar');
    expect(outgoing.find((c) => qualified(c.to) === 'Mensajes.Advertir')!.fromRanges).toHaveLength(3); // loNada.Advertir queda afuera
  });
});

describe('capas T3/T4 sin fuentes', () => {
  it('Feline sin Core: goServicios.Mensajes.Advertir resuelve con .symbols y navega al stub', () => {
    const ctx = ctxAt(sinCore, 'FelineSinCore/Organic.BusinessLogic/CENTRALSS/Uso.prg', 'Advertir(', 2);
    const target = sinCore.resolver.resolveAt(ctx)!;
    expect(target.members![0].owner!.decl.name).toBe('Mensajes');
    const md = hoverMarkdown(sinCore.index, target)!;
    expect(md).toContain('Organic.Core.app');
    expect(md).toContain('símbolos v2.5');
    const loc = definitionWithLocals(target, ctx)[0];
    expect(loc.uri).toContain('_dovfp_stubs');
    expect(loc.range.start.line).toBeGreaterThan(0);
    const sh = signatureHelp(sinCore.index, sinCore.resolver, ctxAt(sinCore, 'FelineSinCore/Organic.BusinessLogic/CENTRALSS/Uso.prg', '"hola", ', 8))!;
    expect(sh.signatures[0].label).toContain('tnBotones');
    expect(sh.activeParameter).toBe(1);
  });

  it('lee columnas v2.6 (línea y doc)', () => {
    const informar = sinCore.index.findMember('Mensajes', 'InformarConNote')!;
    expect(informar.decl.doc?.category).toBe('Contrato');
    expect(informar.decl.doc?.params[0].name).toBe('tvMensaje');
    expect(splitColumns('a\\|b|c')).toEqual(['a|b', 'c']);
    expect(parseSymbolsText('# DOVFP Symbols v2.6\nX|CLASS|Custom|PRG|x.prg|t||').version).toBe('v2.6');
  });
});

describe('implementación, referencias, CodeLens (F2/F3/F7)', () => {
  it('Ctrl+F12 sobre ObtenerConcepto lista los 3 overrides de los consumidores', () => {
    const ctx = ctxAt(drawing, 'Organic.Drawing/Organic.BusinessLogic/CENTRALSS/Dibujante/_Base/ColaboradorListaDinamica.prg', 'function ObtenerConcepto', 'function '.length + 2);
    const locs = implementationLocations(drawing.index, drawing.resolver.resolveAt(ctx));
    expect(locs.map((l) => path.basename(l.uri)).sort()).toEqual([
      'ColorYTalle_ColaboradorListaDinamica.prg',
      'Felino_ColaboradorListaDinamica.prg',
      'ZL_ColaboradorListaDinamica.prg',
    ]);
  });

  it('Shift+F12 sobre la clase incluye el literal de fábrica y el DEFINE CLASS … AS', async () => {
    const ctx = ctxAt(drawing, 'Organic.Drawing/Organic.BusinessLogic/CENTRALSS/Dibujante/_Base/ColaboradorListaDinamica.prg', 'define class ColaboradorListaDinamica', 'define class '.length + 2);
    const target = drawing.resolver.resolveAt(ctx)!;
    const refs = await findReferences(target, drawing.zoo.state()!, drawing.api, false);
    const exact = refs.exact.map((l) => `${path.basename(l.uri)}:${l.range.start.line}`);
    expect(exact).toContain('ComboListaDinamica.prg:31');
    expect(exact).toContain('Felino_ColaboradorListaDinamica.prg:0');
  });

  it('CodeLens de subclases, overrides y resolución por fábrica', () => {
    const f = drawing.index.getFile(pathToUri(abs('Organic.Drawing/Organic.BusinessLogic/CENTRALSS/Dibujante/_Base/ColaboradorListaDinamica.prg')))!;
    const lenses = codeLenses(f.parsed, drawing.zoo.state()!, drawing.api);
    const titles = lenses.map((l) => l.command!.title);
    expect(titles.some((t) => /3 subclases/.test(t) && /CrearObjetoPorProducto\("ColaboradorListaDinamica"\)/.test(t))).toBe(true);
    expect(titles).toContain('3 overrides');
  });
});

describe('diagnósticos y NOTE aprobado', () => {
  const rel = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Uso.prg';
  const diagsFor = (h: Headless, r: string) => {
    const uri = pathToUri(abs(r));
    const f = h.index.getFile(uri)!;
    const lines = readPrgSync(abs(r)).split(/\r\n/);
    return zooDiagnostics(f, lines, h.zoo.state()!, h.api);
  };

  it('D3: clase de producto inalcanzable por fábrica', () => {
    const d = diagsFor(dragon, 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Ventas/colorytalle_colaboradorCheques.PRG');
    const d3 = d.find((x) => x.code === 'D3')!;
    expect(d3).toBeDefined();
    expect(path.basename(d3.related![0].uri)).toBe('entcolorytalle_comprobantedecaja.PRG');
  });

  it('D4, D5, N1 y N2', () => {
    const d = diagsFor(dragon, rel);
    const codes = d.map((x) => x.code);
    expect(d.find((x) => x.code === 'D4')!.message).toContain('NoExiste');
    expect(codes).toContain('D5');
    expect(codes).toContain('N1');
    const n2 = d.filter((x) => x.code === 'N2').map((x) => x.message).join(' ');
    expect(n2).toContain('tnDos');
    expect(n2).toContain('tcSobra');
  });

  it('quick fixes: agregar parámetro, categoría y generar NOTE desde la firma', async () => {
    const d = diagsFor(dragon, rel).map((x) => toLspDiagnostic(x));
    const uri = pathToUri(abs(rel));
    const n2 = d.filter((x) => x.code === 'N2' && (x.data as { kind?: string })?.kind === 'noteAddParams');
    const actions = await zooCodeActions(uri, n2, n2[0].range, dragon.zoo.state()!, dragon.api);
    const add = actions.find((a) => a.title.includes('tnDos'))!;
    const newText = add.edit!.changes![uri][0].newText;
    expect(newText).toMatch(/tcSobra - No esta en la firma\. ;\r\n\t+tnDos - Descripción\.$/);
    const n1 = d.filter((x) => x.code === 'N1');
    const catActions = await zooCodeActions(uri, n1, n1[0].range, dragon.zoo.state()!, dragon.api);
    expect(catActions.some((a) => a.edit!.changes![uri][0].newText.includes('NOTE\t[Dependencia] Sin categoria.'))).toBe(true);
    const text = readPrgSync(abs(rel));
    const sinNote = posOf(text, 'function SinNote');
    const gen = await zooCodeActions(uri, [], { start: sinNote, end: sinNote }, dragon.zoo.state()!, dragon.api);
    const g = gen.find((a) => a.title.startsWith('Generar NOTE'))!;
    // Mismo formato que ComboListaDinamica.prg: continuación con dos tabs más que el NOTE.
    expect(g.edit!.changes![uri][0].newText).toBe(
      '\tNOTE\t[Dependencia] Resumen de qué hace. ;\r\n\t\t\tParametros: ;\r\n\t\t\t\ttcA - Descripción. ;\r\n\t\t\tRetorna: String - Descripción.\r\n',
    );
  });

  it('N4 reemplaza al D1 de un NOTE dentro del cuerpo', () => {
    const text = 'function X\r\n\tNOTE dentro\r\n\treturn 1\r\nendfunc\r\n';
    const parsed = parsePrg(text, 'file:///x.prg');
    const out = reclassifyNoteDiagnostics(parsed.diagnostics, parsed);
    expect(out.map((d) => d.code)).toEqual(['N4']);
  });
});

describe('VCX', () => {
  it('indexa clases visuales y genera la vista de solo lectura', () => {
    const vcxClasses = [...feline.index.allFiles()].filter((f) => f.uri.startsWith('foxpro-vcx:'));
    expect(vcxClasses.length).toBeGreaterThan(0);
    const first = vcxClasses[0];
    const text = vcxContent(first.uri)!;
    expect(text).toMatch(/define class \w+ as \w+/i);
    expect(first.parsed.classes[0].fileType).toBe('vcx');
  });
});
