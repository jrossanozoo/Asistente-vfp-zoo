Define Class Zoo As ZooSession Of ZooSession.prg
	*-----------------------------------------------------------------------------------------
	NOTE	[Dependencia] Instancia una entidad resolviendo la clase por producto. ;
			Parametros: ;
				tcEntidad - Nombre de la entidad (sin prefijo). ;
			Retorna: Object - la entidad.
	function InstanciarEntidad( tcEntidad as String ) as Object
	endfunc
	function InstanciarComponente( tcComponente as String ) as Object
	endfunc
	function CrearObjetoPorProducto( tcClase as String, tcLib as String ) as Object
	endfunc
enddefine
