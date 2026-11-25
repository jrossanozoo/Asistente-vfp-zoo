# Etapa 2: completion sin punto, document links, semantic tokens y folding

Repos: `Asistente-vfp-zoo` y el núcleo `../Asistente-vfp`. Requiere la etapa 1 terminada
(`etapa-1-hover-inlay-highlight-callhierarchy.md`).

## Objetivo
Llevar la ayuda al momento de escribir, no solo después de un `.`; hacer navegables las referencias a
archivos; y colorear el código según lo que cada símbolo es realmente.

## Requerimientos

### E2.1 Completion sin punto
- Hoy la completion solo se dispara en dos casos (`src/zoo/features/completion.ts`):
  - después de `.` (`memberCompletion`);
  - dentro de literales de fábrica (`factoryLiteralCompletion`).
- Agregar completion de identificador al escribir una palabra suelta, con estas fuentes en este orden:
  1. locales y parámetros del método actual (`ctx.member.locals`, `params`), con su tipo si lo tienen;
  2. propiedades y métodos de `this` / `thisform`, incluidos los heredados y los `protected`/`hidden`
     propios (la visibilidad la decide `visible()`), insertando `this.` si corresponde. Esto último es
     opcional;
  3. globales del framework: `goServicios`, las `go*` de la tabla de servicios (`svc.globals`) y
     `_screen`;
  4. clases del índice (útil después de `as `, `createobject("`, `define class … as `). Después de
     `as ` solo deben ofrecerse clases y tipos primitivos;
  5. procedimientos y funciones del índice, y funciones nativas de VFP (el catálogo de
     `src/zoo/data/nativeFunctions.ts`).
- `isIncomplete: true` cuando la lista se corte por tamaño. El índice puede tener decenas de miles de
  clases, así que hay que filtrar por prefijo en el servidor.
- `completionItem/resolve` para cargar la doc (`NOTE`) bajo demanda y no inflar la respuesta inicial.
- No interferir con lo que ya funciona:
  - dentro de strings, solo los literales de fábrica;
  - dentro de comentarios, nada;
  - el disparo por `.` sigue igual.

### E2.2 Document Links (`textDocument/documentLink`)
Volver clicables:
- `#include archivo.h` → el `.h`, relativo al archivo y luego a las carpetas de include del proyecto;
- `OF lib.prg` en `define class`, `local … as … of …`, `NewObject(…, "lib.prg")` → el archivo. Ya lo
  resuelve `index.filesNamed`;
- `SET PROCEDURE TO a, b ADDITIVE` y `SET CLASSLIB TO` → los archivos;
- `DO archivo` / `DO FORM formulario` → el `.prg` / `.scx`, si está indexado.

Reglas:
- Si un nombre resuelve a varios archivos, el link va al primero según la precedencia de capas, y el
  tooltip indica cuántos hay.
- No linkear lo que no exista.

### E2.3 Semantic Tokens (`textDocument/semanticTokens/full`, `/range`, `/full/delta`)
- Tipos de token, usando los estándar de VS Code para que los temas los coloreen sin configuración:
  - `class`: nombres de clase en `define class`, `as X`, literales de fábrica resueltos;
  - `method` y `property`: miembros resueltos sin heurística;
  - `variable` (local/parámetro), `parameter`;
  - `variable` + modificador `defaultLibrary` / `static` para globales `go*` y `_screen`;
  - `function` para procedimientos.
- Modificadores:
  - `declaration` en la definición;
  - `readonly` para constantes `#define`;
  - `deprecated` para miembros con `NOTE` `[Obsoleto]`.
- Solo colorear lo resuelto con certeza: un miembro heurístico no se marca como `method`.
- **Rendimiento:**
  - implementar `/range` (lo visible) y `/full/delta`;
  - reutilizar el caché por versión de documento de la etapa 1 (Document Highlight);
  - medir con los archivos más grandes de Organic.Core.
- Convivencia con la gramática TextMate:
  - los semantic tokens se pintan encima de `syntaxes/foxpro.tmLanguage.json`, que debe seguir
    funcionando sola;
  - el zoo-tool-kit también contribuye el lenguaje `foxpro`; revisar que no haya dos gramáticas
    compitiendo.
- **Configuración:** `zoo.semanticTokens.enabled` (por defecto `true`). VS Code tiene además
  `editor.semanticHighlighting.enabled`.

### E2.4 Folding y Selection Range (`textDocument/foldingRange`, `textDocument/selectionRange`)
- Hoy `language-configuration.json` no define `folding.markers`, así que VS Code pliega por
  indentación. Eso falla con código mal indentado o con continuaciones `;`.
- **Folding** exacto por estructura:
  - bloques: `define class`…`enddefine`, `function`/`procedure`…`endfunc`/`endproc`, `with`,
    `if`/`else`, `do case`/`case`, `for`/`scan`/`do while`, `try`/`catch`/`finally`,
    `text`…`endtext`;
  - bloques `NOTE` con continuaciones, `#if`…`#endif`, y grupos de comentarios `*` consecutivos
    (`kind: comment`);
  - `#region`, si el equipo lo usa como convención (a confirmar).
- **Selection Range:** con Shift+Alt+→, expandir la selección por palabra → expresión → sentencia
  (línea lógica, con continuaciones) → bloque → método → clase.
- Se reutilizan las líneas lógicas y el scanner del núcleo (`text/logicalLines`, `text/scanner`), que
  ya ignoran strings y comentarios, y los rangos de `ParsedFile` (clases, miembros).
- Como respaldo, para cuando el servidor todavía no arrancó: agregar también `folding.markers` en
  `language-configuration.json` (`define class`/`enddefine`, `function`/`endfunc`, `procedure`/`endproc`).

## Criterios de aceptación
- Tests en `test/zoo.test.ts`:
  - E2.1: en un método, `lo` ofrece las locales que empiezan con `lo`; `this.` sigue igual; después de
    `as ` solo clases; `goM` ofrece `goMensajes`;
  - E2.2: links para `#include`, `OF lib.prg` y `SET PROCEDURE TO` en fixtures;
  - E2.3: tokens esperados para una clase de fixture (propiedad tipada → `property`, llamada a
    `Advertir` → `method`, `goMensajes` → `variable` + `defaultLibrary`); `/range` coincide con el
    tramo de `/full`;
  - E2.4: rangos de plegado para clase, métodos, `with`, `if` anidados, `text…endtext` y un `NOTE`
    con continuaciones; un `endif` dentro de un string o comentario no cierra nada; Selection Range
    desde una palabra dentro de un `if` sube por sentencia → `if` → método → clase.
- `npm test` y `npm run typecheck` en verde en los dos repos. Sin regresiones de la etapa 1.
- README: filas nuevas en la tabla de funcionalidades y configuraciones nuevas.

## Validación manual (Organic.Core)
- Escribir `lo` dentro de un método con locales → aparecen las locales; escribir `goM` → `goMensajes`.
- Ctrl+clic en `#include` y en `OF KontrolerFormBaseEmpresa.prg` → abre el archivo.
- Con un tema que distinga propiedades y métodos, `this.oMensajes.Advertir` se colorea por partes.
- Plegar un método, un `do case` y un `NOTE` largo; Shift+Alt+→ repetido desde una variable.

## Riesgos y notas
- **Completion sin punto es lo que más afecta la experiencia de escribir.** Una lista lenta o ruidosa
  molesta más que no tenerla. Medir la latencia y ordenar bien antes de publicar.
- **Semantic tokens recorre todo el documento:** sin caché ni `/range` puede trabar archivos grandes.
- **Si Call Hierarchy pasó de la etapa 1 a esta**, va primero.
