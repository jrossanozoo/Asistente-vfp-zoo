import * as path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCursorContext,
  definitionWithLocals,
  hoverMarkdown,
  implementationLocations,
  parsePrg,
  pathToUri,
  readPrgSync,
  signatureHelp,
  toLspDiagnostic,
  typeDefinitionLocations,
} from 'asistente-vfp-core';
import type { CursorContext } from 'asistente-vfp-core';
import { createHeadless, Headless } from '../src/zoo/headless';
import { memberCompletion, factoryLiteralCompletion } from '../src/zoo/features/completion';
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
  const typeDef = (needle: string, delta: number, r = rel) => {
    const ctx = at(needle, delta, r);
    return names(typeDefinitionLocations(dragon.index, dragon.resolver.typeAt(ctx), ctx));
  };

  it('tabla de globales: goMensajes y goLibrerias salen de su servicio', () => {
    const svc = dragon.zoo.state()!.services;
    expect(svc.globals.find((g) => g.global === 'goMensajes')).toMatchObject({ appProp: 'oMensajes', service: 'Mensajes' });
    expect(svc.globals.find((g) => g.global === 'goLibrerias')).toBeUndefined(); // no hay servicio Librerias en la fixture
  });

  it('this.oMensajes (asignada con _Screen.Zoo.CrearObjeto): F12 → propiedad, Type Definition → Mensajes', () => {
    const decl = f12('this.oMensajes.Advertir', 'this.o'.length);
    expect(names(decl)).toEqual(['UsoMensajes.prg']);
    expect(decl[0].range.start.line).toBe(1);
    expect(typeDef('this.oMensajes.Advertir', 'this.o'.length)).toEqual(['mensajes.prg']);
  });

  it('this.oMensajes asignada en el Init de la clase padre (otro archivo) → Mensajes', () => {
    const hija = 'Organic.Dragonfish/Organic.BusinessLogic/CENTRALSS/ColorYTalle/Ventas/UsoMensajesHija.prg';
    expect(typeDef('this.oMensajes.Advertir', 'this.o'.length, hija)).toEqual(['mensajes.prg']);
    const adv = dragon.resolver.resolveAt(at('Advertir( "y"', 2, hija))!;
    expect(adv.heuristic).toBeFalsy();
    expect(adv.members![0].owner!.decl.name).toBe('Mensajes');
  });

  it('goServicios.Mensajes: F12 → propiedad, Type Definition → ColorYTalle_Mensajes y Mensajes (precedencia por producto)', () => {
    expect(names(f12('goServicios.Mensajes.', 'goServicios.M'.length))).toEqual(['serviciosaplicacion.PRG']);
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
    expect(names(f12('loNada.Advertir', 'loNada.A'.length))).toEqual(['mensajes.prg']);
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
