# Temas para la versión siguiente (después de la 0.2.2)

Estado: **en registro.** Acá van los temas que se postergan de la 0.2.2 y los que surjan cuando el equipo
la pruebe. El alcance de la 0.2.2 está en [hallazgos-pruebas.md](hallazgos-pruebas.md).

Otros temas evaluados y no planificados: [pendientes-rename-formatting.md](pendientes-rename-formatting.md).

---

## V1. Índice persistente, incremental y compartido

### Punto de partida
- La cache de parseo (`ParseCache` en `Asistente-vfp/src/core/index/workspaceScanner.ts`) usa como clave
  **ruta + mtime + tamaño**. Está repartida en 32 shards y solo se reescriben los shards que cambiaron.
- En cada arranque se lista cada raíz, se hace `stat` de cada archivo, se lee la cache entera y se arma el
  índice en memoria.
- Un `git checkout` solo reescribe los archivos que difieren, así que cambiar de rama ya reparsea solo esos
  archivos.
- Con los generados fuera del índice (H6 de la 0.2.2), Dragonfish arranca en ~28 s la primera vez y
  ~4 s con cache. Las mediciones están en H6.

### Dónde la cache actual no alcanza
1. **Clon nuevo, worktree nuevo, otra máquina o carpeta borrada:** todos los mtime son nuevos, así que
   hay que reparsear todo aunque el contenido sea idéntico.
2. **Herramientas que tocan el mtime sin cambiar el contenido:** reparsean sin necesidad.
3. **Cada arranque recorre todos los archivos** (listado + `stat`) y carga la cache completa.
4. **Cada desarrollador genera su propia cache**, por workspace, y otra aparte para el MCP.

### Opciones
1. **Clave por contenido (blob SHA de git).** `git ls-files -s` devuelve el SHA del blob de cada archivo
   versionado sin leerlo (~0,15 s por repo, medido en Core, Feline y Dragonfish). La cache sirve para
   cualquier clon, worktree, rama o máquina con el mismo contenido. Para los archivos modificados en el
   working tree (`git status --porcelain`, ~0,2 s) se sigue usando mtime+tamaño o el hash del contenido.
2. **Actualización por diff.** Guardar el HEAD indexado de cada repo. Al arrancar,
   `git diff --name-status <commit indexado> HEAD` + `git status --porcelain` dan la lista exacta de
   cambios, sin recorrer ni hacer `stat` del resto. Si el commit ya no existe (rebase, gc) o `git` falla,
   se vuelve al recorrido completo. Vigilando `.git/HEAD` se puede actualizar después de un pull, un merge
   o un cambio de rama sin reiniciar.
3. **Arranque desde un índice ya armado.** Guardar las clases y miembros listos para usar y cargar los
   modelos completos bajo demanda, en lugar de desempaquetar toda la cache.
4. **Índice compartido.** Que el índice de `main` lo genere CI, o que se suba o se genere en el repo, y
   cada desarrollador aplique encima solo el diff de su rama o PR.
5. **Una sola cache para la extensión y el MCP.** Hoy son dos copias: `workspaceStorage` de VS Code y
   `%TEMP%\asistente-vfp-zoo`.

### Límites a tener en cuenta
- **Los generados no están en git:** los produce adncli. Si vuelven a indexarse, mantienen la clave
  mtime+tamaño, o se identifican por la versión de adncli que los generó.
- **Carpetas `Organic.Tests.Autobuild`** (~1.500 `.prg` no versionados entre Core, Drawing, Feline y
  Dragonfish): mismo tratamiento que los generados.
- **Seis repos hermanos**, cada uno con su HEAD: el estado indexado es una tupla de commits.
- **`.symbols`, stubs y VCX** (`afterIndex`, < 1 s): no ganan con esto.
- **La clave de configuración** (`callNames`, `fallbackComments`) y la versión del parser
  (`CACHE_VERSION`) tienen que viajar con cualquier índice compartido.
- **Sin git o con git roto:** el recorrido actual queda siempre como respaldo.

### Para decidir (después de que el equipo pruebe la 0.2.2)
- ¿Se usan worktrees o varios clones? (Ahí rinden las opciones 1 y 2.)
- ¿El índice se sube al repo, se genera en el repo o lo genera CI? ¿Dónde se publica?
- ¿La extensión y el MCP comparten la misma cache?

---

## V2. Surgidos al implementar la 0.2.2

### Generados fuera del índice (H6)
Con `indexGenerated: "none"`, los generados no aparecen en Ctrl+T, Find References, subtipos ni Call Hierarchy.
Si el equipo los extraña, hay dos opciones:
- **Índice liviano de nombres:** un mapa archivo → clase. Ya existe (`generatedFiles`) y alcanza para Ctrl+T.
- **Indexado en segundo plano:** los generados en modo `headers`, después del arranque y con prioridad baja.

### Diagnóstico de tipos de argumento (H5)
- **Volumen:** en `Organic.Dragonfish\Organic.BusinessLogic` da 71 avisos, todos inconsistencias reales del `AS`.
  Hay que decidir si se corrige el código, si se baja la severidad a `Information` o si se apaga por repo.
- **Costo:** 8 ms por archivo en promedio y 0,8 s en el más pesado (810 líneas), en cada recálculo de
  diagnósticos. Si molesta al escribir, hay dos opciones:
  - recalcular solo las líneas cambiadas;
  - posponerlo hasta guardar el archivo.
- **Alcance:** falta definir más fuentes de tipo confiables:
  - propiedades con tipo;
  - retornos de métodos (`as Clase`);
  - servicios;
  - validar la jerarquía para parámetros de clase.

### Indentación (H3)
- No reindentar dentro de `TEXT … ENDTEXT`: no se puede con `indentationRules`. Habría que hacerlo con
  `onEnterRules` o con un formateador.
- Acordar con zoo-tool-kit quién es dueño de cada clave de `language-configuration.json`, y sumar `onEnterRules`
  para continuar `NOTE … ;`.

### Clases de test (H1)
Desde un test, las clases de la aplicación van antes que las de otros archivos de test (salvo la del mismo
archivo). Si algún proyecto de tests redefine clases a propósito para reemplazarlas, habría que darles prioridad
dentro de los tests.
