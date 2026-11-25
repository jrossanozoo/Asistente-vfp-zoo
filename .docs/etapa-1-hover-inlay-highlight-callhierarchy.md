# Etapa 1: hover uniforme, inlay hints, document highlight y call hierarchy

Repos: `Asistente-vfp-zoo` y el núcleo `../Asistente-vfp`. Base: versión 0.1.3.

## Objetivo
Cualquier objeto, sea **propiedad o variable**, tiene que comportarse igual:
- completion con los miembros públicos;
- ayuda (`NOTE`), parámetros y tipo de retorno;
- F12 a la definición de la clase.

Además, el tipo deducido debe verse sin pasar el mouse por encima. Esta etapa completa lo que falta
para eso y agrega tres funciones estándar de VS Code.

## Estado de partida (0.1.3)
| Comportamiento | Variable `loX` | Propiedad `this.oX` |
|---|---|---|
| Completion después de `.` | ✅ | ✅ |
| Signature help | ✅ | ✅ |
| F12 a la clase / Type Definition / Declaration | ✅ | ✅ |
| Hover | clase + doc + lista de miembros | **solo la declaración + "Tipo deducido"** |

Todo sale de la misma inferencia:
- `Resolver.resolveChainType` en `Asistente-vfp/src/core/features/resolve.ts`;
- `ZooTypeResolver` en `src/zoo/inference/typeInference.ts`.

## Requerimientos

### E1.1 Hover de propiedad igual al de variable
- Hoy, en `hoverMarkdown` (`Asistente-vfp/src/core/features/hover.ts`):
  - el caso `variable` arma `classHover` + `membersSummary`;
  - el caso `member` con `target.classes` (propiedad con tipo deducido) solo agrega una línea
    `**Tipo deducido:**`.
- Reutilizar el mismo armado del caso `variable` para una propiedad con tipo:
  - firma de la propiedad (`ZzA.oMensajes = null`);
  - `→ Mensajes` (o las candidatas por producto);
  - doc de la clase;
  - métodos y propiedades públicos con su resumen;
  - nota de cómo se dedujo (`receiverType.note`, p. ej. `CrearObjeto("Mensajes") → Mensajes`).
- Aplicarlo también a `goServicios.Mensajes`, `_screen.zoo.app` y otras propiedades de cadenas tipadas.
- Para que el resultado sea idéntico, extraer una función común (`typedObjectHover`) que usen los dos
  casos.

### E1.2 Inlay hints (`textDocument/inlayHint`)
- **Tipo deducido**, al final del lado izquierdo de una asignación cuyo tipo se deduce:
  - `this.oMensajes = _Screen.zoo.CrearObjeto("Mensajes")` → `this.oMensajes‹: Mensajes›`;
  - `loEnt = _screen.zoo.InstanciarEntidad("Cliente")` → `loEnt‹: EntColoryTalle_Cliente›`, que es la
    clase ganadora para el producto activo.
- **Nombre de parámetro**, opcional: `goMensajes.Advertir(‹tvMensaje:› "x", ‹tnBotones:› 4)`.
  - Usa las firmas que ya resuelve `signatureHelp`.
  - Solo para argumentos literales o expresiones cortas. Nunca cuando el argumento ya se llama como el
    parámetro.
- Se calcula **solo para el rango visible** (el `range` del request), y no se muestra si el tipo es
  heurístico.
- El tooltip del hint lleva la nota de deducción. Al hacer clic se va a la clase (`InlayHintLabelPart.location`).
- **Configuración nueva:**
  - `zoo.inlayHints.types` (por defecto `true`);
  - `zoo.inlayHints.parameterNames` (por defecto `false`).
  - VS Code además tiene su propio interruptor global (`editor.inlayHints.enabled`).
- Lugar sugerido: el núcleo resuelve el tipo de cada asignación, reutilizando `typeAt` (que lleva un
  contexto armado en la posición del lado izquierdo). El plugin solo aporta la configuración.

### E1.3 Document Highlight (`textDocument/documentHighlight`)
- Con el cursor sobre un símbolo, resaltar sus usos **en el archivo actual**:
  - escritura (`Write`): asignaciones `x =` y `this.x =`;
  - lectura (`Read`): el resto.
- **Misma semántica que Find References**, limitada al documento. Para `Advertir` sobre un receptor
  `Mensajes`, se resaltan solo las llamadas cuyo receptor es de la jerarquía de `Mensajes`, no
  cualquier `Advertir`.
- Reutilizar la lógica por archivo de `findReferences` (`src/zoo/features/references.ts`):
  1. buscar candidatos con regex de palabra;
  2. resolver cada uno con `resolveAt`;
  3. comparar contra el target.
- Extraerla a una función que reciba un solo archivo, para que la usen Find References y Document
  Highlight.
- Locales y parámetros se comparan por declaración dentro del método (sin resolver tipos).
- Debe responder rápido en archivos grandes de Organic (miles de líneas), porque VS Code la pide en
  cada movimiento del cursor:
  - cachear el texto escaneado por versión del documento;
  - cortar si el target es heurístico, para no resaltar por nombre.

### E1.4 Call Hierarchy (`textDocument/prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)
- `prepare`: método, procedimiento o función bajo el cursor. Reutilizar `resolveAt`.
- **Incoming** (quién llama a este método):
  - se apoya en Find References (solo resultados exactos) agrupados por método contenedor;
  - el contenedor se obtiene con `buildCursorContext(...).member`;
  - incluye las llamadas desde subclases y los `dodefault()` de los overrides.
- **Outgoing** (a quién llama este método):
  - **requiere un cambio en el parser del núcleo.** Hoy `ParsedFile.calls` solo registra las llamadas
    cuyos nombres están en `callNames` (`DEFAULT_CALL_NAMES = ['createobject', 'newobject']` más las
    fábricas del plugin);
  - opción A (recomendada): al pedir `outgoingCalls`, escanear el cuerpo del método en el momento,
    usando `findEnclosingCall` / `chainBefore` y `resolveCall` sobre cada `nombre(`. No toca el índice;
  - opción B: registrar todas las llamadas en el parser. Es más rápido para incoming, pero agranda el
    índice y el caché de parseo, así que hay que medir con Organic.Core completo antes de elegirla.
- Para que incoming no recorra todo el workspace en cada expansión, cachear por versión del índice.
- Llamadas con receptor desconocido:
  - se excluyen por defecto;
  - con `zoo.references.includeHeuristic`, se incluyen marcadas.
  - Respetan `includeGenerated` / `includeMocks`.

## Criterios de aceptación
- **Tests en `test/zoo.test.ts`, con fixtures en `test/fixtures/organic/`:**
  - E1.1: el hover de `this.oMensajes` y el de `loMensajes` (asignada igual) tienen el mismo bloque de
    clase y la misma lista de miembros;
  - E1.2: hints de tipo para `this.oX =`, `loX =` (fábrica con producto: gana `ColorYTalle_X`) y
    `.oX =` en `with this`; sin hint cuando el tipo no se deduce; hints de parámetro solo con la
    configuración activa;
  - E1.3: en `UsoMensajes.prg` se resaltan `this.oMensajes` (con su `Write` en el `Init`) y
    `Advertir` solo sobre receptores `Mensajes`;
  - E1.4: incoming de `Mensajes.Advertir` lista los métodos de las fixtures que lo llaman; outgoing de
    `UsoMensajes.Probar` lista `Mensajes.Advertir`.
- **Tests genéricos en `Asistente-vfp/test/features.test.ts`** para lo que quede en el núcleo.
- `npm test` y `npm run typecheck` en verde en los dos repos.
- **Sin regresiones de 0.1.3:** F12 a la clase, Declaration, Type Definition, mocks excluidos.
- **README:**
  - filas nuevas en la tabla de funcionalidades: hover uniforme (actualizar F4), Inlay Hints,
    Document Highlight, Call Hierarchy;
  - las configuraciones nuevas en la tabla de configuración.

## Validación manual (Organic.Core)
Con `C:\LinceV3\Organic.Core` abierto, en una clase:
```foxpro
oMensajes = null
function Init
	this.oMensajes = _Screen.zoo.CrearObjeto("Mensajes")
	local loMensajes
	loMensajes = _Screen.zoo.CrearObjeto("Mensajes")
endfunc
function Probar
	this.oMensajes.Advertir("x")
	loMensajes.Advertir("x")
endfunc
```
- Hover sobre `oMensajes` y sobre `loMensajes` → mismo contenido de clase y miembros.
- Se ven `‹: Mensajes›` en las dos asignaciones.
- Cursor sobre `oMensajes` → se resaltan sus 3 usos.
- Shift+Alt+H sobre `Advertir` → llamadas entrantes reales.

## Riesgos y notas
- **Call Hierarchy es lo más pesado de la etapa.** Conviene dejarlo último: si se complica, puede pasar
  a la etapa 2 sin bloquear lo demás.
- **Inlay hints puede resultar ruidoso:** por eso los nombres de parámetro arrancan apagados.
- **Otras extensiones FoxPro** que respondan los mismos requests duplican resultados (pasó con
  `zoologic.vfp-intellisense`). El README debería recomendar no tenerlas activas a la vez.
- **El servidor MCP (`dist/mcp.js`) no necesita cambios.**
