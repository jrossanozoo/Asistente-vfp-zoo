import type { FactoryRule } from './factoryResolver';

/**
 * Reglas de fábrica del runtime Organic (Core `zoo.prg`, `zoosession.prg`, servicios).
 * `{P}` = producto activo (cProyecto). Si P es vacío, se descartan los candidatos que lo contienen.
 * `{X}` = argumento literal de la llamada.
 * Se pueden ampliar o reemplazar con la configuración `zoo.factories`.
 */
export const DEFAULT_FACTORY_RULES: FactoryRule[] = [
  // zoo.prg:176 / ObtenerNombreEntidadV2:288
  { method: 'InstanciarEntidad', arg: 0, candidates: ['Ent{P}_{X}', 'Ent_{X}', 'Din_Entidad{X}'], productAware: true },
  // zoo.prg:208 / ObtenerNombreComponente:264
  { method: 'InstanciarComponente', arg: 0, candidates: ['{P}_{X}', '{X}', 'Din_{X}'], after: ['Inicializar'], productAware: true },
  // zoo.prg:231-261
  { method: 'CrearObjetoPorProducto', arg: 0, libArg: 1, candidates: ['{P}_{X}', '{X}'], productAware: true },
  // serviciosaplicacion.PRG:415 → CrearObjetoPorProducto
  { method: 'CrearObjetoServicios', arg: 0, candidates: ['{P}_{X}', '{X}'], productAware: true },
  // zoosession.prg:116 — sin producto; con punto es una clase .NET
  { method: 'CrearObjeto', arg: 0, libArg: 1, candidates: ['{X}'], netIfDot: true },
  // zoo.prg:357-452
  { method: 'NuevoObjeto', arg: 2, libArg: 3, candidates: ['{X}'] },
  // zoo.prg:152
  { method: 'ObtenerHerenciaDeNombre', arg: 1, prefixListArg: 0, suffixArg: 2 },
  // aplicacionbase.prg:1752 — IniciarServicio( clase, propApp, global ) → CrearObjetoPorProducto
  { method: 'IniciarServicio', arg: 0, candidates: ['{P}_{X}', '{X}'], productAware: true },
  // VFP nativo
  { method: 'CreateObject', arg: 0, candidates: ['{X}'], netIfDot: true },
  { method: 'NewObject', arg: 0, libArg: 1, candidates: ['{X}'], netIfDot: true },
];

/** Kontrolers, listados, transferencias y REST: no se llaman por un método fijo, pero sirven para el CodeLens y el MCP. */
export const NAMING_RULES: FactoryRule[] = [
  { method: '#Kontroler', arg: 0, candidates: ['Kontroler{P}_{X}', 'Kontroler{X}', 'Din_Kontroler{X}'], productAware: true },
  { method: '#Listado', arg: 0, candidates: ['Lis_{P}Listado{X}', 'Lis_Listado{X}', 'Din_Listado{X}'], productAware: true },
  { method: '#Transferencia', arg: 0, candidates: ['Trans_{P}transferencia{X}', 'Trans_transferencia{X}', 'din_transferencia{X}'], productAware: true },
  { method: '#REST', arg: 0, candidates: ['Ent{P}_{X}_REST', 'Ent_{X}_REST', 'Din_Entidad{X}_REST'], productAware: true },
];
