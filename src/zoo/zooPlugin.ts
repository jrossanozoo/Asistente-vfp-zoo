import fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePath, pathToUri, uriToPath } from 'asistente-vfp-core';
import type { FileEntry, HostApi, LayerInfo, RootSpec, VfpPlugin } from 'asistente-vfp-core';
import { nativeSignature } from './data/nativeFunctions';
import { codeLenses } from './features/codeLens';
import { factoryLiteralCompletion, memberCompletion } from './features/completion';
import { findReferences } from './features/references';
import { reclassifyNoteDiagnostics, zooCodeActions, zooDiagnostics } from './diagnostics/zooDiagnostics';
import { ZooStringResolver, ZooTypeResolver } from './inference/typeInference';
import { productLabel } from './organic/factoryResolver';
import { makeLocator, readSymbolsFile, symbolsToEntries } from './layers/symbolsReader';
import { isGeneratedPath, ZooState } from './state';
import { vcxContent, vcxEntries } from './vcx/vcxReader';
import { detectSolution, solutionRoots, sourceFolders, sourceLayer, symbolsLayer } from './workspace/solution';

export const REQUEST_PREFIX = 'asistenteVfpZoo';

export interface ZooPluginHandle {
  plugin: VfpPlugin;
  state: () => ZooState | undefined;
}

const WORKSPACE_LAYER: LayerInfo = { id: 'workspace', label: 'Workspace', priority: 0, role: 'source', quality: 'fuente' };

export function createZooPlugin(): ZooPluginHandle {
  let state: ZooState | undefined;
  const S = (api: HostApi): ZooState => (state ??= new ZooState(api));

  const typeResolver = {
    resolveChain: (chain: string[], ctx: Parameters<ZooTypeResolver['resolveChain']>[1], api: HostApi) =>
      new ZooTypeResolver(S(api)).resolveChain(chain, ctx, api),
  };
  const stringResolver = {
    resolveString: (call: Parameters<ZooStringResolver['resolveString']>[0], ctx: Parameters<ZooStringResolver['resolveString']>[1], api: HostApi) =>
      new ZooStringResolver(S(api)).resolveString(call, ctx, api),
  };

  async function indexVcx(api: HostApi, roots: { path: string; layer: LayerInfo }[]): Promise<number> {
    let count = 0;
    const seen = new Set<string>();
    for (const r of roots) {
      if (!fs.existsSync(r.path)) continue;
      // Rutas relativas: los ignore de fast-glob no deben evaluarse sobre la ruta absoluta.
      const files = await fg('**/*.vcx', {
        cwd: r.path,
        caseSensitiveMatch: false,
        ignore: ['**/bin/**', '**/obj/**', '**/node_modules/**', '**/.git/**'],
        suppressErrors: true,
      });
      for (const f of files) {
        const p = normalizePath(path.join(r.path, f));
        if (seen.has(p.toLowerCase())) continue;
        seen.add(p.toLowerCase());
        try {
          for (const e of vcxEntries(p, r.layer)) {
            api.index.upsert(e);
            count++;
          }
        } catch (e) {
          api.log(`VCX ilegible ${p}: ${(e as Error).message}`);
        }
      }
    }
    return count;
  }

  /** Stubs de dovfp con `* @source ruta:línea` (propuesta 6.6): navegan al fuente real. */
  function applyStubSources(api: HostApi): void {
    for (const f of api.index.allFiles()) {
      if (!f.layer.id.startsWith('stub:')) continue;
      for (const c of f.parsed.classes) {
        for (const m of c.members) {
          const src = /^@source\s+(.+):(\d+)$/i.exec(m.doc?.summary ?? '');
          if (!src || !fs.existsSync(src[1])) continue;
          m.uri = pathToUri(src[1]);
          const line = Math.max(0, parseInt(src[2], 10) - 1);
          m.nameRange = { start: { line, character: 0 }, end: { line, character: 0 } };
          m.doc = m.doc && m.doc.detail.length ? { ...m.doc, summary: m.doc.detail[0], detail: m.doc.detail.slice(1) } : undefined;
        }
      }
    }
  }

  const plugin: VfpPlugin = {
    id: 'zoo',
    configSections: [],
    callNames: [
      'instanciarentidad',
      'instanciarcomponente',
      'crearobjetoporproducto',
      'crearobjetoservicios',
      'crearobjeto',
      'nuevoobjeto',
      'obtenerherenciadenombre',
      'iniciarservicio',
      'loadreference',
    ],
    typeResolvers: [typeResolver],
    stringResolvers: [stringResolver],
    signatureFallback: nativeSignature,

    capabilities: () => ({
      referencesProvider: true,
      codeLensProvider: { resolveProvider: false },
      completionProvider: { triggerCharacters: ['.', '"', "'", '['], resolveProvider: false },
    }),

    async roots(api): Promise<RootSpec[]> {
      const st = S(api);
      st.refreshSettings();
      st.solutions = await Promise.all(api.workspaceRoots().map((f) => detectSolution(f, st.settings)));
      for (const sol of st.solutions) {
        api.log(
          `Solución ${sol.projectName ?? '(sin .vfpproj)'}: ` +
            sol.apps.map((a) => `${a.name}[${a.sourceRoot ? 'fuente' : a.symbolsPath ? 'symbols' : a.stubsDir ? 'stubs' : '—'}]`).join(', '),
        );
      }
      return solutionRoots(st.solutions, st.settings);
    },

    parseHint(p, api) {
      if (!isGeneratedPath(p)) return undefined;
      const mode = S(api).settings.indexGenerated;
      if (mode === 'none') return { skip: true };
      return { headersOnly: mode === 'headers' };
    },

    async afterIndex(api) {
      const st = S(api);
      const s = st.settings;
      const index = api.index;
      // Generados por nombre de archivo (modo none).
      if (s.indexGenerated === 'none') {
        const genRoots: { path: string; layer: LayerInfo }[] = api.workspaceRoots().map((f) => ({
          path: path.join(f, 'Organic.Generated'),
          layer: { ...WORKSPACE_LAYER, label: path.basename(f) },
        }));
        for (const sol of st.solutions) {
          for (const app of sol.apps) {
            if (app.sourceRoot) genRoots.push({ path: path.join(app.sourceRoot, 'Organic.Generated'), layer: sourceLayer(app) });
          }
        }
        await st.buildGeneratedMap(genRoots.filter((r) => fs.existsSync(r.path)));
        index.classLoader = (name) => st.loadGenerated(name);
      } else {
        index.classLoader = undefined;
      }
      // T3: .symbols de los .app sin fuentes.
      if (s.symbolsEnabled) {
        for (const sol of st.solutions) {
          for (const app of sol.apps) {
            if (app.sourceRoot || !app.symbolsPath) continue;
            try {
              const file = readSymbolsFile(app.symbolsPath);
              const entries = symbolsToEntries(app.symbolsPath, file, symbolsLayer(app, file.version), makeLocator(index, app.sourceRoot, app.stubsDir));
              for (const e of entries) index.upsert(e);
              api.log(`${app.name}: ${file.rows.length} símbolos (${file.version}) desde ${app.symbolsPath}`);
            } catch (e) {
              api.log(`No se pudo leer ${app.symbolsPath}: ${(e as Error).message}`);
            }
          }
        }
      }
      applyStubSources(api);
      // VCX del workspace y de las fuentes hermanas.
      if (s.vcxEnabled) {
        const vcxRoots: { path: string; layer: LayerInfo }[] = api.workspaceRoots().map((f) => ({ path: f, layer: { ...WORKSPACE_LAYER, label: path.basename(f) } }));
        for (const sol of st.solutions) {
          for (const app of sol.apps) {
            if (app.sourceRoot) for (const folder of sourceFolders(app.sourceRoot)) vcxRoots.push({ path: folder, layer: sourceLayer(app) });
          }
        }
        const n = await indexVcx(api, vcxRoots);
        if (n) api.log(`${n} clases visuales (VCX) indexadas.`);
      }
      st.refreshServices();
      api.log(`Producto activo: "${st.product()}". Tabla de servicios: ${st.services.source} (${st.services.services.length} servicios, ${st.services.globals.length} globales).`);
    },

    register(api) {
      const c = api.connection;
      c.onReferences(async (p) => {
        const ctx = await api.cursorContext(p.textDocument.uri, p.position);
        if (!ctx) return [];
        const target = api.resolver.resolveAt(ctx);
        if (!target) return [];
        const r = await findReferences(target, S(api), api, p.context.includeDeclaration);
        return [...r.exact, ...r.heuristic];
      });
      c.onCodeLens(async (p) => {
        const st = S(api);
        if (!st.settings.codeLens) return [];
        const ctx = await api.cursorContext(p.textDocument.uri, { line: 0, character: 0 });
        return ctx ? codeLenses(ctx.parsed, st, api) : [];
      });
      c.onCompletion(async (p) => {
        const ctx = await api.cursorContext(p.textDocument.uri, p.position);
        if (!ctx) return [];
        const items = factoryLiteralCompletion(ctx, S(api)) ?? memberCompletion(ctx, api) ?? [];
        return { isIncomplete: false, items };
      });
      c.onRequest(`${REQUEST_PREFIX}/vcxContent`, (params: { uri: string }) => vcxContent(params.uri) ?? null);
      c.onRequest(`${REQUEST_PREFIX}/products`, () => {
        const st = S(api);
        return {
          product: st.product(),
          configured: st.settings.producto,
          products: st.products(),
          solutions: st.solutions,
          services: st.services.source,
        };
      });
    },

    diagnose(file: FileEntry, ctx, api) {
      return zooDiagnostics(file, ctx.lines, S(api), api);
    },

    transformDiagnostics(diags, file) {
      return reclassifyNoteDiagnostics(diags, file.parsed);
    },

    codeActions(uri, diagnostics, range, api) {
      return zooCodeActions(uri, diagnostics, range, S(api), api);
    },

    hover(target, _ctx, api) {
      if (target.kind !== 'class' || !target.classes?.length || target.multi) return undefined;
      const usage = S(api).factoryUsage(target.classes[0].decl.name);
      if (!usage) return undefined;
      return [`**Creada por fábrica:** ${usage.rule.method}("${usage.x}") en ${usage.products.map(productLabel).join(', ')}.`];
    },
  };
  return { plugin, state: () => state };
}

