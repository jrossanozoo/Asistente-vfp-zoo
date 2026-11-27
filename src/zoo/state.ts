import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { normalizePath, parsePrg, pathToUri, readPrgSync, unquote, uriToPath } from 'asistente-vfp-core';
import type { CallSite, FileEntry, HostApi, LayerInfo } from 'asistente-vfp-core';
import { DEFAULT_FACTORY_RULES, NAMING_RULES } from './organic/factoryRules';
import { FactoryResolution, FactoryResolver, FactoryRule } from './organic/factoryResolver';
import { loadServicesTable, ServicesTable } from './organic/servicesTable';
import { readZooSettings, ZooSettings } from './settings';
import { Solution } from './workspace/solution';

export interface IndexedCall {
  call: CallSite;
  uri: string;
  layer: LayerInfo;
}

const GENERATED_RE = /[\\/]organic\.generated[\\/]/i;

export function isGeneratedPath(p: string): boolean {
  return GENERATED_RE.test(p);
}

const MOCKS_RE = /[\\/]organic\.mocks[\\/]/i;

/** Mocks generados para tests (`Organic.Mocks/Generados/Mock_*.prg`). */
export function isMockPath(p: string): boolean {
  return MOCKS_RE.test(p);
}

/** Archivos de test por nombre: `test*.prg` / `ztest*.prg`. */
const TEST_NAME_RE = /^z?test/i;
/** Stubs de dovfp: viven dentro del proyecto de tests (`obj\Test\_dovfp_stubs`) pero son clases de la aplicación. */
const STUBS_RE = /[\\/]_dovfp_stubs[\\/]/i;
const TEST_OUTPUT_RE = /<OutputType>\s*Test\s*<\/OutputType>/i;

/** Carpetas de los proyectos de tests (`.vfpproj` con `<OutputType>Test</OutputType>`) bajo las raíces dadas. */
export async function findTestFolders(roots: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const root of roots) {
    const projs = await fg('**/*.vfpproj', {
      cwd: root,
      deep: 2,
      caseSensitiveMatch: false,
      ignore: ['**/bin/**', '**/obj/**', '**/node_modules/**', '**/.git/**'],
      suppressErrors: true,
    });
    for (const rel of projs) {
      const full = path.join(root, rel);
      try {
        if (TEST_OUTPUT_RE.test(fs.readFileSync(full, 'utf8'))) out.add(normalizePath(path.dirname(full)));
      } catch {
        // proyecto ilegible: no cuenta como test
      }
    }
  }
  return [...out];
}

/** Estado compartido del plugin zoo. */
export class ZooState {
  settings: ZooSettings = readZooSettings(undefined);
  solutions: Solution[] = [];
  services: ServicesTable = { source: 'embedded', services: [], globals: [] };
  readonly factories: FactoryResolver;
  /** Generados por nombre de archivo (modo `none`). */
  generatedFiles = new Map<string, { path: string; layer: LayerInfo }>();
  /** Carpetas de proyectos de tests (normalizadas). */
  private testFolders: string[] = [];
  private testCache = new Map<string, boolean>();
  private productCache: { version: number; value: string } | undefined;
  private callCache: { version: number; byLiteral: Map<string, IndexedCall[]> } | undefined;

  constructor(readonly api: HostApi) {
    this.factories = new FactoryResolver(api.index, () => this.rules());
  }

  refreshSettings(): void {
    this.settings = readZooSettings(this.api.settings()['zoo'] as Record<string, unknown> | undefined);
    this.productCache = undefined;
  }

  rules(): FactoryRule[] {
    return [...DEFAULT_FACTORY_RULES, ...NAMING_RULES, ...(this.settings.factories ?? [])];
  }

  products(): string[] {
    const list = [...this.settings.productos];
    const p = this.product();
    if (!list.some((x) => x.toLowerCase() === p.toLowerCase())) list.push(p);
    return list;
  }

  /** Producto activo: configuración → `cProyecto = "X"` en la clase Aplicacion* del workspace → "". */
  product(): string {
    if (this.settings.producto !== null && this.settings.producto !== undefined) return this.settings.producto;
    const index = this.api.index;
    if (this.productCache?.version === index.version) return this.productCache.value;
    let best: { value: string; depth: number } | undefined;
    for (const name of index.classNames()) {
      if (!/^aplicacion/i.test(name)) continue;
      for (const e of index.classEntries(name, { includeDownstream: true })) {
        if (!e.layer.id.startsWith('workspace')) continue;
        const prop = e.decl.members.find((m) => m.kind === 'property' && m.name.toLowerCase() === 'cproyecto');
        if (!prop?.value) continue;
        const value = unquote(prop.value) ?? '';
        const depth = index.ancestors(e).length;
        if (!best || depth > best.depth) best = { value, depth };
      }
    }
    const value = best?.value ?? '';
    this.productCache = { version: index.version, value };
    return value;
  }

  resolveFactory(rule: FactoryRule, literals: (string | undefined)[]): FactoryResolution {
    return this.factories.resolve(rule, literals, this.product(), this.products());
  }

  /** Llamadas a fábricas registradas en todo el índice, por literal (minúsculas). */
  callsByLiteral(): Map<string, IndexedCall[]> {
    const index = this.api.index;
    if (this.callCache?.version === index.version) return this.callCache.byLiteral;
    const byLiteral = new Map<string, IndexedCall[]>();
    for (const f of index.allFiles()) {
      for (const call of f.parsed.calls) {
        const rule = this.factories.ruleFor(call.callee);
        const lit = call.args[rule?.arg ?? 0]?.literal;
        if (!lit) continue;
        const key = lit.toLowerCase();
        const list = byLiteral.get(key) ?? [];
        list.push({ call, uri: f.parsed.uri, layer: f.layer });
        byLiteral.set(key, list);
      }
    }
    this.callCache = { version: index.version, byLiteral };
    return byLiteral;
  }

  /**
   * Cómo se crea una clase por fábrica, según las llamadas reales del índice:
   * regla, literal X y productos en los que la fábrica resuelve exactamente a esa clase.
   */
  factoryUsage(className: string): { rule: FactoryRule; x: string; products: string[] } | undefined {
    const calls = this.callsByLiteral();
    const products = this.products();
    const target = className.toLowerCase();
    for (const rule of this.rules()) {
      if (!rule.productAware || rule.method.startsWith('#')) continue;
      const method = rule.method.toLowerCase();
      for (const { x } of this.factories.untemplate(rule, className, products)) {
        const used = (calls.get(x.toLowerCase()) ?? []).some((ic) => ic.call.callee.toLowerCase() === method);
        if (!used) continue;
        const lits: (string | undefined)[] = [];
        lits[rule.arg ?? 0] = x;
        const hits = products.filter((p) => this.factories.resolve(rule, lits, p, []).efectiva?.name.toLowerCase() === target);
        if (hits.length) return { rule, x, products: hits };
      }
    }
    return undefined;
  }

  /** Modo `none`: arma el mapa nombre → archivo de los generados (sin abrirlos). */
  async buildGeneratedMap(roots: { path: string; layer: LayerInfo }[]): Promise<void> {
    this.generatedFiles.clear();
    for (const r of roots) {
      const files = await fg('**/*.prg', { cwd: r.path, absolute: true, caseSensitiveMatch: false, suppressErrors: true });
      for (const f of files) {
        const key = path.basename(f).replace(/\.prg$/i, '').toLowerCase();
        if (!this.generatedFiles.has(key)) this.generatedFiles.set(key, { path: normalizePath(f), layer: r.layer });
      }
    }
  }

  setTestFolders(folders: string[]): void {
    this.testFolders = folders.map((f) => normalizePath(f).toLowerCase() + path.sep);
    this.testCache.clear();
  }

  /**
   * Archivo de test: dentro de un proyecto de tests, con nombre `test*` / `ztest*`, o un mock (`Organic.Mocks`).
   * Los stubs de dovfp nunca son de test.
   */
  isTestUri(uri: string): boolean {
    let v = this.testCache.get(uri);
    if (v === undefined) {
      v = false;
      if (uri.startsWith('file:')) {
        const p = uriToPath(uri);
        if (!STUBS_RE.test(p)) {
          const lower = p.toLowerCase();
          v = isMockPath(p) || TEST_NAME_RE.test(path.basename(p)) || this.testFolders.some((f) => lower.startsWith(f));
        }
      }
      this.testCache.set(uri, v);
    }
    return v;
  }

  /** Generados del mapa que están bajo `folder` (modo `none`). */
  generatedCount(folder: string): number {
    const prefix = normalizePath(folder).toLowerCase() + path.sep;
    let n = 0;
    for (const g of this.generatedFiles.values()) if (g.path.toLowerCase().startsWith(prefix)) n++;
    return n;
  }

  /** Carga perezosa (modo `none`): la clase X está en X.prg. */
  loadGenerated(name: string): FileEntry | undefined {
    const hit = this.generatedFiles.get(name.toLowerCase());
    if (!hit) return undefined;
    try {
      const uri = pathToUri(hit.path);
      const parsed = parsePrg(readPrgSync(hit.path), uri, { headersOnly: true });
      return { uri, parsed, layer: hit.layer };
    } catch {
      return undefined;
    }
  }

  refreshServices(): void {
    this.services = loadServicesTable(this.api.index);
  }
}
