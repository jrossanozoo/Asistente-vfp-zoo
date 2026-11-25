import type { HostApi } from 'asistente-vfp-core';
import type { FactoryRule } from './organic/factoryResolver';

export interface ZooSettings {
  producto: string | null;
  productos: string[];
  sourceRoots: Record<string, string>;
  autoSourceRoots: boolean;
  downstreamRoots: string[];
  indexGenerated: 'none' | 'headers' | 'full';
  factories: FactoryRule[];
  symbolsEnabled: boolean;
  stubsEnabled: boolean;
  vcxEnabled: boolean;
  codeLens: boolean;
  referencesIncludeGenerated: boolean;
  referencesIncludeMocks: boolean;
  referencesIncludeHeuristic: boolean;
  inlayHintsTypes: boolean;
  inlayHintsParameterNames: boolean;
  noteCategories: string[];
  noteRequireCategory: boolean;
  noteRequireOnPublic: boolean;
  noteCheckAscii: boolean;
  d3: boolean;
  d4: boolean;
  d5: boolean;
}

export const DEFAULT_PRODUCTS = ['', 'FELINO', 'ColoryTalle', 'ZL'];
export const DEFAULT_NOTE_CATEGORIES = ['Dependencia', 'Extension', 'Generacion', 'Contrato', 'Gotcha', 'Obsoleto'];

function pick(raw: Record<string, unknown>, key: string): unknown {
  if (key in raw) return raw[key];
  let cur: unknown = raw;
  for (const p of key.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

export function readZooSettings(raw: Record<string, unknown> | undefined): ZooSettings {
  const r = raw ?? {};
  const get = <T>(key: string, def: T): T => {
    const v = pick(r, key);
    return v === undefined ? def : (v as T);
  };
  return {
    producto: get<string | null>('producto', null),
    productos: get('productos', DEFAULT_PRODUCTS),
    sourceRoots: get('sourceRoots', {}),
    autoSourceRoots: get('autoSourceRoots', true),
    downstreamRoots: get('downstreamRoots', []),
    indexGenerated: get('indexGenerated', 'headers'),
    factories: get('factories', []),
    symbolsEnabled: get('symbols.enabled', true),
    stubsEnabled: get('stubs.enabled', true),
    vcxEnabled: get('vcx.enabled', true),
    codeLens: get('codeLens.enabled', true),
    referencesIncludeGenerated: get('references.includeGenerated', false),
    referencesIncludeMocks: get('references.includeMocks', false),
    referencesIncludeHeuristic: get('references.includeHeuristic', true),
    inlayHintsTypes: get('inlayHints.types', true),
    inlayHintsParameterNames: get('inlayHints.parameterNames', false),
    noteCategories: get('note.categories', DEFAULT_NOTE_CATEGORIES),
    noteRequireCategory: get('note.requireCategory', true),
    noteRequireOnPublic: get('note.requireOnPublicMethods', false),
    noteCheckAscii: get('note.checkAscii', true),
    d3: get('diagnostics.unreachableProductClass', true),
    d4: get('diagnostics.factoryLiteral', true),
    d5: get('diagnostics.ofLib', true),
  };
}

export function zooSettings(api: HostApi): ZooSettings {
  return readZooSettings(api.settings()['zoo'] as Record<string, unknown> | undefined);
}
