# Asistente VFP Zoo

Extensión de VS Code para **Visual FoxPro Organic**: navegación semántica multi-repo, resolución de fábricas por producto, ayuda al escribir y docstrings **`NOTE` como convención aprobada**.

Implementa la especificación `especificacion-extension-vscode-navegacion-vfp.md` (fases 0 a 6). Reutiliza el núcleo de **Asistente-vfp** (repo hermano `../Asistente-vfp`): parser, `NOTE`, índice y providers base. Este repo agrega todo lo propio de Organic como un plugin.

> No instalar junto con *Asistente VFP* (genérica): esta extensión ya la incluye.

## Qué hace

| Id | Funcionalidad | Detalle |
|---|---|---|
| F1 | **Go to Definition** | Todo lo de la genérica, más los literales de fábrica (`InstanciarEntidad("Cliente")` abre `EntColoryTalle_Cliente`, `Ent_Cliente` y `Din_EntidadCliente` en *peek*, en orden de precedencia), `LoadReference("Clase", "Organic.X.app")` y los miembros de `goServicios.X`, `go*` y `_screen.zoo(.app)`. |
| F1b | **Go to Type Definition** | Sobre una variable, propiedad o cadena `a.b.c` abre la **clase** del tipo deducido (el mismo que usa la completion): `this.oX` asignada desde una fábrica (también en el `Init` de una clase padre), `loX`, `goServicios`, `goServicios.X`, globales `go*` (incluidas `goMensajes`/`goLibrerias`, que salen de su servicio), `_screen.zoo(.app)` y `this`. Si hay varias candidatas por producto, las muestra en *peek* en orden de precedencia. Si el tipo no se deduce, no devuelve nada. F12 sobre una global `go*` sin declaración también va a la clase. |
| F2 | **Go to Implementation** | Subclases y overrides en todas las capas y en los repos consumidores (`zoo.downstreamRoots`). |
| F3 | **Find References** | `AS Clase`, `DEFINE CLASS … AS`, literales de fábrica que resuelven a la clase y llamadas `x.Metodo(` con receptor de la jerarquía. Las referencias heurísticas (receptor desconocido) van al final. `Organic.Generated` queda afuera salvo con `zoo.references.includeGenerated`. |
| F4 | **Hover** | Firma, `NOTE`, jerarquía, procedencia (`Organic.Core.app · símbolos v2.5 · sin fuente local`) y, en los literales de fábrica, la **tabla por producto**. |
| F5 | **Type Hierarchy** | Supertipos y subtipos cross-repo. |
| F6 | **Outline / Ctrl+T** | En todas las capas. |
| F7 | **CodeLens** | Clases: "N subclases · resuelta por `CrearObjetoPorProducto("X")` en: …" (según las llamadas reales del código). Métodos: "N overrides · redefine Padre.Metodo". |
| F8 | **Signature Help** | Con receptor inferido, firmas de otros repos (fuente, `.symbols` o stub), varias firmas si los overrides difieren y un catálogo acotado de funciones nativas de VFP (`STRTRAN`, `SUBSTR`, `PADL`, `ALINES`, …) con textos propios. |
| F9 | **Completion de miembros** | Después de `.` cuando el tipo se conoce; respeta `protected`/`hidden`. Al aceptar un método inserta `Nombre()` y abre la ayuda de parámetros (si ya hay `(`, no duplica). |
| F9b | **Completion de literales de fábrica** | Dentro de `InstanciarEntidad("…")`, etc.: los nombres que la fábrica puede resolver, con la clase efectiva para el producto. |

### Inferencia de tipos (§6.5)

`this`, `thisform`, `dodefault()`, `_screen.zoo` → `Zoo`, `_screen.zoo.app` → `Aplicacion{P}`, `goServicios` → `ServiciosAplicacion{P}`, `goServicios.<Prop>` (tabla extraída de los `<Prop>_Access()` de Core), globales `go*` (extraídos de `IniciarServicio(...)`), `LOCAL x AS Clase`, `#if .f. / local this as …`, `X_Access() as Clase` y asignaciones desde fábricas en el mismo método (`lo = _screen.zoo.InstanciarEntidad("Valor")`) o en la clase (`this.oX = …`). Si no se puede inferir, se busca por nombre y se marca como *resolución heurística*.

Las tablas de servicios se extraen de las fuentes de Core cuando están disponibles. Si no, se usa la tabla embebida `src/zoo/organic/servicesTable.embedded.json`, que se regenera con `npm run services-table`.

### Capas (§4)

| Capa | Fuente | Cuándo se usa |
|---|---|---|
| T1 | Workspace | Siempre. |
| T2 | Fuentes hermanas (`zoo.sourceRoots`, o `../Organic.X` con `zoo.autoSourceRoots`) | Si el repo está clonado. Se indexan `Organic.BusinessLogic`, `Organic.Generated` y `Organic.Hooks`. |
| T3 | `.symbols` del `.app` (`packages\App\` o la ruta local del `AppReference`) | Si no hay fuente. Lee v2.5 y usa línea y doc de v2.6 cuando existan. |
| T4 | Stubs de dovfp (`obj\*\_dovfp_stubs\Organic.X\`) | Si no hay fuente: dan la ubicación navegable de los símbolos de T3. Soportan `* @source ruta:línea` (propuesta 6.6). |
| VCX | `.vcx` del workspace y de las fuentes | Se abren como vista de solo lectura (`foxpro-vcx:`) con propiedades, objetos y métodos. |

Los duplicados se resuelven por capa (T1 > T2 > T3 > T4) y, dentro de cada capa, por repo: Core > Drawing > Generator > AdnImplant > Feline > vertical. PRG gana sobre VCX.

`Organic.Generated` se indexa por encabezados (`zoo.indexGenerated: "headers"`). Con `"none"` no se abre ningún generado hasta que hace falta: `Din_X` se busca por el nombre del archivo.

### Producto activo

`zoo.producto`, o el `cProyecto = "X"` de la clase `Aplicacion*` del workspace (Dragonfish → `ColoryTalle`, Feline → `FELINO`, ZL → `ZL`, Core/Drawing → `""`). Comando **Zoo VFP: Elegir producto**.

## `NOTE` como convención aprobada

La extensión trata el bloque `NOTE` de `developer.md` como regla:

| Código | Severidad | Regla | Quick fix |
|---|---|---|---|
| D1 | warning | `NOTE` huérfano (no lo sigue una declaración). | — |
| D2 | error | La última línea del comentario termina en `;` y se come la declaración siguiente. | Quitar el `;` final. |
| N1 | warning | El `NOTE` no empieza con una `[Categoría]` válida (`zoo.note.categories`). | Usar categoría `[…]` (una opción por categoría). |
| N2 | warning | `Parametros:` no coincide con la firma (falta o sobra un parámetro). | Agregar los parámetros faltantes. |
| N3 | info | `Retorna:` en un método `as Void`, o falta en un método que devuelve algo. | — |
| N4 | warning | `NOTE` dentro del cuerpo de una función (ahí se usa `&&` o `*!*`). | — |
| N5 | info | Caracteres fuera de ASCII en el `NOTE`. | — |
| N6 | info | *(apagado por defecto)* Método público de una clase base sin `NOTE`. | Generar `NOTE` desde la firma. |
| — | — | Sobre cualquier `function`/`procedure` sin `NOTE`. | **Generar NOTE desde la firma** (refactor). |

`[Obsoleto]` se muestra tachado en el hover y en la completion.

Diagnósticos del framework:

| Código | Severidad | Regla |
|---|---|---|
| D3 | info | Clase de producto (`{P}_X`) que ninguna fábrica por producto alcanza, mientras sí hay `CrearObjeto("X")`. Lista las llamadas como información relacionada (por ejemplo `colorytalle_colaboradorCheques`). |
| D4 | warning | Literal de fábrica sin ninguna clase candidata en el índice. |
| D5 | warning | `OF lib.prg` que no coincide con el archivo real de la clase padre. |

## Configuración

| Clave | Por defecto | Para qué |
|---|---|---|
| `zoo.producto` | `null` (detectar) | Producto activo. |
| `zoo.productos` | `["", "FELINO", "ColoryTalle", "ZL"]` | Productos de la tabla del hover. |
| `zoo.sourceRoots` | `{}` | `{ "Organic.Core": "../Organic.Core" }`. |
| `zoo.autoSourceRoots` | `true` | Buscar `../Organic.X` si no está configurado. |
| `zoo.downstreamRoots` | `[]` | Repos consumidores (implementaciones, referencias, tabla por producto). |
| `zoo.indexGenerated` | `"headers"` | `none` / `headers` / `full`. |
| `zoo.factories` | `[]` | Reglas de fábrica extra (mismo formato que `src/zoo/organic/factoryRules.ts`). |
| `zoo.symbols.enabled` / `zoo.stubs.enabled` / `zoo.vcx.enabled` | `true` | Capas T3, T4 y VCX. |
| `zoo.codeLens.enabled` | `true` | CodeLens. |
| `zoo.references.includeGenerated` / `includeHeuristic` | `false` / `true` | Alcance de *Find References*. `includeGenerated` también aplica a los resultados heurísticos de F12. |
| `zoo.references.includeMocks` | `false` | Incluir `Organic.Mocks` en *Find References* y en los resultados heurísticos de F12 (receptor de tipo desconocido). |
| `zoo.note.categories` | Dependencia, Extension, Generacion, Contrato, Gotcha, Obsoleto | Categorías válidas. |
| `zoo.note.requireCategory` / `requireOnPublicMethods` / `checkAscii` | `true` / `false` / `true` | N1, N6, N5. |
| `zoo.diagnostics.unreachableProductClass` / `factoryLiteral` / `ofLib` | `true` | D3, D4, D5. |
| `zoo.exclude`, `zoo.index.maxFileSizeKB`, `zoo.docstring.fallbackComments`, `zoo.features.documentSymbols` | | Igual que en la genérica. |

Ejemplo para Drawing, viendo los overrides de los productos:

```jsonc
{
  "zoo.downstreamRoots": ["../Organic.Feline", "../Organic.Dragonfish", "../Organic.ZL"]
}
```

Comandos: **Reindexar workspace**, **Elegir producto**, **Mostrar estado del índice** (solución, capas y raíces detectadas) y **Copiar configuración del servidor MCP**.

## Servidor MCP (agentes IA)

`dist/mcp.js` es un servidor MCP por stdio que arma el mismo índice sin VS Code:

```bash
node dist/mcp.js --root c:\LinceV3\Organic.Dragonfish [--producto ColoryTalle] \
     [--downstream ../Organic.ZL] [--source-root Organic.Core=../Organic.Core] [--generated headers]
```

```bash
claude mcp add organic -- node <ruta>\dist\mcp.js --root c:\LinceV3\Organic.Dragonfish
```

| Herramienta | Qué devuelve |
|---|---|
| `organic_resolve_factory(metodo, literal, producto?)` | Clase efectiva, precedencia, candidatas existentes y resolución por producto. |
| `organic_class_hierarchy(clase)` | Ancestros y subclases con archivo y repo. |
| `organic_find_overrides(clase, metodo)` | Dónde se define y todos los overrides. |
| `organic_get_doc(simbolo)` | Firma y `NOTE` (o doc heredada) de `Clase`, `Clase.Miembro` o un procedimiento. |
| `organic_find_class(patron)` | Clases por parte del nombre. |

Indexar Dragonfish con sus cinco repos hermanos (~17.000 archivos) tarda ~55 s la primera vez. Las siguientes usan la cache de `%TEMP%\asistente-vfp-zoo`.

## Desarrollo

Requiere el repo hermano `../Asistente-vfp` (el núcleo se importa como `asistente-vfp-core` por alias de TypeScript/esbuild/vitest y queda empaquetado dentro del `.vsix`).

```bash
cd ../Asistente-vfp && npm install
cd ../Asistente-vfp-zoo && npm install
npm run build        # dist/client.js, dist/server.js, dist/mcp.js
npm test             # vitest (fixtures multi-repo en test/fixtures/organic)
npm run typecheck
npm run package      # .vsix
npm run services-table -- c:\LinceV3\Organic.Core   # regenera la tabla embebida
```

### Estructura

```
src/client/extension.ts         cliente VS Code (comandos, vista foxpro-vcx:, CodeLens)
src/server/server.ts            núcleo + plugin zoo
src/mcp/server.ts               servidor MCP
src/zoo/zooPlugin.ts            ensambla el plugin (capas, handlers, diagnósticos, hover)
src/zoo/headless.ts             índice sin VS Code (MCP y tests)
src/zoo/state.ts                producto, fábricas, índice de llamadas, generados por nombre
src/zoo/workspace/solution.ts   .vfpproj, AppReference, sourceRoots, .symbols, stubs, capas
src/zoo/layers/symbolsReader.ts lector de .symbols v2.5/v2.6
src/zoo/vcx/                    lector DBF/FPT y vista PRG de clases VCX
src/zoo/organic/                reglas de fábrica, FactoryResolver, tabla de servicios
src/zoo/inference/              inferencia de tipos y literales de fábrica
src/zoo/features/               references, codeLens, completion
src/zoo/diagnostics/            D3–D5, reglas de NOTE y quick fixes
src/zoo/data/nativeFunctions.ts catálogo acotado de funciones nativas
```

## Fuera de alcance

- Los cambios en dovfp (§6.6: `.symbols` v2.6 y stubs con `NOTE`). La extensión ya los lee cuando existan.
- Macros (`&`), `EVALUATE` y nombres de clase calculados: se marcan como dinámicos o heurísticos.
- Rename y completion general de identificadores (§6.10).
