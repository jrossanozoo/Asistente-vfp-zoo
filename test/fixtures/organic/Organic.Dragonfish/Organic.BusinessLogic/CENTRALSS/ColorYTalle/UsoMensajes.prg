define class UsoMensajes as Custom
	oMensajes = null
	function Init() as Void
		this.oMensajes = _Screen.Zoo.CrearObjeto( "Mensajes" )
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
