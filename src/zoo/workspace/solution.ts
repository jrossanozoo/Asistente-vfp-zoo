import fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from 'asistente-vfp-core';
import type { LayerInfo, RootSpec } from 'asistente-vfp-core';
import type { ZooSettings } from '../settings';

/** Orden de prioridad de duplicados (igual que InstanceFactory.MapaClasesSymbols). */
export const FRAMEWORK_ORDER = ['organic.core', 'organic.drawing', 'organic.generator', 'organic.adnimplant', 'organic.feline'];

export interface AppRef {
  /** Por ejemplo `Organic.Core`. */
  name: string;
  include: string;
  order: number;
  sourceRoot?: string;
  symbolsPath?: string;
  stubsDir?: string;
}

export interface Solution {
  folder: string;
  vfpproj?: string;
  projectName?: string;
  apps: AppRef[];
}

const APPREF_RE = /<AppReference\s+Include\s*=\s*"([^"]+)"/gi;

export function parseAppReferences(xml: string): string[] {
  const result: string[] = [];
  let m: RegExpExecArray | null;
  APPREF_RE.lastIndex = 0;
  while ((m = APPREF_RE.exec(xml))) result.push(m[1]);
  return result;
}

function firstExisting(paths: (string | undefined)[]): string | undefined {
  return paths.find((p) => p && fs.existsSync(p));
}

export function appOrder(name: string, fallback: number): number {
  const idx = FRAMEWORK_ORDER.indexOf(name.toLowerCase());
  return idx >= 0 ? idx : FRAMEWORK_ORDER.length + fallback;
}

/** Detecta la solución de una carpeta: .vfpproj, AppReference en orden y ubicación de fuentes/.symbols/stubs. */
export async function detectSolution(folder: string, settings: ZooSettings): Promise<Solution> {
  const projects = (
    await fg('**/*.vfpproj', {
      cwd: folder,
      deep: 3,
      caseSensitiveMatch: false,
      ignore: ['**/bin/**', '**/obj/**', '**/node_modules/**', '**/.git/**'],
      suppressErrors: true,
    })
  ).map((p) => path.join(folder, p));
  projects.sort((a, b) => {
    const sa = /organic\.businesslogic/i.test(a) ? 0 : 1;
    const sb = /organic\.businesslogic/i.test(b) ? 0 : 1;
    return sa - sb || a.length - b.length;
  });
  const vfpproj = projects[0];
  const solution: Solution = { folder, vfpproj, apps: [] };
  if (!vfpproj) return solution;
  solution.projectName = path.basename(vfpproj).replace(/\.vfpproj$/i, '');
  const projDir = path.dirname(vfpproj);
  const includes = parseAppReferences(fs.readFileSync(vfpproj, 'utf8'));
  const stubDirs = await fg('**/obj/*/_dovfp_stubs/*', {
    cwd: folder,
    absolute: true,
    deep: 6,
    onlyDirectories: true,
    caseSensitiveMatch: false,
    ignore: ['**/node_modules/**', '**/.git/**'],
    suppressErrors: true,
  });

  includes.forEach((include, i) => {
    const name = path.basename(include).replace(/\.app$/i, '');
    const configured = Object.entries(settings.sourceRoots).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
    const sourceRoot = configured
      ? normalizePath(path.resolve(folder, configured))
      : settings.autoSourceRoots
        ? firstExisting([path.resolve(folder, '..', name)])
        : undefined;
    const includePath = /[\\/]/.test(include) ? path.resolve(projDir, include) : undefined;
    const symbolsPath = firstExisting([
      includePath?.replace(/\.app$/i, '.symbols'),
      path.join(projDir, 'packages', 'App', `${name}.symbols`),
      path.join(folder, 'packages', 'App', `${name}.symbols`),
      sourceRoot ? path.join(sourceRoot, 'Organic.BusinessLogic', 'bin', 'App', `${name}.symbols`) : undefined,
    ]);
    const stubsDir = stubDirs
      .filter((d) => path.basename(d).toLowerCase() === name.toLowerCase())
      .sort((a, b) => (/organic\.tests\.unit/i.test(a) ? -1 : 0) - (/organic\.tests\.unit/i.test(b) ? -1 : 0))[0];
    solution.apps.push({
      name,
      include,
      order: appOrder(name, i),
      sourceRoot: sourceRoot && fs.existsSync(sourceRoot) ? normalizePath(sourceRoot) : undefined,
      symbolsPath: symbolsPath ? normalizePath(symbolsPath) : undefined,
      stubsDir: stubsDir ? normalizePath(stubsDir) : undefined,
    });
  });
  return solution;
}

export function sourceLayer(app: AppRef): LayerInfo {
  return { id: `src:${app.name}`, label: app.name, priority: 10 + app.order, role: 'source', quality: 'fuente' };
}

export function symbolsLayer(app: AppRef, version: string): LayerInfo {
  return { id: `sym:${app.name}`, label: `${app.name}.app`, priority: 100 + app.order, role: 'source', quality: `símbolos ${version} · sin fuente local` };
}

export function stubLayer(app: AppRef): LayerInfo {
  return { id: `stub:${app.name}`, label: `${app.name}.app`, priority: 200 + app.order, role: 'source', quality: 'stub dovfp' };
}

/** Carpetas de un repo Organic que se indexan como fuente. */
export function sourceFolders(repoRoot: string): string[] {
  const candidates = ['Organic.BusinessLogic', 'Organic.Generated', 'Organic.Hooks'].map((d) => path.join(repoRoot, d));
  const existing = candidates.filter((p) => fs.existsSync(p));
  return existing.length ? existing : [repoRoot];
}

/** Raíces T2 (fuentes hermanas) y T4 (stubs). T3 (.symbols) no son .prg: se cargan aparte. */
export function solutionRoots(solutions: Solution[], settings: ZooSettings): RootSpec[] {
  const roots: RootSpec[] = [];
  const seenApps = new Set<string>();
  for (const sol of solutions) {
    for (const app of sol.apps) {
      const key = app.name.toLowerCase();
      if (seenApps.has(key)) continue;
      seenApps.add(key);
      if (app.sourceRoot) {
        for (const f of sourceFolders(app.sourceRoot)) roots.push({ path: normalizePath(f), layer: sourceLayer(app) });
      }
      // T4 solo hace falta si no hay fuentes (T2): evita clases duplicadas en jerarquías e implementaciones.
      if (settings.stubsEnabled && app.stubsDir && !app.sourceRoot) roots.push({ path: app.stubsDir, layer: stubLayer(app) });
    }
  }
  return roots;
}
