define class ServiciosAplicacion as zooSession of zooSession.prg
	Mensajes = null
	Errores = null
	function Mensajes_Access() as Object
		if vartype( this.Mensajes ) != 'O'
			this.Mensajes = this.CrearObjetoServicios( "Mensajes" )
		endif
		return this.Mensajes
	endfunc
	function Errores_Access() as Object
		this.Errores = this.CrearObjetoServicios( "ManagerErrores" )
		return this.Errores
	endfunc
	Function CrearObjetoServicios( tcClase as String )
		return _screen.zoo.CrearObjetoPorProducto( tcClase )
	endfunc
	function Uno_Access()
		this.Uno = this.CrearObjetoServicios( "Mensajes" )
	endfunc
	function Dos_Access()
		this.Dos = this.CrearObjetoServicios( "Mensajes" )
	endfunc
	function Tres_Access()
		this.Tres = this.CrearObjetoServicios( "Mensajes" )
	endfunc
	function Cuatro_Access()
		this.Cuatro = this.CrearObjetoServicios( "Mensajes" )
	endfunc
enddefine
