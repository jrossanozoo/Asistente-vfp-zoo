import * as path from 'path';
import { buildCursorContext, normalizePath, ParseCache, readPrg, Resolver, scanRoots, SymbolIndex, uriToPath, workspaceLayer } from 'asistente-vfp-core';
import type { HostApi, RootSpec, VfpPlugin } from 'asistente-vfp-core';
import { createZooPlugin, ZooPluginHandle } from './zooPlugin';

export interface HeadlessOptions {
  roots: string[];
  /** Configuración `zoo.*` (mismas claves que en VS Code). */
  zoo?: Record<string, unknown>;
  cacheFile?: string;
  log?: (m: string) => void;
  /** Documentos en memoria (para tests): uri → texto. */
  overrides?: Map<string, string>;
}

export interface Headless {
  index: SymbolIndex;
  resolver: Resolver;
  api: HostApi;
  zoo: ZooPluginHandle;
  plugins: VfpPlugin[];
  total: number;
}

/** Índice completo de zoo sin VS Code (servidor MCP, tests, scripts). */
export async function createHeadless(opts: HeadlessOptions): Promise<Headless> {
  const log = opts.log ?? (() => undefined);
  const index = new SymbolIndex();
  const zoo = createZooPlugin();
  const plugins = [zoo.plugin];
  const roots = opts.roots.map(normalizePath);
  const settings = { zoo: opts.zoo ?? {} };
  // eslint-disable-next-line prefer-const
  let api: HostApi;
  const resolver = new Resolver(index, () => plugins, () => api);
  const getText = async (uri: string): Promise<string | undefined> =>
    opts.overrides?.get(uri) ?? readPrg(uriToPath(uri)).catch(() => undefined);
  api = {
    connection: undefined as unknown as HostApi['connection'],
    index,
    resolver,
    settings: () => settings,
    workspaceRoots: () => roots,
    getText,
    cursorContext: async (uri, position) => {
      const text = await getText(uri);
      const f = index.getFile(uri);
      if (text === undefined || !f) return undefined;
      return buildCursorContext(uri, text, f.parsed, position, index, f.layer);
    },
    log,
    reindex: async () => undefined,
  };
  // La primera raíz es el proyecto activo.
  const specs: RootSpec[] = roots.map((r, i) => ({ path: r, layer: workspaceLayer(r, i) }));
  specs.push(...(await zoo.plugin.roots!(api)));
  const downstream = (settings.zoo.downstreamRoots as string[] | undefined) ?? [];
  downstream.forEach((d, i) => {
    const p = normalizePath(path.resolve(roots[0], d));
    specs.push({ path: p, layer: { id: `downstream:${i}`, label: `${path.basename(p)} (consumidor)`, priority: 1000 + i, role: 'downstream', quality: 'fuente' } });
  });
  const seen = new Set<string>();
  const unique = specs.filter((s) => (seen.has(s.path.toLowerCase()) ? false : (seen.add(s.path.toLowerCase()), true)));
  const cache = opts.cacheFile ? new ParseCache(opts.cacheFile, JSON.stringify({ calls: zoo.plugin.callNames })) : undefined;
  await cache?.load();
  const total = await scanRoots(unique, index, {
    exclude: ['**/node_modules/**', '**/.git/**', '**/bin/**', '**/obj/**'],
    headersOnly: ['**/*Generated*/**'],
    maxFileSizeKB: 512,
    callNames: ['createobject', 'newobject', ...(zoo.plugin.callNames ?? [])],
    fallbackComments: true,
    parseHint: (p) => zoo.plugin.parseHint?.(p, api),
    cache,
  });
  await zoo.plugin.afterIndex!(api);
  await cache?.save().catch((e: Error) => log(e.message));
  return { index, resolver, api, zoo, plugins, total };
}
