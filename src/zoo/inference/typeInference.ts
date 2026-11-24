import { chainBefore, findClosingParen, scanCode, splitTopLevel } from 'asistente-vfp-core';
import type { CursorContext, HostApi, ResolvedTarget, StringCallContext, StringResolver, TypeResolver, TypeResult } from 'asistente-vfp-core';
import { FactoryRule, resolutionMarkdown } from '../organic/factoryResolver';
import type { ZooState } from '../state';

function strip(seg: string): string {
  return seg.replace(/(\(\)|\[\])$/, '').toLowerCase();
}

const CALL_RE = /([A-Za-z_]\w*)\s*\(/g;

/**
 * Inferencia de tipos del framework Organic (§6.5):
 * `_screen.zoo`, `_screen.zoo.app`, `goServicios(.X)`, globales `go*`,
 * variables y propiedades asignadas desde fábricas.
 */
export class ZooTypeResolver implements TypeResolver {
  private depth = 0;

  constructor(private readonly state: ZooState) {}

  private existing(names: string[], note?: string): TypeResult | undefined {
    const index = this.state.api.index;
    const found = names.filter((n) => index.hasClass(n)).map((n) => index.getClass(n)!.decl.name);
    return found.length ? { classNames: found, note } : undefined;
  }

  private withProduct(templates: string[], note?: string): TypeResult | undefined {
    const p = this.state.product();
    const names = templates.filter((t) => !(t.includes('{P}') && p === '')).map((t) => t.split('{P}').join(p));
    return this.existing(names, note);
  }

  private fromRule(rule: FactoryRule | undefined, x: string, templates?: string[], label?: string): TypeResult | undefined {
    if (templates) return this.withProduct(templates.map((t) => t.split('{X}').join(x)), label);
    if (!rule) return this.existing([x], label);
    const lits: (string | undefined)[] = [];
    lits[rule.arg ?? 0] = x;
    const res = this.state.resolveFactory(rule, lits);
    if (!res.found.length) return undefined;
    return { classNames: res.found.map((f) => f.name), note: label ? `${label} → ${res.found[0].name}` : undefined };
  }

  /** Tipo del lado derecho de una asignación. */
  rhsType(rhs: string, ctx: CursorContext, api: HostApi): TypeResult | undefined {
    if (this.depth > 4) return undefined;
    const { masked, strings } = scanCode(rhs);
    CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL_RE.exec(masked))) {
      const rule = this.state.factories.ruleFor(m[1]);
      if (!rule || rule.method.startsWith('#')) continue;
      const open = m.index + m[0].length - 1;
      const close = findClosingParen(masked, open);
      const parts = splitTopLevel(masked, open + 1, close < 0 ? masked.length : close);
      const literals = parts.map((part) => {
        const raw = masked.substring(part.start, part.end);
        const s = part.start + (raw.length - raw.trimStart().length);
        const e = part.start + raw.trimEnd().length;
        return strings.find((st) => st.start === s && st.end === e)?.value;
      });
      const res = this.state.resolveFactory(rule, literals);
      if (res.found.length) {
        return { classNames: res.found.map((f) => f.name), note: `${m[1]}("${res.x}") → ${res.found[0].name}` };
      }
      return undefined;
    }
    // Encadenamiento: `this.ObtenerColaborador()`, `loX.oY`
    const simple = /^\s*([\w.]+(?:\(\s*\))?)\s*$/.exec(masked.replace(/\([^()]*\)/g, '()'));
    if (simple) {
      const expr = simple[1];
      const chain = chainBefore(expr + '.', expr.length);
      if (chain && chain.length) {
        this.depth++;
        try {
          return api.resolver.resolveChainType(chain, ctx);
        } finally {
          this.depth--;
        }
      }
    }
    return undefined;
  }

  /**
   * Última asignación `name = …` antes del cursor dentro del método actual.
   * Incluye la línea del cursor si está parado en el lado izquierdo (`loX| = CrearObjeto(…)`).
   */
  private assignedVar(name: string, ctx: CursorContext, api: HostApi): TypeResult | undefined {
    if (!ctx.member) return undefined;
    const re = new RegExp(`^\\s*(?:m\\.)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=(?!=)(.*)$`, 'i');
    const start = ctx.member.range.start.line;
    for (let line = Math.min(ctx.position.line, ctx.lines.length - 1); line > start; line--) {
      const s = ctx.scanned[line];
      if (s.isComment || s.isText) continue;
      const m = re.exec(s.code);
      if (!m) continue;
      if (line === ctx.position.line && ctx.position.character > m[0].length - m[1].length - 1) continue;
      return this.rhsType(m[1], ctx, api);
    }
    return undefined;
  }

  /** `this.oX = …` en cualquier método de la clase actual. */
  private assignedProperty(prop: string, ctx: CursorContext, api: HostApi): TypeResult | undefined {
    if (!ctx.cls || ctx.cls.decl.uri !== ctx.uri) return undefined;
    const re = new RegExp(`^\\s*this\\.${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=(?!=)(.*)$`, 'i');
    const { start, end } = ctx.cls.decl.range;
    for (let line = start.line; line <= end.line && line < ctx.lines.length; line++) {
      const s = ctx.scanned[line];
      if (s.isComment || s.isText) continue;
      const m = re.exec(s.code);
      if (m) {
        const t = this.rhsType(m[1], ctx, api);
        if (t) return t;
      }
    }
    return undefined;
  }

  resolveChain(chain: string[], ctx: CursorContext, api: HostApi): TypeResult | undefined {
    const c = chain.map(strip);
    const svc = this.state.services;
    if (c[0] === '_screen' && c[1] === 'zoo') {
      if (c.length === 2) return this.existing(['Zoo']);
      if (c[2] === 'app') {
        const p = this.state.product();
        const app = this.existing(p ? [`Aplicacion${p}`, 'AplicacionBase'] : ['AplicacionBase'], `_screen.zoo.app → Aplicacion${p || 'Base'}`);
        if (c.length === 3) return app;
        if (c.length === 4) {
          if (c[3] === 'oservicios') return this.resolveChain(['goServicios'], ctx, api);
          const g = svc.globals.find((e) => e.appProp.toLowerCase() === c[3]);
          if (g) return this.fromRule(this.state.factories.ruleFor('CrearObjetoPorProducto'), g.x, g.candidates, `_screen.zoo.app.${g.appProp}`);
        }
      }
      return undefined;
    }
    if (c[0] === 'goservicios') {
      if (c.length === 1) return this.withProduct(['ServiciosAplicacion{P}', 'ServiciosAplicacion'], 'goServicios → ServiciosAplicacion');
      if (c.length === 2) {
        const s = svc.services.find((e) => e.prop.toLowerCase() === c[1]);
        if (s) return this.fromRule(this.state.factories.ruleFor(s.method), s.x, s.candidates, `goServicios.${s.prop}`);
      }
      return undefined;
    }
    if (c.length === 1) {
      const g = svc.globals.find((e) => e.global.toLowerCase() === c[0]);
      if (g) return this.fromRule(this.state.factories.ruleFor('CrearObjetoPorProducto'), g.x, g.candidates, g.global);
      if (c[0] === 'this' || c[0] === 'thisform') return undefined;
      return this.assignedVar(chain[0].replace(/(\(\)|\[\])$/, ''), ctx, api);
    }
    if (c.length === 2 && c[0] === 'this') {
      return this.assignedProperty(chain[1].replace(/(\(\)|\[\])$/, ''), ctx, api);
    }
    return undefined;
  }
}

/** String literal dentro de una llamada a fábrica: resolución por producto (F1/F4). */
export class ZooStringResolver implements StringResolver {
  constructor(private readonly state: ZooState) {}

  resolveString(call: StringCallContext, _ctx: CursorContext, api: HostApi): ResolvedTarget | undefined {
    const index = api.index;
    const callee = call.callee.toLowerCase();
    const base: ResolvedTarget = { kind: 'none', word: call.literal, range: call.range };
    if (callee === 'loadreference') {
      if (call.argIndex === 0) return { ...base, kind: 'class', classes: index.classEntries(call.literal).slice(0, 1) };
      return base;
    }
    const rule = this.state.factories.ruleFor(call.callee);
    if (!rule) return undefined;
    if (rule.libArg !== undefined && call.argIndex === rule.libArg) {
      return { ...base, kind: 'file', files: index.filesNamed(call.literal), multi: true };
    }
    const nameArgs = [rule.arg ?? 0, rule.prefixListArg, rule.suffixArg].filter((a) => a !== undefined);
    if (!nameArgs.includes(call.argIndex)) return undefined;
    const res = this.state.resolveFactory(rule, call.literals);
    const md = resolutionMarkdown(res, call.callee);
    if (res.net || !res.found.length) return { ...base, hoverExtra: [md], kind: 'class', classes: [] };
    return {
      ...base,
      kind: 'class',
      classes: res.found.map((f) => f.entries[0]),
      multi: true,
      hoverExtra: [md],
    };
  }
}
