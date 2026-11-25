define class AplicacionBase as ZooSession of ZooSession.prg
	cProyecto = ''
	oMensajes = null
	oLibrerias = null
	function IniciarServiciosSinDependencia() as Void
		with this
			.IniciarServicio( "ManagerFormularios", "oFormularios", "goFormularios", ,"Formularios" )
		endwith
		public goMensajes
		this.oMensajes = goServicios.Mensajes
		goMensajes = this.oMensajes
	endfunc
	protected function CrearGoLibrerias() as Void
		public goLibrerias
		this.oLibrerias = goServicios.Librerias
		goLibrerias = this.oLibrerias
	endfunc
enddefine
