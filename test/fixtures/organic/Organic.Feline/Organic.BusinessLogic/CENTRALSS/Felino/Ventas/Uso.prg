define class UsoFeline as Custom
	function Probar() as Void
		local loEnt
		loEnt = _screen.zoo.InstanciarEntidad( "Valor" )
		loEnt.ObtenerCotizacion()
		loComp = _screen.zoo.InstanciarComponente( "ComponenteCajero" )
	endfunc
enddefine
