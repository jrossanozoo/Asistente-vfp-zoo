define class UsoDragonfish as ComboListaDinamica of NoEsElArchivo.prg

	*-----------------------------------------------------------------------------------------
	NOTE	Sin categoria. ;
			Parametros: ;
				tcUno - Primero. ;
				tcSobra - No esta en la firma.
	function ConNote( tcUno as String, tnDos as Number ) as String
		local loEnt, loCombo as ComboListaDinamica of ComboListaDinamica.prg
		loEnt = _screen.zoo.InstanciarEntidad( "Cliente" )
		loEnt.ValidarCuit( "20" )
		goServicios.Mensajes.Advertir( "hola", 0 )
		goServicios.Errores.Loguear( null )
		goFormularios.Mostrar( "x" )
		_screen.zoo.InstanciarEntidad( "NoExiste" )
		_screen.zoo.InstanciarEntidad( "Cli" )
		lcX = STRTRAN( lcX, "a",  )
		loCombo.ObtenerLista( "C", "A" )
	endfunc

	function SinNote( tcA as String ) as String
	endfunc
enddefine
