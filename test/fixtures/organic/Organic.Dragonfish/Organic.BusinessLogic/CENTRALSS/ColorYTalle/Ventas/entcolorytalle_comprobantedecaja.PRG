define class EntColorYTalle_ComprobanteDeCaja as Custom
	function Procesar() as Void
		local loColaborador
		loColaborador = _screen.zoo.CrearObjeto( "ColaboradorCheques" )
	endfunc
enddefine
