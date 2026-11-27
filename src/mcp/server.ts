/**
 * Servidor MCP (stdio) sobre el índice de Asistente VFP Zoo.
 *
 *   node dist/mcp.js --root c:\LinceV3\Organic.Dragonfish [--producto ColoryTalle]
 *        [--downstream ../Organic.ZL] [--source-root Organic.Core=../Organic.Core] [--generated none|headers|full]
 *
 * Herramientas: organic_resolve_factory, organic_class_hierarchy, organic_find_overrides, organic_get_doc, organic_find_class.
 */
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { classHover, memberHover, normalizePath, uriToPath } from 'asistente-vfp-core';
import type { ClassEntry, LayerInfo, SymbolIndex } from 'asistente-vfp-core';
import { createHeadless, Headless } from '../zoo/headless';
import { productLabel } from '../zoo/organic/factoryResolver';

interface Args {
  roots: string[];
  producto: string | null;
  downstream: string[];
  sourceRoots: Record<string, string>;
  generated: 'none' | 'headers' | 'full';
}

function parseArgs(argv: string[]): Args {
  const a: Args = { roots: [], producto: null, downstream: [], sourceRoots: {}, generated: 'none' };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--root':
        a.roots.push(normalizePath(v));
        i++;
        break;
      case '--producto':
        a.producto = v ?? '';
        i++;
        break;
      case '--downstream':
        a.downstream.push(v);
        i++;
        break;
      case '--source-root': {
        const [k, p] = v.split('=');
        a.sourceRoots[k] = p;
        i++;
        break;
      }
      case '--generated':
        a.generated = v as Args['generated'];
        i++;
        break;
    }
  }
  if (a.roots.length === 0) a.roots.push(normalizePath(process.cwd()));
  return a;
}

const args = parseArgs(process.argv.slice(2));
const log = (m: string): void => {
  process.stderr.write(`[asistente-vfp-zoo] ${m}
`);
};

let headless: Headless | undefined;
let index: SymbolIndex;

async function buildIndex(): Promise<void> {
  const started = Date.now();
  const key = crypto.createHash('sha1').update(JSON.stringify(args)).digest('hex').slice(0, 12);
  headless = await createHeadless({
    roots: args.roots,
    zoo: { producto: args.producto, sourceRoots: args.sourceRoots, downstreamRoots: args.downstream, indexGenerated: args.generated },
    cacheFile: path.join(os.tmpdir(), 'asistente-vfp-zoo', `mcp-${key}.json`),
    log,
  });
  index = headless.index;
  log(`Índice listo: ${headless.total} archivos, ${index.classNames().length} clases, ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

const ready = buildIndex().catch((e) => log(`Error indexando: ${(e as Error).message}`));

function where(e: { decl: { uri: string; nameRange: { start: { line: number } } }; layer: LayerInfo }): string {
  const u = e.decl.uri;
  const file = u.startsWith('file:') ? uriToPath(u) : u;
  return `${file}:${e.decl.nameRange.start.line + 1} (${e.layer.label})`;
}

function classOrError(name: string): ClassEntry {
  const c = index.getClass(name, { includeDownstream: true });
  if (!c) throw new Error(`No se encontró la clase "${name}".`);
  return c;
}

const TOOLS = [
  {
    name: 'organic_resolve_factory',
    description:
      'Resuelve qué clase concreta crea una fábrica del runtime Organic (InstanciarEntidad, InstanciarComponente, CrearObjetoPorProducto, CrearObjeto, CrearObjetoServicios, NuevoObjeto, IniciarServicio) para un literal, en el producto pedido y en todos los productos conocidos.',
    inputSchema: {
      type: 'object',
      properties: {
        metodo: { type: 'string', description: 'Nombre del método de fábrica, por ejemplo InstanciarEntidad.' },
        literal: { type: 'string', description: 'Argumento literal, por ejemplo "Cliente".' },
        producto: { type: 'string', description: 'cProyecto: "", FELINO, ColoryTalle o ZL. Por defecto, el detectado.' },
      },
      required: ['metodo', 'literal'],
    },
  },
  {
    name: 'organic_class_hierarchy',
    description: 'Jerarquía de una clase VFP: ancestros (con archivo y repo) y subclases transitivas en todos los repos indexados.',
    inputSchema: { type: 'object', properties: { clase: { type: 'string' } }, required: ['clase'] },
  },
  {
    name: 'organic_find_overrides',
    description: 'Dónde se define un método (ancestro más cercano) y todos sus overrides en las subclases.',
    inputSchema: { type: 'object', properties: { clase: { type: 'string' }, metodo: { type: 'string' } }, required: ['clase', 'metodo'] },
  },
  {
    name: 'organic_get_doc',
    description: 'Firma y documentación NOTE de una clase ("Clase"), un método o propiedad ("Clase.Miembro") o un procedimiento suelto, con la doc heredada si el método no tiene NOTE propio.',
    inputSchema: { type: 'object', properties: { simbolo: { type: 'string' } }, required: ['simbolo'] },
  },
  {
    name: 'organic_find_class',
    description: 'Busca clases por parte del nombre (sin distinguir mayúsculas). Devuelve hasta 50 con su archivo.',
    inputSchema: { type: 'object', properties: { patron: { type: 'string' } }, required: ['patron'] },
  },
];

async function callTool(name: string, a: Record<string, string>): Promise<string> {
  await ready;
  if (!headless) throw new Error('Índice no disponible.');
  const st = headless.zoo.state();
  switch (name) {
    case 'organic_resolve_factory': {
      if (!st) throw new Error('Índice no disponible.');
      const rule = st.factories.ruleFor(a.metodo);
      if (!rule) throw new Error(`"${a.metodo}" no es una fábrica conocida. Conocidas: ${st.factories.methodNames().join(', ')}.`);
      const lits: string[] = [];
      lits[rule.arg ?? 0] = a.literal;
      const product = a.producto ?? st.product();
      const res = st.factories.resolve(rule, lits, product, st.products());
      const lines = [
        `${a.metodo}("${a.literal}") con producto "${product}":`,
        `  efectiva: ${res.efectiva ? `${res.efectiva.name} — ${where(res.efectiva.entries[0])}` : '(ninguna)'}`,
        `  precedencia: ${res.names.join(' → ') || '(sin candidatos)'}`,
        ...res.found.map((f) => `  existe: ${f.name} — ${where(f.entries[0])}`),
      ];
      if (res.porProducto.length) {
        lines.push('  por producto:');
        for (const pp of res.porProducto) lines.push(`    ${productLabel(pp.product)}: ${pp.efectiva ? pp.efectiva.name : '—'}`);
      }
      if (res.net) lines.push('  (clase .NET/COM: sin fuente VFP)');
      return lines.join('\n');
    }
    case 'organic_class_hierarchy': {
      const c = classOrError(a.clase);
      const anc = index.ancestors(c);
      const subs = index.descendants(c.decl.name);
      return [
        `${c.decl.name} — ${where(c)}`,
        'Ancestros:',
        ...anc.map((x) => `  ${x.decl.name} — ${where(x)}`),
        ...(anc.length && anc[anc.length - 1].decl.parent ? [`  ${anc[anc.length - 1].decl.parent} (clase base)`] : c.decl.parent && !anc.length ? [`  ${c.decl.parent}`] : []),
        `Subclases (${subs.length}):`,
        ...subs.map((x) => `  ${x.decl.name} as ${x.decl.parent} — ${where(x)}`),
      ].join('\n');
    }
    case 'organic_find_overrides': {
      const def = index.findMember(a.clase, a.metodo, { includeDownstream: true });
      const owner = def?.owner?.decl.name ?? a.clase;
      const overrides = index.overrides(owner, a.metodo);
      return [
        def ? `Definido en ${owner}.${def.decl.name} — ${where(def)}` : `No se encontró ${a.clase}.${a.metodo}.`,
        `Overrides (${overrides.length}):`,
        ...overrides.map((o) => `  ${o.owner?.decl.name}.${o.decl.name} — ${where(o)}`),
      ].join('\n');
    }
    case 'organic_get_doc': {
      const [cls, member] = a.simbolo.split('.');
      if (member) {
        const m = index.findMember(cls, member, { includeDownstream: true });
        if (!m) throw new Error(`No se encontró ${a.simbolo}.`);
        return memberHover(index, m).join('\n\n');
      }
      const c = index.getClass(cls, { includeDownstream: true });
      if (c) return classHover(index, c).join('\n\n');
      const p = index.procedures(cls)[0];
      if (p) return memberHover(index, p).join('\n\n');
      throw new Error(`No se encontró "${a.simbolo}".`);
    }
    case 'organic_find_class': {
      const q = a.patron.toLowerCase();
      const names = index.classNames().filter((n) => n.toLowerCase().includes(q)).slice(0, 50);
      return names.map((n) => `${n} — ${where(index.getClass(n, { includeDownstream: true })!)}`).join('\n') || '(sin resultados)';
    }
    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } });
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notificación
  try {
    switch (method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'asistente-vfp-zoo', version: '0.1.0' },
          },
        });
        break;
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} });
        break;
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        break;
      case 'tools/call': {
        const name = params?.name as string;
        const toolArgs = (params?.arguments ?? {}) as Record<string, string>;
        try {
          const text = await callTool(name, toolArgs);
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
        } catch (e) {
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: (e as Error).message }], isError: true } });
        }
        break;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } });
    }
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: (e as Error).message } });
  }
});
