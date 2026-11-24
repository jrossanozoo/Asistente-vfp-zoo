define class AplicacionBase as ZooSession of ZooSession.prg
	cProyecto = ''
	function IniciarServiciosSinDependencia() as Void
		with this
			.IniciarServicio( "ManagerFormularios", "oFormularios", "goFormularios", ,"Formularios" )
		endwith
	endfunc
enddefine
