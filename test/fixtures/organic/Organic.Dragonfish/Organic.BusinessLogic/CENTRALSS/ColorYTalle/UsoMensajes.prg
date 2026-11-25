define class UsoMensajes as Custom
	oMensajes = null
	oErrores = null
	function Init() as Void
		this.oMensajes = _Screen.Zoo.CrearObjeto( "Mensajes" )
		with this
			.oErrores = _Screen.Zoo.CrearObjeto( "ManagerErrores" )
		endwith
	endfunc
	function UsarErrores() as Void
		this.oErrores.Loguear( null )
	endfunc
	function Probar() as Void
		local loNada, loForm as UsoMensajes of UsoMensajes.prg
		this.oMensajes.Advertir( "x" )
		goServicios.Mensajes.Advertir( "x" )
		goMensajes.Advertir( "x" )
		loNada.Advertir( "x" )
		loForm.Probar()
		lnTotal = _screen.zoo.app.cProyecto
		this.Probar()
	endfunc
enddefine
