import { memberLocals, readPrgSync, splitLines, uriToPath } from 'asistente-vfp-core';
import type { MemberDecl, ParsedFile, SymbolIndex } from 'asistente-vfp-core';
import embedded from './servicesTable.embedded.json';

/** `goServicios.<prop>` → clase creada por la fábrica. */
export interface ServiceEntry {
  prop: string;
  /** Método de fábrica (CrearObjetoServicios, CrearObjetoPorProducto, CrearObjeto). */
  method: string;
  x: string;
  /** Plantillas explícitas (para servicios con producto como sufijo). */
  candidates?: string[];
}

/**
 * Global `goX` / propiedad `_screen.zoo.app.oX` creada por IniciarServicio
 * o tomada de un servicio (`public goMensajes` + `this.oMensajes = goServicios.Mensajes`).
 */
export interface GlobalEntry {
  global: string;
  appProp: string;
  x: string;
  candidates?: string[];
  /** Servicio de `goServicios` del que sale: su tipo es el del servicio. */
  service?: string;
}

export interface ServicesTable {
  source: 'core' | 'embedded';
  services: ServiceEntry[];
  globals: GlobalEntry[];
}

/** Servicios que arman el nombre con el producto como sufijo (no hay literal en la llamada). */
const SUFFIX_SERVICES: ServiceEntry[] = [
  { prop: 'Seguridad', method: 'CrearObjetoServicios', x: 'Seguridad', candidates: ['Seguridad{P}', '{P}_Seguridad', 'Seguridad'] },
  { prop: 'Modulos', method: 'CrearObjetoServicios', x: 'Modulos', candidates: ['Modulos{P}', '{P}_Modulos', 'Modulos'] },
];
const SUFFIX_GLOBALS: GlobalEntry[] = [{ global: 'goModulos', appProp: 'oModulos', x: 'Modulos', candidates: ['Modulos{P}', '{P}_Modulos', 'Modulos'] }];

const FACTORY_CALLS = new Set(['crearobjetoservicios', 'crearobjetoporproducto', 'crearobjeto']);

export function extractServices(servicios: ParsedFile | undefined, appBase: ParsedFile | undefined): ServicesTable {
  const services: ServiceEntry[] = [];
  const seen = new Set<string>();
  for (const call of servicios?.calls ?? []) {
    const m = /^(\w+)_access$/i.exec(call.container?.member ?? '');
    if (!m || !FACTORY_CALLS.has(call.callee.toLowerCase())) continue;
    const lit = call.args[0]?.literal;
    if (!lit || seen.has(m[1].toLowerCase())) continue;
    seen.add(m[1].toLowerCase());
    services.push({ prop: m[1], method: call.callee, x: lit });
  }
  const globals: GlobalEntry[] = [];
  for (const call of appBase?.calls ?? []) {
    if (call.callee.toLowerCase() !== 'iniciarservicio') continue;
    const cls = call.args[0]?.literal;
    const appProp = call.args[1]?.literal;
    if (!cls || !appProp) continue;
    const global = call.args[2]?.literal || `g${appProp}`;
    if (globals.some((g) => g.global.toLowerCase() === global.toLowerCase())) continue;
    globals.push({ global, appProp, x: cls });
  }
  // `public goX` + `this.oX = goServicios.X` + `goX = this.oX` (goMensajes, goLibrerias):
  // no pasan por IniciarServicio; la global se llama como el servicio y tiene su tipo.
  for (const c of appBase?.classes ?? []) {
    for (const m of c.members) {
      for (const v of m.locals ?? []) {
        if (v.kind !== 'public') continue;
        const g = /^go(\w+)$/i.exec(v.name);
        if (!g || globals.some((e) => e.global.toLowerCase() === v.name.toLowerCase())) continue;
        const svc = services.find((s) => s.prop.toLowerCase() === g[1].toLowerCase());
        if (!svc) continue;
        globals.push({ global: v.name, appProp: `o${svc.prop}`, x: svc.x, service: svc.prop });
      }
    }
  }
  return { source: 'core', services, globals };
}

function withOverrides(t: ServicesTable): ServicesTable {
  const services = [...t.services];
  for (const s of SUFFIX_SERVICES) {
    const i = services.findIndex((e) => e.prop.toLowerCase() === s.prop.toLowerCase());
    if (i >= 0) services[i] = s;
    else services.push(s);
  }
  const globals = [...t.globals];
  for (const g of SUFFIX_GLOBALS) if (!globals.some((e) => e.global.toLowerCase() === g.global.toLowerCase())) globals.push(g);
  return { ...t, services, globals };
}

/** Toma la tabla del código de Core (T2) si está en el índice con fuente; si no, la embebida. */
const isCode = (m: MemberDecl): boolean => m.kind === 'method' || m.kind === 'procedure' || m.kind === 'function';

/** El índice del workspace no guarda las variables de cada método: las recalcula desde el fuente. */
function withLocals(p: ParsedFile | undefined): ParsedFile | undefined {
  if (!p || p.classes.every((c) => c.members.every((m) => !isCode(m) || m.locals))) return p;
  try {
    const lines = splitLines(readPrgSync(uriToPath(p.uri)));
    const fill = (m: MemberDecl): MemberDecl => (isCode(m) && !m.locals ? { ...m, locals: memberLocals(lines, m) } : m);
    return { ...p, classes: p.classes.map((c) => ({ ...c, members: c.members.map(fill) })) };
  } catch {
    return p;
  }
}

export function loadServicesTable(index: SymbolIndex): ServicesTable {
  const fileOf = (className: string): ParsedFile | undefined => {
    const entry = index
      .classEntries(className)
      .find((e) => e.decl.uri.startsWith('file:') && !e.decl.approximate && (e.layer.id.startsWith('src:') || e.layer.id.startsWith('workspace')));
    if (!entry) return undefined;
    const f = index.getFile(entry.fileUri ?? entry.decl.uri);
    return f && !f.parsed.headersOnly ? f.parsed : undefined;
  };
  const servicios = fileOf('ServiciosAplicacion');
  const appBase = withLocals(fileOf('AplicacionBase'));
  if (servicios && appBase) {
    const t = extractServices(servicios, appBase);
    if (t.services.length > 5) return withOverrides(t);
  }
  return withOverrides({ ...(embedded as ServicesTable), source: 'embedded' });
}
