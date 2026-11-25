# Pendiente a evaluar: Rename y Formatting

Estado: **no planificado.** Este documento registra qué se evaluó y por qué no entra en las etapas 1 y
2, para retomarlo si el equipo lo pide.

## Rename (`textDocument/rename`, `prepareRename`) — F2

### Qué daría
Renombrar un símbolo y todos sus usos en una sola operación, con vista previa (Refactor Preview).

### Por qué se posterga
En VFP no se puede garantizar que un renombre sea completo ni correcto:
- **Macros y evaluación dinámica:** `&lcMetodo`, `EVALUATE()`, `EXECSCRIPT()`, `PEMSTATUS(…, "Nombre", …)`,
  `ADDPROPERTY(…, "Nombre")` usan nombres dentro de strings o armados en tiempo de ejecución.
- **Receptores de tipo desconocido:** un `loX.Metodo()` sin tipo deducido puede ser o no ese método.
  Renombrarlo es arriesgarse; no renombrarlo deja código roto.
- **Multi-repo:** un método de `Organic.Core` se redefine o llama desde Feline, Dragonfish, ZL… Un
  rename en Core no alcanza a los repos consumidores abiertos por separado ni a los `.app`
  (`.symbols`/stubs).
- **VCX/SCX:** las clases visuales guardan nombres en tablas binarias que la extensión solo lee.
- **Generados y mocks:** `Organic.Generated` y `Organic.Mocks` se regeneran. Un rename ahí se pierde, y
  no hacerlo los desincroniza.

### Alcance posible si se retoma
1. **Seguro:** locales y parámetros dentro de un método (alcance cerrado, sin dinámica salvo `&`).
   `prepareRename` rechaza el resto con un mensaje claro.
2. **Asistido:** propiedades y métodos con tipo deducido, siempre con vista previa:
   - se reutiliza Find References: las referencias exactas quedan marcadas;
   - las heurísticas y los strings que coinciden van como cambios **sin marcar** para revisión manual;
   - se advierte sobre los repos consumidores y los VCX afectados.
3. **Nunca:** renombrar dentro de `.app`, stubs, generados o mocks.

### Para decidir
- ¿El equipo renombra a mano hoy? ¿Con qué frecuencia y con qué herramienta?
- ¿Alcanza con el nivel 1, o hace falta el 2?

## Formatting (`textDocument/formatting`, `rangeFormatting`, `onTypeFormatting`)

### Qué daría
Indentación y estilo uniformes (Shift+Alt+F), opcionalmente al guardar o al escribir.

### Por qué se posterga
- **Convenciones del equipo:** tabs, mayúsculas de palabras clave, separadores `*----…`, ubicación de
  `NOTE`, continuaciones con `;`. Formatear sin un acuerdo explícito genera diffs enormes y conflictos
  de merge en todo el código existente.
- **Herramientas existentes:** si el equipo ya usa otra herramienta (BeautifyX de VFP, reglas del
  zoo-tool-kit), habría dos formateadores con criterios distintos.
- **Riesgo de romper código:** `TEXT…ENDTEXT`, `#if .f.`, macros y continuaciones `;` son frágiles ante
  un reindentado automático.

### Alcance posible si se retoma
1. **Solo indentación,** usando las mismas reglas de `indentationRules` de `language-configuration.json`,
   y solo en rango (selección) o en las líneas modificadas. Nunca el archivo completo por defecto.
2. **`onTypeFormatting`** acotado: reindentar la línea al escribir `endfunc`, `endif`, `enddefine`, …
3. **Configurable y apagado por defecto** (`zoo.format.enabled: false`).

### Para decidir
- ¿Existe una guía de estilo escrita? ¿La valida alguna herramienta hoy?
- ¿Se quiere formatear el código existente o solo el que se escribe nuevo?

## Otros evaluados y no incluidos
- **Folding / Selection Range:** confirmado en la etapa 2 (E2.4); no queda pendiente.
- **Formatting de `NOTE`:** el generador de `NOTE` desde la firma (quick fix N2) ya cubre lo más útil.
