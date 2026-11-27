# Hallazgos de las pruebas

Estado: **H1–H6 implementados en la versión 0.2.2 (2026-11-27), pendientes de la prueba del equipo.** Acá se
anotan los problemas y mejoras que aparecen al probar la extensión en proyectos reales. Cada caso tiene su
estado al principio. Lo que se posterga para la versión siguiente está en
[temas-version-siguiente.md](temas-version-siguiente.md).

Formato de cada caso: contexto, qué pasó, qué se esperaba y reglas a respetar.

---

## H1. Go to Definition (F12) resuelve una clase de test en vez de la clase de la aplicación

> **Estado 0.2.2: implementado.** Causa: `Mensajes` está en Core (fuente de la solución, prioridad 10+) y la
> clase de test en un proyecto del workspace (prioridad 0), así que ganaba la de test.
> - Un archivo es de test si está en un proyecto con `<OutputType>Test</OutputType>`, si se llama `test*.prg` /
>   `ztest*.prg`, o si es un mock de `Organic.Mocks`. Los stubs de dovfp no son de test.
> - Desde un archivo que no es de test, las clases de test se descartan, así que una clase que solo está en tests no
>   se resuelve. Desde un test, las clases de la aplicación van primero, salvo la del mismo archivo.
> - Después viene la regla del archivo homónimo y recién ahí la prioridad de capa.
> - Las dos reglas están en un solo lugar del core (`SymbolIndex.classEntries`), así que aplican a todo lo que
>   resuelve una clase por nombre: F12, hover, completion, inferencia, inlay hints y jerarquía.
> - Sin archivo de origen (Ctrl+T, MCP), las clases de test siguen visibles, al final de la lista.

- **Proyecto:** ColorYTalle.
- **Contexto:** en una clase de negocio se define una propiedad que crea un objeto de la clase
  `Mensajes`.
- **Qué pasó:** F12 sobre la clase abrió una clase `Mensajes` definida dentro de un test.
- **Qué se esperaba:** abrir la clase `Mensajes` definida en `mensajes.prg`.

### Reglas a respetar

1. **Prioridad por archivo homónimo:** si existe una clase cuyo nombre coincide con el del archivo que
   la contiene (`DEFINE CLASS Mensajes` en `mensajes.prg`), esa definición tiene prioridad sobre otras
   clases con el mismo nombre declaradas en otros archivos.
2. **La aplicación nunca depende de los tests:** desde código de negocio o de la aplicación, la
   resolución de símbolos **no puede** devolver clases definidas en tests. La dependencia es en un solo
   sentido:
   - un test **puede** referenciar clases de la aplicación;
   - la aplicación **no puede** referenciar clases de un test (debe poder correr sin ellos).

### A definir en la etapa
- Cómo se identifica un archivo de test (carpeta, prefijo/sufijo del nombre, proyecto de tests).
- Si la regla 2 aplica solo a F12 o también a hover, completion, find references, inferencia de tipos e
  inlay hints (probablemente a todo lo que resuelve una clase por nombre).
- Qué hacer cuando, desde la aplicación, la única definición encontrada está en un test: no resolver, o
  resolver con una advertencia.

---

## H2. Inlay hints fallan con "Maximum call stack size exceeded"

> **Estado 0.2.2: corregido.** La causa confirmada es una recursión sin corte en la inferencia de asignaciones,
> por ejemplo `loX = loX.Metodo()`, `loA = loB` / `loB = loA` o `this.oA = this.oB` / `this.oB = this.oA`. El
> límite de profundidad del plugin zoo no funcionaba porque se creaba un resolvedor nuevo en cada llamada.
> - El core corta una cadena que ya se está resolviendo en el mismo punto y limita la anidación a 16 niveles.
> - Zoo usa una sola instancia del resolvedor.
> - El lado derecho de `loX = …` se evalúa con las asignaciones anteriores a esa línea.
>
> Afecta a hover, F12, completion e inlay hints, porque comparten el mismo camino. Hay un test con los cuatro ciclos.

- **Proyecto:** ColorYTalle (producto activo "ColoryTalle", tabla de servicios core: 30 servicios,
  11 globales; 29129 `.prg` indexados en 22.1 s, 23555 clases).
- **Qué pasó:** en el uso todo parece funcionar bien, pero la salida del servidor muestra errores
  repetidos (6 en unos 20 s) en `textDocument/inlayHint`:

  ```
  [Error - 6:19:39 AM] Request textDocument/inlayHint failed.
    Message: Request textDocument/inlayHint failed with message: Maximum call stack size exceeded
    Code: -32603
  ```
- **Qué se esperaba:** que los inlay hints se calculen sin errores. Si un caso no se puede resolver, que
  no se muestre el hint, sin una excepción en el log.

### Posible causa (sin confirmar)
Recursión sin corte en la resolución de tipos que usan los inlay hints. Candidatos:
- herencia cíclica o autorreferente (`DEFINE CLASS A AS A`, o A → B → A entre archivos);
- variables o propiedades cuyo tipo depende de sí mismas (`loX = loX.Metodo()`);
- cadenas de `AS`/`NEWOBJECT`/servicios que vuelven a un tipo ya visitado.

### A definir en la etapa
- Identificar el archivo y la línea que disparan el error (falta registrar en qué archivo se estaba
  trabajando cuando apareció).
- Agregar protección contra ciclos (conjunto de visitados o límite de profundidad) en toda resolución
  recursiva de tipos, no solo en los inlay hints: hover, F12 y completion probablemente usan el mismo
  camino.
- Ante un ciclo, cortar en silencio (o registrar en nivel debug, una sola vez por símbolo), sin que la
  request falle.

---

## H3. Indentación rota y plantillas Organic según el contexto (`define class`, `function`)

> **Estado 0.2.2: implementado en el plugin zoo.**
> - `language-configuration.json` ya es JSON válido. Usa `{ pattern, flags: "i" }` y el `text\b` estricto, y una
>   asignación como `text = …` no indenta.
> - Las plantillas son un proveedor más en `src/zoo/features/completion.ts`. Se consultan después de los literales
>   de fábrica y los miembros, y se recalculan al escribir.
> - `funcnote` salió de `snippets/foxpro.json`, y la plantilla toma las categorías de `zoo.note.categories`.
> - Los 8 casos de aceptación, más `#if .f.`, tienen test.
> - No se resolvió no reindentar dentro de `TEXT … ENDTEXT`: `indentationRules` no lo permite. Queda junto a
>   `onEnterRules` y la coordinación con zoo-tool-kit (punto 3).

- **Origen:** análisis de autocompletado hecho en el repo Asistente-vfp:
  `c:\LinceV3\code.extensions\Asistente-vfp\docs\autocompletado\spec-asistente-vfp-zoo.md` (con su
  diagnóstico en `diagnostico-autocompletado.md` y el spec equivalente para zoo-tool-kit en
  `spec-zoo-tool-kit.md`, en la misma carpeta).
- **Qué pasó:** al escribir `class`, `define`, `function` o `procedure` aparecen plantillas en
  mayúsculas y sin la indentación del contexto, y los snippets de zoo-tool-kit compiten con los
  nuestros. Además, las reglas de indentación de la extensión no se aplican.
- **Qué se esperaba:** plantillas Organic en minúsculas, con la indentación correcta según si el cursor
  está dentro o fuera de un `define class`, y apareciendo antes que las de otras extensiones.

### Estado verificado en este repo (2026-11-26)
- `package.json` está en `0.2.1`, igual que la versión instalada: el punto P2-2 del spec (versión
  `0.1.0`) se refería al repo Asistente-vfp, no a este. No aplica.
- `language-configuration.json` **sigue sin parsear**: `Bad escaped character in JSON … (line 14
  column 33)`. Las `indentationRules` tienen `\s` y `\b` sin escapar y usan `(?i:…)`.
- El completado ya existe en este repo, pero solo para miembros y literales de fábrica:
  `src/zoo/zooPlugin.ts` registra `completionProvider` (trigger characters `.`, `"`, `'`, `[`) y
  `onCompletion` llama a `factoryLiteralCompletion` / `memberCompletion`
  (`src/zoo/features/completion.ts`). No hay completado de plantillas por palabra.
- `funcnote` sigue como snippet estático en `snippets/foxpro.json`.

### Qué hay que hacer (adaptado del spec a este repo)

**1. Arreglar `language-configuration.json`** (P1-1 del spec)
- Escapar las barras y usar el formato `{ pattern, flags: "i" }` en `increaseIndentPattern` y
  `decreaseIndentPattern`, en lugar de `(?i:…)`.
- `text\b` estricto, para que no matchee `textmerge`. Dentro de `TEXT … ENDTEXT`, no reindentar.
- Verificar con tests `if` frente a `iif(`, y `case`/`otherwise` dentro de `do case`.
- Aceptación: test que hace `JSON.parse` del archivo, y una prueba manual de Enter / cierre con
  `define class`/`enddefine`, `function`/`endfunc`, `if`/`endif` y `try`/`catch`/`endtry`.

**2. Plantillas según el contexto** (P1-2 del spec)
- **Dónde va en este repo:** en el `onCompletion` de `src/zoo/zooPlugin.ts`, como un proveedor más
  dentro de `src/zoo/features/completion.ts`, que se consulta cuando no hay trigger character (por
  palabra). El spec original habla de `src/core/features/completion.ts` y `lspHost.ts` del core: hay
  que decidir si va en el core compartido o en el plugin zoo (ver "A definir").
- **Detección de contexto:** escaneo hacia atrás por líneas lógicas (continuación `;`) hasta el último
  `define class` o `enddefine`. No depender solo del rango de `ClassDecl`, porque mientras se escribe
  falta el `enddefine`. Ignorar comentarios (`*`, `&&`, `NOTE` con continuación), `TEXT … ENDTEXT` y
  `#if .f. … #endif`. No ofrecer nada dentro de strings ni de comentarios.
- **Items** (`Snippet`, `insertTextMode: asIs`, `textEdit` desde la columna 0 hasta el cursor):
  - a) fuera de clase, `class`/`define` → `define class ${1:Nombre} as ${2:custom}${3: of ${4:archivo}.prg}`
    … `enddefine`, en la columna 0. Dentro de una clase no se ofrece (VFP no admite clases anidadas).
  - b) dentro de clase, `function`/`procedure` → separador `*` + 89 `-` y el método con un tab, y el
    cuerpo con dos. Variantes `protected` y `hidden`. `procedure` cierra con `endproc`.
  - c) fuera de clase, `function`/`procedure` → función en la columna 0, sin separador.
  - d) `funcnote` pasa del snippet estático al proveedor, con `NOTE` indentado dentro de clase. Quitarlo
    de `snippets/foxpro.json` para que no aparezca dos veces (`note` y `notes` quedan como snippets).
- **Orden frente a zoo-tool-kit:** `sortText` con prefijo bajo (`"0_define_class"`), `preselect` en el
  item principal, `label` como `define class (Organic)` / `function – método (Organic)`, y vista previa
  en `documentation`.
- **Casing:** siempre en minúsculas. Opcional: una setting de mayúsculas/minúsculas. En este repo
  sería `zoo.completion.keywordCase`, no `asistenteVfp.…`, porque `configSection` es `zoo`.
- **Aceptación** (tests nuevos de completion): archivo vacío + `class`; `function` dentro de una clase
  sin `enddefine`; cursor entre métodos de una clase cerrada; `function` después de `enddefine`; `class`
  dentro de una clase (no se ofrece); string, `&&` o `TEXT … ENDTEXT` (sin items); `define class`
  precedido por `NOTE` con `;`; `procedure` dentro de una clase.

**3. Relacionados** (P2-1 y P2-3 del spec)
- Acordar con zoo-tool-kit quién es dueño de cada clave de `language-configuration.json` (las dos
  extensiones declaran `foxpro`: zoo-tool-kit aporta `folding`, nosotros `indentationRules` y
  `wordPattern`). Si la indentación queda de nuestro lado, sumar `onEnterRules` (por ejemplo, para
  continuar `NOTE … ;`).
- README: mientras zoo-tool-kit no corrija sus snippets, explicar cómo ocultar `vfpClass`, `function` y
  `vfpFunction` desde **Snippets: Insert Snippet** (ícono de ojo).

### A definir en la etapa
- ¿Las plantillas van en el core compartido (`asistente-vfp-core`), para que las tenga también la
  Asistente genérica, o solo en el plugin zoo? El estilo Organic (separador, `NOTE` con categorías)
  sugiere el plugin zoo, y la detección de contexto (dentro o fuera de clase) sugiere el core.
- Cómo conviven las plantillas por palabra con el completado de miembros actual en el mismo
  `onCompletion`: orden de consulta y qué pasa cuando los dos devuelven items.

---

## H4. F12 sobre `dodefault()` no sigue la cadena hasta la clase generada del proyecto activo

> **Estado 0.2.2: implementado.**
> - El cliente envía la ruta del `.code-workspace`. El servidor pone primero la carpeta que está en ese directorio
>   (el proyecto activo) y le da prioridad 0; las demás carpetas quedan con prioridad 1.
> - La carga por nombre de los generados (modo `none`) también busca primero en el proyecto activo.
> - Como es una prioridad de capa, aplica a todo lo que resuelve una clase: F12, hover, completion, call hierarchy e
>   inferencia.
> - Verificado contra los repos reales, con el workspace de Dragonfish y sus cuatro hermanos en los modos `none` y
>   `headers`: el `dodefault()` de `ValidacionBasica` en `ent_cliente.prg` (Feline) va a
>   `Organic.Dragonfish\Organic.Generated\Generados\Din_EntidadCliente.prg`.
> - Hay tests con el activo primero, con Feline como activo y con solo Dragonfish.

- **Proyecto:** Dragonfish, en un workspace con Dragonfish como proyecto principal y referencias a todos
  los demás proyectos (Feline incluido).
- **Contexto:** Dragonfish especializa el cliente en `entColorYTalle_Cliente.prg`, que tiene el método
  `validacionbasica()` con un `dodefault()`. La cadena esperada es:

  ```
  entColorYTalle_Cliente.prg   (Organic.Dragonfish)
    └─ ent_cliente.prg          (Feline)
         └─ din_EntidadCliente.prg  (generado; existe en cada proyecto, también en Feline)
  ```
- **Qué pasó:**
  1. F12 sobre el `dodefault()` de `entColorYTalle_Cliente.prg` → abre `validacionbasica` de
     `ent_cliente.prg` en Feline. **Correcto.**
  2. F12 sobre el `dodefault()` de `ent_cliente.prg` → **no** abre `din_EntidadCliente.prg`.
- **Qué se esperaba:** en el paso 2, abrir `din_EntidadCliente.prg` del **proyecto activo**
  (Organic.Dragonfish), no el de Feline. Los generados existen en todos los proyectos, y el que vale es
  el del producto con el que se está trabajando.

### Reglas a respetar
1. **El contexto de resolución es el proyecto activo**, aunque se esté navegando dentro de un archivo de
   otro proyecto. Al saltar a `ent_cliente.prg` de Feline, las clases que ese archivo usa o hereda se
   siguen resolviendo como las ve Dragonfish.
2. **Las clases generadas (`din_*`) se toman siempre del proyecto activo**, nunca de otro proyecto
   referenciado, aunque tengan el mismo nombre.
3. **Workspace con solo Dragonfish** (sin los demás proyectos abiertos): las clases de Feline se ven a
   través de los stubs o de la referencia que tenga Dragonfish (`.app` / `.symbols`), pero los
   generados sí deben estar, porque son locales a Dragonfish. F12 sobre el `dodefault()` del stub de
   `ent_cliente` debería poder llegar igual al `din_EntidadCliente.prg` local.

### Posible causa (sin confirmar)
- Al abrir un archivo de Feline, la resolución pasa a hacerse en el contexto de Feline (o de ningún
  proyecto), y no encuentra o descarta el `din_EntidadCliente` que corresponde.
- Con varias definiciones de `din_EntidadCliente` (una por proyecto), la desambiguación no prioriza la
  del proyecto activo, o al haber más de una no resuelve ninguna.
- El `dodefault()` dentro de un archivo que no es del proyecto activo, o dentro de un stub, no está
  contemplado.

### Cómo se determina el proyecto activo (definido)
Es la carpeta del workspace con `"path": "."`, es decir, la carpeta donde está el `.code-workspace`.
Las demás carpetas son proyectos referenciados con un path relativo. Ejemplo del workspace de
Dragonfish:

```json
"folders": [
  { "name": "🐟 Dragonfish", "path": "." },
  { "name": "🐯 Feline",     "path": "../Organic.Feline" },
  { "name": "⚙️ Core",       "path": "../Organic.Core" },
  { "name": "🎨 Drawing",    "path": "../Organic.Drawing" },
  { "name": "⚡ Generator",  "path": "../Organic.Generator" }
]
```

No depende del orden de las carpetas ni del archivo desde el que empieza la navegación.

Es la convención que se usa siempre en los workspaces del equipo:
- **Un solo proyecto:** el workspace tiene una única carpeta, `{ "path": "." }`.
- **Varios proyectos:** la misma carpeta `"."` más una entrada por cada proyecto referenciado.

Caso borde: si se abre una carpeta sin `.code-workspace`, esa carpeta es el proyecto activo. Un
workspace sin ninguna carpeta `"."` no sigue la convención. En ese caso, conviene usar la primera
carpeta y dejarlo registrado en el log.

### A definir en la etapa
- Si la misma regla aplica a hover, completion, find references, call hierarchy e inferencia de tipos
  dentro de archivos de otros proyectos.
- Probar los dos escenarios: workspace con todos los proyectos y workspace con solo Dragonfish (stubs
  más generados locales).

---

## H5. Sin alerta cuando el tipo de un argumento no coincide con el del parámetro (mejora)

> **Estado 0.2.2: implementado en el core** (`src/core/features/argumentTypes.ts`).
> - Setting `zoo.diagnostics.argumentTypes` / `vfp.diagnostics.argumentTypes`, activo por defecto. Código
>   `argTypeMismatch`, severidad `Warning`.
> - Tipos confiables: literales y variables o parámetros con `AS` del método. Un parámetro de clase acepta cualquier
>   objeto.
> - Un `AS` desconocido no se valida: ni primitivo ni clase conocida, como los errores de tipeo `Stirng` o
>   `as as String` que aparecen en el código real.
> - Medido sobre `Organic.Dragonfish\Organic.BusinessLogic` (531 archivos): 71 avisos, todos inconsistencias reales
>   entre el `AS` declarado y lo que se pasa. Por ejemplo, `SetearProveedor( toRequest as String )` recibe el
>   `toRequest as Object` de `EjecutarOperacion`. Tarda 8 ms por archivo en promedio y 0,8 s en el más pesado
>   (`ArmadorEstructuraLincevalidador.PRG`, 810 líneas).

- **Contexto:** al escribir la llamada a un método de un objeto, el signature help muestra los
  parámetros, resalta el que se está ingresando y, si está declarado con `AS`, informa su tipo.
- **Qué pasó:** si el parámetro es de tipo texto y se pasa un número (o al revés), no aparece ninguna
  alerta.
- **Qué se esperaba:** marcar el argumento incorrecto (subrayado o color, como un diagnóstico) con un
  mensaje en el tooltip del estilo *"Tipo incorrecto: se esperaba Character y se recibió Numeric"*.

### Estado actual (2026-11-26)
- El signature help está en el core compartido (`Asistente-vfp/src/core/features/signatureHelp.ts`):
  solo muestra información, no valida.
- Los diagnósticos del core (`src/core/features/diagnostics.ts`) salen del parser (`ParseDiagnostic`);
  no hay ningún diagnóstico semántico que compare tipos.

### Ideas para la etapa
- **Diagnóstico, no signature help:** el signature help no puede pintar ni subrayar el texto; lo que da
  el subrayado y el tooltip es un `Diagnostic` publicado para el rango del argumento. El signature help
  podría, además, agregar una advertencia en la documentación del parámetro activo.
- **Empezar por lo seguro:** validar solo cuando el tipo del argumento es inequívoco — literales
  (`"texto"`, `123`, `.T.`, `{^2026-01-01}`, `.NULL.`) y variables o propiedades con tipo declarado o
  inferido con certeza. Si el tipo es desconocido o `Variant`, no reportar.
- **Literales de texto:** en VFP un string puede escribirse con tres delimitadores: `"Texto"`, `'Texto'`
  y `[Texto]`. Los tres son `Character`. Ojo con `[`: es un literal cuando abre una expresión (por
  ejemplo, el argumento `metodo([Texto])`), pero es un subíndice cuando sigue a un identificador
  (`laArray[1]`).
- **Severidad:** `Warning` (o `Information`), nunca `Error`: VFP no tipa en tiempo de compilación y el
  `AS` es solo documentación, así que hay código válido que "no coincide". Agregar un `code` propio
  (por ejemplo `zoo.argTypeMismatch`) para poder desactivarlo o filtrarlo.
### Decidido (2026-11-26)
- **Va en el core compartido** (`asistente-vfp-core`), así lo tienen la Asistente genérica y el plugin
  zoo.
- **Setting para activarlo o desactivarlo, activada por defecto.** Como el core lee la configuración
  bajo el `configSection` de cada extensión, la clave queda `zoo.diagnostics.argumentTypes` en esta
  extensión y `asistenteVfp.diagnostics.argumentTypes` en la genérica (nombre a confirmar).
- **Grupos de tipos equivalentes** (dentro de un grupo no se reporta):
  - **Numéricos:** cualquier número es compatible con cualquier tipo numérico — `Number`, `Numeric`,
    `Int`, `Integer`, `Double`, `Float`, `Decimal`, `Currency`, etc.
  - **Fechas:** `Date` y `DateTime` son compatibles entre sí.
  - **Texto:** `Character`, `String`, `Memo` y `Varchar` (a confirmar).
  - Además: `.NULL.` se acepta en cualquier parámetro, y `Variant` (o un parámetro sin `AS`) acepta
    cualquier cosa.

### A definir en la etapa
- Qué fuentes de tipo se consideran confiables además de los literales: `AS` en `LPARAMETERS`/
  `PARAMETERS`, variables `LOCAL … AS`, propiedades, retornos de métodos, servicios.
- `Object` frente a una clase concreta: si se valida la jerarquía de clases o se acepta cualquier
  objeto.
- Cuándo se recalcula (al escribir o al guardar) y el costo en archivos grandes.

---

## H6. La indexación inicial es lenta y pesada por los generados (rendimiento)

> **Estado 0.2.2: implementado.**
> - `zoo.indexGenerated` y `--generated` del MCP pasan a `none` por defecto. Los generados siguen en
>   `<repo>\Organic.Generated\…`: en Dragonfish vienen del paquete `Organic.Adn.Generated.ColorYtalle` de adncli y
>   en Feline están versionados. No hizo falta cambiar la búsqueda.
> - Si el `Organic.Generated` del proyecto activo está vacío, el log sugiere `dovfp restore` y un build.
> - Mediciones finales: Feline 60,6 → 27,1 s la primera vez y 5,4–6,9 → 3,3 s con cache; Dragonfish
>   76,7 → 27,1 s y 7,6–9,4 → 3,7 s. La cache baja a 156 / 170 MB y la memoria a ~0,7 GB.
> - README actualizado.

- **Proyectos:** Feline y Dragonfish (los más grandes hoy).
- **Qué pasa:** el índice se arma en memoria en cada arranque. El parseo de cada `.prg` se guarda en una
  cache en disco (clave: ruta + mtime + tamaño), así que la primera vez es lenta y las siguientes solo
  reparsean lo que cambió. La mayor parte del costo son los generados, que se indexan por defecto en modo
  `headers`.
- **Qué se espera:** arranque rápido y menos memoria, sin perder la navegación hacia los generados.

### Mediciones (2026-11-27, configuración `zoo.*` por defecto salvo `indexGenerated`)

| | Feline `headers` | Dragonfish `headers` | Dragonfish `none` |
|---|---|---|---|
| `.prg` | 15.733 | 23.640 | 23.640 (≈17.700 generados se saltean) |
| Primera vez | 60,6 s | 76,7 s | **28,4 s** |
| Con cache | 5,4–6,9 s | 7,6–9,4 s | **3,9 s** |
| Cache en disco | 304 MB | 448 MB | **170 MB** |
| Memoria (rss) | ~1,0–1,5 GB | ~1,3 GB | **0,77 GB** |
| Clases indexadas | 16.983 | 19.050 | 7.330 (las generadas se cargan por nombre) |

En la primera vez, guardar la cache tarda 15–18 s en modo `headers` y 2,4 s en `none`. El README todavía
dice ~25–35 s para la primera vez de Dragonfish.

### Contexto (2026-11-27)
- **Los generados los produce adncli** y cada solución los obtiene de ahí. Hoy la extensión los busca en
  `<raíz>/Organic.Generated` (`buildGeneratedMap`, `afterIndex` en `src/zoo/zooPlugin.ts`).
- **Los generados no incluyen el NOTE como docstring**, así que no aportan documentación al hover ni al
  completado. Excluirlos del índice pierde poco.
- **En esta versión el índice no se sube a ningún repo** ni se comparte. Eso se decide después de que el
  equipo lo pruebe (ver `temas-version-siguiente.md`).

### Qué hay que hacer
1. **`zoo.indexGenerated` pasa a `none` por defecto.** El setting ya existe (`src/zoo/settings.ts`,
   `package.json`). En modo `none` los generados no se indexan, pero una clase generada se carga cuando
   se la pide por nombre (`index.classLoader` → `ZooState.loadGenerated`).
2. **Buscar los generados donde los deja adncli.** Confirmar la ruta o el mecanismo actual y adaptar la
   búsqueda de `buildGeneratedMap` (y el `parseHint` / `isGeneratedPath`, si cambia la carpeta).
3. **Verificar qué funciones dependen del índice completo de generados** con `none`: Ctrl+T (workspace
   symbols), Find References, subtipos, call hierarchy, completado de miembros heredados de una clase
   `din_*`. Hover, F12 e inferencia de tipos deberían seguir con la carga bajo demanda.
4. **Actualizar el README** con los tiempos y la memoria nuevos, y explicar cómo volver a `headers`.

### Relación con otros casos
- **H4:** los `din_*` tienen que salir del proyecto activo. Con `none` vienen de la carga por nombre, así
  que esa búsqueda tiene que priorizar el `Organic.Generated` (o la ruta de adncli) del proyecto activo.
  Conviene resolver H4 y H6 juntos.

### A definir en la etapa
- Si se incluye en la 0.2.2 la **clave por hash de git + actualización por diff** (sin subir nada al repo,
  detalle en `temas-version-siguiente.md`). Rinde sobre todo si el equipo usa worktrees o varios clones;
  con `none` el arranque normal ya está en ~4 s.
- Si `headers` sigue disponible como opción o se simplifica el setting a "incluir / no incluir".
