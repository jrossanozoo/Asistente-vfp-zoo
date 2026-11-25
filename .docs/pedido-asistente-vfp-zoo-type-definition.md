# Pedido: navegar a la clase desde variables, propiedades y globales `go*`

Repo: `Asistente-vfp-zoo` (con el núcleo `../Asistente-vfp`). Versión probada: 0.1.0 (`9aa195e`).

## Problema

La extensión ya deduce el tipo de variables y propiedades: la completion y el signature help
muestran los miembros de `Mensajes` sobre `goServicios.Mensajes.`, `goMensajes.` y `this.oMensajes.`.
Pero F12 sobre la variable o la propiedad nunca lleva a la **clase**:

| F12 sobre | Hoy | Esperado |
|---|---|---|
| `this.oMensajes` (asignada con `this.oMensajes = _Screen.zoo.CrearObjeto("Mensajes")`) | `oMensajes = null` de la clase actual | declaración de la propiedad con F12 (ok); la clase `Mensajes` con Go to Type Definition |
| `goServicios.Mensajes` | `Mensajes = null` en `serviciosaplicacion.PRG:16` | ídem: propiedad con F12, clase `Mensajes` con Go to Type Definition |
| `goMensajes` | **nada** | clase `Mensajes` (`mensajes.prg:1`), también con F12 |
| `Advertir` en `goMensajes.Advertir(` | `Mensajes.Advertir` **+ 4 resultados** en `Organic.Mocks/Generados/Mock_Mensaje*.prg` | solo `Mensajes.Advertir` |

Lo que ya funciona y no debe cambiar: F12 sobre literales de fábrica (`CrearObjeto("Mensajes")`,
`NewObject`, `CreateObject`, `InstanciarEntidad`, …), sobre `local x as Clase of lib.prg` y sobre
métodos con el receptor deducido (`this.oMensajes.Advertir` → `Mensajes.Advertir`).

## Requerimientos

### R1. Go to Type Definition (`textDocument/typeDefinition`)
- Anunciar `typeDefinitionProvider: true` en `capabilities()` (`Asistente-vfp/src/core/lspHost.ts`)
  y registrar `c.onTypeDefinition`, al lado de `onDefinition`/`onImplementation`.
- Con el cursor sobre una variable, propiedad o cadena `a.b.c`, usar el mismo `TypeResolver`
  que alimenta la completion (en Organic, `ZooTypeResolver` de `src/zoo/inference/typeInference.ts`)
  y devolver la ubicación de la clase (`define class`) deducida.
- Respetar la precedencia por producto que ya usa la inferencia (`ServiciosAplicacion{P}`,
  `{P}_X`, …): si hay varias candidatas, devolver todas en el orden de precedencia (peek).
- Casos: `this.oX`, `loX` (local tipado o asignado desde una fábrica en el mismo método),
  `goServicios`, `goServicios.<Prop>`, globales `go*`, `_screen.zoo`, `_screen.zoo.app`,
  `this` / `thisform`.
- Si el tipo no se puede deducir, devolver `[]` (no caer en una búsqueda heurística por nombre).

### R2. F12 sobre globales `go*` sin declaración
- `goMensajes`, `goLibrerias`, `goParametros`, … no tienen declaración en la fuente: se crean con
  `PUBLIC &tcObjetoGlobal` en `AplicacionBase.IniciarServicio`. Hoy F12 no devuelve nada.
- Si el símbolo es una global de la tabla de servicios (`svc.globals`) y no tiene declaración propia,
  F12 debe ir a la clase (lo mismo que R1). Si existe una declaración real (`public goX` en el código),
  primero va la declaración y después la clase.

### R3. No mezclar mocks en los resultados por nombre
- La resolución heurística (receptor de tipo desconocido) trae `Organic.Mocks/Generados/Mock_*.prg`.
- Excluir `Organic.Mocks` de los resultados de F12/Find References heurísticos, igual que
  `Organic.Generated` (`zoo.references.includeGenerated`). Proponer `zoo.references.includeMocks`
  (por defecto `false`) o agregarlo al mismo criterio.
- Revisar además por qué `goMensajes.Advertir` cae en la resolución heurística: `goMensajes` debería
  resolverse por la tabla de globales (`goMensajes → Mensajes`), y entonces dar un solo resultado.

## Criterios de aceptación
- Tests en `test/zoo.test.ts` con fixtures en `test/fixtures/organic/` para cada fila de la tabla
  (F12 y Type Definition), incluido un caso con producto (`{P}_Mensajes` existente gana a `Mensajes`).
- `npm test` y `npm run typecheck` en verde; sin regresiones en los casos de "lo que ya funciona".
- README: agregar la fila de Type Definition a la tabla de funcionalidades (F1..F9) y la nueva
  configuración de R3 a la tabla de configuración.
- El servidor MCP (`dist/mcp.js`) no necesita cambios, salvo que `organic_get_doc` quiera reutilizar R1.

## Validación manual (Organic.Core)
Con `C:\LinceV3\Organic.Core` abierto, en cualquier `.prg`:
```foxpro
this.oMensajes = _Screen.zoo.CrearObjeto("Mensajes")
this.oMensajes.Advertir("x")
goServicios.Mensajes.Advertir("x")
goMensajes.Advertir("x")
```
- F12 / Go to Type Definition sobre `oMensajes`, `goServicios.Mensajes` y `goMensajes` según la tabla.
- F12 sobre `Advertir` en las tres líneas → solo `mensajes.prg` (`Mensajes.Advertir`).

## Nota para probar el servidor sin VS Code
Se puede manejar `dist/server.js --stdio` desde un script Node (initialize → initialized → didOpen →
`textDocument/definition`). Dos detalles que hacen que el índice quede vacío si se omiten:
- pasar `initializationOptions.storagePath`;
- responder **todos** los requests del servidor, incluido el primero, que llega con `id: 0`
  (`workspace/configuration` con sección `zoo`; responder `[{}]`). Si no se responde,
  `loadSettings()` no termina y `reindex()` nunca corre.
