import { MarkupKind, SignatureInformation } from 'vscode-languageserver-types';

/**
 * Catálogo acotado de funciones nativas de VFP para la ayuda de parámetros (§6.7.1).
 * Textos propios en español. Formato compacto: [nombre, parámetros, descripción, retorno].
 * Parámetros: `nombre:descripción` separados por `|`. Los opcionales llevan `?`.
 */
type Entry = [string, string, string, string?];

const ENTRIES: Entry[] = [
  // Texto
  ['ALLTRIM', 'cTexto:texto a recortar|nFlags?:1 = sin distinguir mayúsculas al quitar caracteres|cCaracteres?:caracteres a quitar (por defecto espacios)', 'Quita espacios (u otros caracteres) a izquierda y derecha.', 'String'],
  ['LTRIM', 'cTexto:texto a recortar|nFlags?:1 = sin distinguir mayúsculas|cCaracteres?:caracteres a quitar', 'Quita espacios a la izquierda.', 'String'],
  ['RTRIM', 'cTexto:texto a recortar|nFlags?:1 = sin distinguir mayúsculas|cCaracteres?:caracteres a quitar', 'Quita espacios a la derecha.', 'String'],
  ['SUBSTR', 'cTexto:texto de origen|nInicio:posición inicial (1 = primer carácter)|nCantidad?:cantidad de caracteres; si se omite, hasta el final', 'Devuelve una parte del texto.', 'String'],
  ['LEFT', 'cTexto:texto de origen|nCantidad:cantidad de caracteres desde la izquierda', 'Primeros N caracteres.', 'String'],
  ['RIGHT', 'cTexto:texto de origen|nCantidad:cantidad de caracteres desde la derecha', 'Últimos N caracteres.', 'String'],
  ['STRTRAN', 'cTexto:texto donde se busca|cBuscado:texto a reemplazar|cReemplazo?:texto nuevo (vacío si se omite)|nDesdeOcurrencia?:primera ocurrencia a reemplazar (1 = la primera)|nCantidad?:cuántas ocurrencias reemplazar (-1 = todas)|nFlags?:1 = sin distinguir mayúsculas; 2 = respeta mayúsculas del original; 3 = ambas', 'Reemplaza ocurrencias de un texto dentro de otro.', 'String'],
  ['STUFF', 'cTexto:texto de origen|nInicio:posición donde empieza el reemplazo|nCantidad:caracteres a quitar|cReemplazo:texto a insertar', 'Reemplaza un tramo por posición (inserta si nCantidad es 0).', 'String'],
  ['CHRTRAN', 'cTexto:texto de origen|cCaracteres:caracteres a buscar|cReemplazos:caracteres nuevos, en la misma posición', 'Reemplaza carácter por carácter; los que no tienen par se eliminan.', 'String'],
  ['AT', 'cBuscado:texto a buscar|cTexto:texto donde se busca|nOcurrencia?:qué aparición buscar (1 = la primera)', 'Posición de un texto dentro de otro, distinguiendo mayúsculas. 0 si no está.', 'Number'],
  ['ATC', 'cBuscado:texto a buscar|cTexto:texto donde se busca|nOcurrencia?:qué aparición buscar', 'Como AT pero sin distinguir mayúsculas.', 'Number'],
  ['RAT', 'cBuscado:texto a buscar|cTexto:texto donde se busca|nOcurrencia?:qué aparición desde el final', 'Posición de la última aparición.', 'Number'],
  ['OCCURS', 'cBuscado:texto a contar|cTexto:texto donde se cuenta', 'Cantidad de apariciones.', 'Number'],
  ['PADL', 'eValor:valor (se convierte a texto)|nLargo:largo final|cRelleno?:carácter de relleno (espacio por defecto)', 'Completa por la izquierda hasta el largo pedido (recorta si sobra).', 'String'],
  ['PADR', 'eValor:valor (se convierte a texto)|nLargo:largo final|cRelleno?:carácter de relleno', 'Completa por la derecha hasta el largo pedido.', 'String'],
  ['PADC', 'eValor:valor (se convierte a texto)|nLargo:largo final|cRelleno?:carácter de relleno', 'Centra completando a ambos lados.', 'String'],
  ['UPPER', 'cTexto:texto', 'Pasa a mayúsculas.', 'String'],
  ['LOWER', 'cTexto:texto', 'Pasa a minúsculas.', 'String'],
  ['PROPER', 'cTexto:texto', 'Primera letra de cada palabra en mayúscula.', 'String'],
  ['LEN', 'cTexto:texto', 'Cantidad de caracteres.', 'Number'],
  ['REPLICATE', 'cTexto:texto a repetir|nVeces:cantidad de repeticiones', 'Repite un texto.', 'String'],
  ['SPACE', 'nCantidad:cantidad de espacios', 'Texto con N espacios.', 'String'],
  ['CHR', 'nCodigo:código ANSI (0-255)', 'Carácter de un código.', 'String'],
  ['ASC', 'cTexto:texto (se usa el primer carácter)', 'Código ANSI del primer carácter.', 'Number'],
  ['GETWORDNUM', 'cTexto:texto de origen|nPalabra:número de palabra (1 = la primera)|cDelimitadores?:caracteres que separan palabras (espacio, tab y salto por defecto)', 'Devuelve la palabra N.', 'String'],
  ['GETWORDCOUNT', 'cTexto:texto de origen|cDelimitadores?:caracteres que separan palabras', 'Cantidad de palabras.', 'Number'],
  ['STREXTRACT', 'cTexto:texto donde se busca|cInicio:delimitador inicial|cFin?:delimitador final|nOcurrencia?:qué aparición|nFlags?:1 = sin distinguir mayúsculas; 2 = fin opcional; 4 = incluye delimitadores', 'Extrae el texto entre dos delimitadores.', 'String'],
  ['ALINES', 'aDestino:arreglo que recibe las líneas|cTexto:texto a dividir|nFlags?:1 = recorta; 4 = omite vacías; 8 = sin distinguir mayúsculas en separadores|cSeparador?:separadores adicionales (uno o más parámetros)', 'Divide un texto en líneas (o por separadores) dentro de un arreglo. Devuelve la cantidad.', 'Number'],
  ['LIKE', 'cPatron:patrón con * y ?|cTexto:texto a comparar', 'Compara contra un patrón con comodines.', 'Logical'],
  ['TEXTMERGE', 'cTexto:texto con expresiones entre << >>|lRecursivo?:evalúa también el resultado|cDelimIzq?:delimitador izquierdo|cDelimDer?:delimitador derecho', 'Evalúa las expresiones incrustadas en un texto.', 'String'],
  ['MLINE', 'cMemo:texto o campo memo|nLinea:número de línea|nOffset?:desplazamiento inicial', 'Una línea de un memo.', 'String'],
  ['MEMLINES', 'cMemo:texto o campo memo', 'Cantidad de líneas de un memo.', 'Number'],
  // Lógicas y de tipo
  ['IIF', 'lCondicion:condición|eSiVerdadero:valor si es .T.|eSiFalso:valor si es .F.', 'If en línea: evalúa solo la rama elegida.'],
  ['ICASE', 'lCondicion1:primera condición|eResultado1:valor si se cumple|lCondicion2?:siguiente condición (pares condición/valor)|eResultado2?:valor si se cumple|eOtherwise?:valor si ninguna se cumple', 'Varias condiciones en línea (como DO CASE).'],
  ['INLIST', 'eValor:valor a buscar|eOpcion1:primera opción|eOpcion2?:más opciones (hasta 24)', '.T. si el valor coincide con alguna opción.', 'Logical'],
  ['BETWEEN', 'eValor:valor a evaluar|eMinimo:límite inferior (incluido)|eMaximo:límite superior (incluido)', '.T. si el valor está en el rango.', 'Logical'],
  ['EMPTY', 'eValor:valor a evaluar', '.T. si está vacío (texto en blanco, 0, fecha vacía, .F.).', 'Logical'],
  ['ISNULL', 'eValor:valor a evaluar', '.T. si es .NULL.', 'Logical'],
  ['NVL', 'eValor:valor a evaluar|eSiNulo:valor si el primero es .NULL.', 'Reemplaza .NULL. por otro valor.'],
  ['EVL', 'eValor:valor a evaluar|eSiVacio:valor si el primero está vacío', 'Reemplaza un valor vacío por otro.'],
  ['VARTYPE', 'eValor:valor a evaluar (no se evalúa como texto)|lNullTipo?:.T. = si es .NULL. devuelve el tipo en lugar de "X"', 'Tipo de un valor: C, N, L, D, T, O, X…', 'String'],
  ['TYPE', 'cExpresion:expresión como texto|nArreglo?:1 = indica si es arreglo', 'Tipo de una expresión escrita como texto (U si no existe).', 'String'],
  ['TRANSFORM', 'eValor:valor a formatear|cMascara?:máscara (por ejemplo "@Z 999.99")', 'Convierte a texto con una máscara opcional.', 'String'],
  ['STR', 'nNumero:número|nLargo?:largo total (10 por defecto)|nDecimales?:decimales', 'Número a texto alineado a la derecha.', 'String'],
  ['VAL', 'cTexto:texto con un número', 'Texto a número.', 'Number'],
  // Números
  ['INT', 'nNumero:número', 'Parte entera (trunca).', 'Number'],
  ['ROUND', 'nNumero:número|nDecimales:decimales (negativo redondea a decenas, centenas…)', 'Redondea.', 'Number'],
  ['MOD', 'nDividendo:dividendo|nDivisor:divisor', 'Resto de la división.', 'Number'],
  ['ABS', 'nNumero:número', 'Valor absoluto.', 'Number'],
  ['MAX', 'eValor1:primer valor|eValor2:segundo valor (más opcionales)', 'El mayor de los valores.'],
  ['MIN', 'eValor1:primer valor|eValor2:segundo valor (más opcionales)', 'El menor de los valores.'],
  // Fechas
  ['DATE', 'nAnio?:año|nMes?:mes|nDia?:día', 'Fecha de hoy o la fecha armada.', 'Date'],
  ['DATETIME', 'nAnio?:año|nMes?:mes|nDia?:día|nHora?:hora|nMinuto?:minuto|nSegundo?:segundo', 'Fecha y hora actual o armada.', 'DateTime'],
  ['CTOD', 'cFecha:fecha como texto (según SET DATE)', 'Texto a fecha.', 'Date'],
  ['DTOC', 'dFecha:fecha|n1?:1 = formato AAAAMMDD', 'Fecha a texto según SET DATE.', 'String'],
  ['DTOS', 'dFecha:fecha', 'Fecha a texto AAAAMMDD (ordenable).', 'String'],
  ['TTOC', 'tFechaHora:fecha y hora|nFormato?:1 = AAAAMMDDhhmmss; 2 = solo hora; 3 = ISO', 'Fecha y hora a texto.', 'String'],
  ['CTOT', 'cTexto:fecha y hora como texto', 'Texto a fecha y hora.', 'DateTime'],
  ['YEAR', 'dFecha:fecha', 'Año.', 'Number'],
  ['MONTH', 'dFecha:fecha', 'Mes (1-12).', 'Number'],
  ['DAY', 'dFecha:fecha', 'Día del mes.', 'Number'],
  ['GOMONTH', 'dFecha:fecha|nMeses:meses a sumar (negativo resta)', 'Suma meses ajustando fin de mes.', 'Date'],
  // Arreglos
  ['ALEN', 'aArreglo:arreglo|nAtributo?:0 = elementos; 1 = filas; 2 = columnas', 'Tamaño de un arreglo.', 'Number'],
  ['ASCAN', 'aArreglo:arreglo|eBuscado:valor a buscar|nInicio?:primer elemento|nCantidad?:elementos a recorrer|nColumna?:columna en arreglos de 2 dimensiones|nFlags?:7 = exacto y sin distinguir mayúsculas; 8 = devuelve la fila', 'Busca un valor en un arreglo. 0 si no está.', 'Number'],
  ['ASORT', 'aArreglo:arreglo|nInicio?:primer elemento|nCantidad?:elementos a ordenar|nOrden?:0 = ascendente; 1 = descendente|nFlags?:1 = sin distinguir mayúsculas', 'Ordena un arreglo.', 'Number'],
  ['ADEL', 'aArreglo:arreglo|nElemento:elemento o fila a borrar|nTipo?:2 = borra una columna', 'Borra un elemento y corre el resto (no achica el arreglo).', 'Number'],
  ['AINS', 'aArreglo:arreglo|nElemento:posición donde insertar|nTipo?:2 = inserta una columna', 'Inserta un elemento vacío (no agranda el arreglo).', 'Number'],
  ['ACOPY', 'aOrigen:arreglo de origen|aDestino:arreglo de destino|nInicio?:primer elemento de origen|nCantidad?:elementos a copiar|nDestino?:primer elemento de destino', 'Copia elementos entre arreglos.', 'Number'],
  ['AMEMBERS', 'aDestino:arreglo que recibe los miembros|oObjeto:objeto o nombre de clase|nTipo?:1 = con tipo; 2 = objetos contenidos; 3 = con detalle', 'Lista propiedades, métodos y objetos de un objeto.', 'Number'],
  ['AFIELDS', 'aDestino:arreglo que recibe la estructura|cAlias?:alias o área', 'Estructura de una tabla o cursor.', 'Number'],
  // Datos
  ['SEEK', 'eClave:valor a buscar en el índice activo|cAlias?:alias o área de trabajo|cIndice?:etiqueta o número de índice', 'Busca por índice y mueve el puntero. .T. si encontró.', 'Logical'],
  ['INDEXSEEK', 'eClave:valor a buscar|lMover?:.T. = mueve el puntero si encuentra|cAlias?:alias o área|cIndice?:etiqueta o número de índice', 'Busca por índice sin mover el puntero (salvo lMover).', 'Logical'],
  ['USED', 'cAlias?:alias o área', '.T. si el alias está abierto.', 'Logical'],
  ['ALIAS', 'nArea?:área de trabajo', 'Alias del área.', 'String'],
  ['SELECT', 'eAreaOAlias?:0 = área libre; alias o número', 'Número de área de trabajo.', 'Number'],
  ['RECCOUNT', 'cAlias?:alias o área', 'Cantidad de registros (incluye borrados).', 'Number'],
  ['RECNO', 'cAlias?:alias o área', 'Número de registro actual.', 'Number'],
  ['EOF', 'cAlias?:alias o área', '.T. si el puntero pasó el último registro.', 'Logical'],
  ['BOF', 'cAlias?:alias o área', '.T. si el puntero está antes del primero.', 'Logical'],
  ['FOUND', 'cAlias?:alias o área', '.T. si la última búsqueda encontró.', 'Logical'],
  ['FIELD', 'nCampo:número de campo|cAlias?:alias o área', 'Nombre de un campo.', 'String'],
  ['SQLEXEC', 'nConexion:handle de conexión|cSentencia?:sentencia SQL|cCursor?:nombre del cursor resultado (SQLRESULT por defecto)', 'Ejecuta SQL en una conexión remota. Devuelve > 0 si anduvo.', 'Number'],
  // Archivos
  ['FILE', 'cArchivo:ruta del archivo|nFlags?:1 = no busca en SET PATH', '.T. si el archivo existe.', 'Logical'],
  ['FILETOSTR', 'cArchivo:ruta del archivo', 'Lee un archivo completo a texto.', 'String'],
  ['STRTOFILE', 'cTexto:texto a escribir|cArchivo:ruta del archivo|nFlags?:1 = agrega al final; 2/4 = escribe con BOM', 'Escribe un texto en un archivo. Devuelve los bytes escritos.', 'Number'],
  ['ADDBS', 'cRuta:ruta', 'Agrega la barra final si falta.', 'String'],
  ['JUSTFNAME', 'cRuta:ruta completa', 'Nombre del archivo con extensión.', 'String'],
  ['JUSTSTEM', 'cRuta:ruta completa', 'Nombre del archivo sin extensión.', 'String'],
  ['JUSTPATH', 'cRuta:ruta completa', 'Carpeta del archivo.', 'String'],
  ['JUSTEXT', 'cRuta:ruta completa', 'Extensión del archivo.', 'String'],
  ['FORCEEXT', 'cRuta:ruta|cExtension:extensión nueva', 'Cambia la extensión.', 'String'],
  ['FULLPATH', 'cArchivo:archivo|cBase?:carpeta o archivo de referencia', 'Ruta completa.', 'String'],
  ['DIRECTORY', 'cCarpeta:carpeta|nFlags?:1 = considera carpetas ocultas', '.T. si la carpeta existe.', 'Logical'],
  // Objetos
  ['PEMSTATUS', 'oObjeto:objeto|cMiembro:nombre de propiedad, evento o método|nAtributo:5 = existe; 0 = cambiado; 1 = solo lectura; 2 = protegido; 3 = tipo; 4 = definido por el usuario; 6 = heredado', 'Consulta atributos de un miembro de un objeto.'],
  ['ADDPROPERTY', 'oObjeto:objeto|cPropiedad:nombre de la propiedad (admite arreglo)|eValor?:valor inicial', 'Agrega una propiedad en tiempo de ejecución.', 'Logical'],
  ['GETPEM', 'oObjeto:objeto o nombre de clase|cMiembro:propiedad o método', 'Valor de una propiedad o código de un método.'],
  ['COMPOBJ', 'oObjeto1:primer objeto|oObjeto2:segundo objeto', '.T. si las propiedades de ambos coinciden.', 'Logical'],
  ['CREATEOBJECT', 'cClase:nombre de la clase|eParametro?:parámetros para Init', 'Crea un objeto de una clase cargada (SET PROCEDURE / SET CLASSLIB).', 'Object'],
  ['NEWOBJECT', 'cClase:nombre de la clase|cLibreria?:archivo .prg/.vcx donde está|cAplicacion?:.app o .exe que la contiene|eParametro?:parámetros para Init', 'Crea un objeto indicando dónde está la clase.', 'Object'],
  // Varias
  ['EVALUATE', 'cExpresion:expresión como texto', 'Evalúa una expresión escrita como texto.'],
  ['EXECSCRIPT', 'cScript:código VFP a ejecutar|eParametro?:parámetros del script', 'Compila y ejecuta código en tiempo de ejecución.'],
  ['MESSAGEBOX', 'eMensaje:mensaje|nTipo?:botones + ícono + botón por defecto|cTitulo?:título de la ventana|nTiempo?:milisegundos hasta cerrarse solo', 'Muestra un mensaje y devuelve el botón elegido.', 'Number'],
  ['PCOUNT', '', 'Cantidad de parámetros que recibió el procedimiento actual.', 'Number'],
  ['GETENV', 'cVariable:nombre de la variable de entorno', 'Valor de una variable de entorno.', 'String'],
  ['SYS', 'nFuncion:número de función SYS|eParametro?:parámetros según la función', 'Funciones de sistema (por ejemplo SYS(2015) genera un nombre único).'],
];

interface NativeFunction {
  name: string;
  params: { name: string; text: string; optional: boolean }[];
  description: string;
  returns?: string;
}

const CATALOG = new Map<string, NativeFunction>(
  ENTRIES.map(([name, params, description, returns]) => [
    name.toLowerCase(),
    {
      name,
      description,
      returns,
      params: params
        ? params.split('|').map((p) => {
            const idx = p.indexOf(':');
            const raw = p.substring(0, idx);
            return { name: raw.replace(/\?$/, ''), text: p.substring(idx + 1), optional: raw.endsWith('?') };
          })
        : [],
    },
  ]),
);

export function nativeFunctionCount(): number {
  return CATALOG.size;
}

/** Firma de una función nativa (solo si la llamada no tiene receptor). */
export function nativeSignature(callee: string, hasReceiver: boolean): SignatureInformation[] | undefined {
  if (hasReceiver) return undefined;
  const fn = CATALOG.get(callee.toLowerCase());
  if (!fn) return undefined;
  let label = `${fn.name}(`;
  const parameters = fn.params.map((p, i) => {
    label += i === 0 ? ' ' : ', ';
    const text = p.optional ? `[${p.name}]` : p.name;
    const start = label.length;
    label += text;
    return { label: [start, label.length] as [number, number], documentation: { kind: MarkupKind.Markdown, value: p.text } };
  });
  label += fn.params.length ? ' )' : ')';
  if (fn.returns) label += ` → ${fn.returns}`;
  return [{ label, parameters, documentation: { kind: MarkupKind.Markdown, value: `${fn.description}\n\n_Función nativa de VFP._` } }];
}
