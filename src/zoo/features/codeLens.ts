import { CodeLens, Location } from 'vscode-languageserver-types';
import type { HostApi, ParsedFile } from 'asistente-vfp-core';
import { productLabel } from '../organic/factoryResolver';
import type { ZooState } from '../state';

export const SHOW_LOCATIONS_COMMAND = 'asistenteVfpZoo.showLocations';

/** F7: "N subclases · resuelta por CrearObjetoPorProducto en: …" y "N overrides". */
export function codeLenses(parsed: ParsedFile, state: ZooState, api: HostApi): CodeLens[] {
  const lenses: CodeLens[] = [];
  const index = api.index;
  for (const cls of parsed.classes) {
    const subs = index.descendants(cls.name);
    const parts: string[] = [];
    if (subs.length) parts.push(`${subs.length} ${subs.length === 1 ? 'subclase' : 'subclases'}`);
    const usage = state.factoryUsage(cls.name);
    if (usage) parts.push(`resuelta por ${usage.rule.method}("${usage.x}") en: ${usage.products.map(productLabel).join(', ')}`);
    if (parts.length) {
      lenses.push({
        range: cls.nameRange,
        command: {
          title: parts.join(' · '),
          command: subs.length ? SHOW_LOCATIONS_COMMAND : '',
          arguments: subs.length
            ? [cls.uri, cls.nameRange.start, subs.map((s) => Location.create(s.decl.uri, s.decl.nameRange))]
            : undefined,
        },
      });
    }
    for (const m of cls.members) {
      if (m.kind !== 'method') continue;
      const overrides = index.overrides(cls.name, m.name);
      const parent = index.getClass(cls.name, { fromUri: parsed.uri });
      const base = parent ? index.findInAncestors(parent, m.name) : undefined;
      const titles: string[] = [];
      if (overrides.length) titles.push(`${overrides.length} ${overrides.length === 1 ? 'override' : 'overrides'}`);
      if (base?.owner) titles.push(`redefine ${base.owner.decl.name}.${m.name}`);
      if (!titles.length) continue;
      const locs = [
        ...overrides.map((o) => Location.create(o.decl.uri, o.decl.nameRange)),
        ...(base ? [Location.create(base.decl.uri, base.decl.nameRange)] : []),
      ];
      lenses.push({
        range: m.nameRange,
        command: { title: titles.join(' · '), command: SHOW_LOCATIONS_COMMAND, arguments: [m.uri, m.nameRange.start, locs] },
      });
    }
  }
  return lenses;
}
