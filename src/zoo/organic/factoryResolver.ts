import type { ClassEntry, SymbolIndex } from 'asistente-vfp-core';

export interface FactoryRule {
  /** Nombre del método de fábrica (sin distinguir mayúsculas). `#Nombre` = regla de nombres sin llamada. */
  method: string;
  /** Receptores aceptados (informativo). */
  receiver?: string[];
  /** Índice del argumento con el nombre. */
  arg?: number;
  /** Índice del argumento con la librería (archivo). */
  libArg?: number;
  /** Plantillas de candidatos en orden de precedencia. */
  candidates?: string[];
  /** ObtenerHerenciaDeNombre("A,B,C", X, S): índice de la lista de prefijos. */
  prefixListArg?: number;
  suffixArg?: number;
  /** Un nombre con punto es una clase .NET/COM (sin destino navegable). */
  netIfDot?: boolean;
  /** Métodos que la fábrica llama después de crear (informativo). */
  after?: string[];
  /** La resolución depende del producto. */
  productAware?: boolean;
}

export interface FoundCandidate {
  name: string;
  entries: ClassEntry[];
}

export interface FactoryResolution {
  rule: FactoryRule;
  x: string;
  product: string;
  /** Nombres candidatos en orden (después de expandir las plantillas). */
  names: string[];
  /** Candidatos que existen en el índice, en orden de precedencia. */
  found: FoundCandidate[];
  efectiva?: FoundCandidate;
  porProducto: { product: string; efectiva?: FoundCandidate }[];
  net?: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function productLabel(p: string): string {
  return p === '' ? '(sin producto: Core/Drawing/Generator)' : p;
}

export class FactoryResolver {
  private completionCache: { version: number; key: string; items: { x: string; rule: FactoryRule }[] } | undefined;

  constructor(
    private readonly index: SymbolIndex,
    private readonly rules: () => FactoryRule[],
  ) {}

  ruleFor(callee: string): FactoryRule | undefined {
    const lower = callee.toLowerCase();
    // Las reglas configuradas por el usuario van al final y reemplazan a las embebidas.
    const all = this.rules();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].method.toLowerCase() === lower) return all[i];
    return undefined;
  }

  methodNames(): string[] {
    return [...new Set(this.rules().filter((r) => !r.method.startsWith('#')).map((r) => r.method.toLowerCase()))];
  }

  /** Nombres candidatos para un producto. */
  expand(rule: FactoryRule, literals: (string | undefined)[], product: string): string[] {
    if (rule.prefixListArg !== undefined) {
      const prefixes = (literals[rule.prefixListArg] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const x = literals[rule.arg ?? 1] ?? '';
      const suffix = rule.suffixArg !== undefined ? (literals[rule.suffixArg] ?? '') : '';
      return x ? prefixes.map((p) => p + x + suffix) : [];
    }
    const x = literals[rule.arg ?? 0];
    if (!x) return [];
    const names: string[] = [];
    for (const t of rule.candidates ?? ['{X}']) {
      if (t.includes('{P}') && product === '') continue;
      names.push(t.split('{P}').join(product).split('{X}').join(x));
    }
    return names;
  }

  private find(names: string[]): FoundCandidate[] {
    const found: FoundCandidate[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entries = this.index.classEntries(n, { includeDownstream: true });
      if (entries.length) found.push({ name: entries[0].decl.name, entries });
    }
    return found;
  }

  resolve(rule: FactoryRule, literals: (string | undefined)[], product: string, products: string[]): FactoryResolution {
    const x = rule.prefixListArg !== undefined ? (literals[rule.arg ?? 1] ?? '') : (literals[rule.arg ?? 0] ?? '');
    if (rule.netIfDot && x.includes('.')) {
      return { rule, x, product, names: [], found: [], porProducto: [], net: true };
    }
    const names = this.expand(rule, literals, product);
    const found = this.find(names);
    const porProducto = (rule.productAware ? products : []).map((p) => ({
      product: p,
      efectiva: this.find(this.expand(rule, literals, p))[0],
    }));
    return { rule, x, product, names, found, efectiva: found[0], porProducto };
  }

  /** Dado un nombre de clase, qué valores de X (y productos) de la regla podrían producirlo. */
  untemplate(rule: FactoryRule, className: string, products: string[]): { x: string; product?: string }[] {
    const result: { x: string; product?: string }[] = [];
    const prods = products.filter((p) => p !== '').map(escapeRe);
    for (const t of rule.candidates ?? []) {
      const hasP = t.includes('{P}');
      if (hasP && prods.length === 0) continue;
      const pattern = escapeRe(t)
        .replace(escapeRe('{P}'), `(${prods.join('|')})`)
        .replace(escapeRe('{X}'), '(\\w+)');
      const m = new RegExp(`^${pattern}$`, 'i').exec(className);
      if (!m) continue;
      const pIdx = hasP ? t.indexOf('{P}') : -1;
      const xIdx = t.indexOf('{X}');
      if (hasP) {
        const pGroup = pIdx < xIdx ? 1 : 2;
        const xGroup = pIdx < xIdx ? 2 : 1;
        result.push({ x: m[xGroup], product: products.find((p) => p.toLowerCase() === m[pGroup].toLowerCase()) });
      } else {
        result.push({ x: m[1] });
      }
    }
    return result;
  }

  /** Productos en los que la regla con argumento X resuelve exactamente a la clase. */
  productsResolvingTo(rule: FactoryRule, className: string, products: string[]): { x: string; products: string[] } | undefined {
    for (const { x } of this.untemplate(rule, className, products)) {
      const lits: (string | undefined)[] = [];
      lits[rule.arg ?? 0] = x;
      const hits = products.filter((p) => this.find(this.expand(rule, lits, p))[0]?.name.toLowerCase() === className.toLowerCase());
      if (hits.length) return { x, products: hits };
    }
    return undefined;
  }

  /** Valores de X que la regla puede resolver (para la completion dentro del literal). */
  completionValues(rule: FactoryRule, products: string[]): string[] {
    const key = `${rule.method}|${products.join(',')}`;
    if (!this.completionCache || this.completionCache.version !== this.index.version || this.completionCache.key !== key) {
      const items: { x: string; rule: FactoryRule }[] = [];
      const seen = new Set<string>();
      for (const name of this.index.classNames()) {
        for (const { x } of this.untemplate(rule, name, products)) {
          const k = x.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          items.push({ x, rule });
        }
      }
      this.completionCache = { version: this.index.version, key, items };
    }
    return this.completionCache.items.map((i) => i.x);
  }
}

/** Tabla Markdown de resolución por producto para el hover. */
export function resolutionMarkdown(res: FactoryResolution, callee: string): string {
  const out: string[] = [];
  if (res.net) {
    out.push(`**${callee}("${res.x}")**: clase .NET/COM, sin destino navegable.`);
    return out.join('\n\n');
  }
  const ef = res.efectiva ? `\`${res.efectiva.name}\` (${res.efectiva.entries[0].layer.label})` : '_ninguna clase encontrada_';
  out.push(`**${callee}("${res.x}")** → ${ef}${res.product !== undefined ? ` · producto \`${res.product || '""'}\`` : ''}`);
  if (res.porProducto.length) {
    const rows = res.porProducto.map((pp) => `| ${productLabel(pp.product)} | ${pp.efectiva ? `\`${pp.efectiva.name}\`` : '—'} |`);
    out.push(['| Producto | Clase efectiva |', '|---|---|', ...rows].join('\n'));
  }
  if (res.names.length) {
    const marks = res.names.map((n) => (res.found.some((f) => f.name.toLowerCase() === n.toLowerCase()) ? `\`${n}\` ✓` : `~~${n}~~`));
    out.push(`Precedencia: ${marks.join(' → ')}`);
  }
  if (res.rule.after?.length) out.push(`_Después de crear llama a ${res.rule.after.map((a) => `\`${a}()\``).join(', ')}._`);
  return out.join('\n\n');
}
