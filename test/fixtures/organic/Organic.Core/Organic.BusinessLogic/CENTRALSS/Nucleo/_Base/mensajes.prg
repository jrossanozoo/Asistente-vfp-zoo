define class Mensajes as ZooSession of ZooSession.prg
	*-----------------------------------------------------------------------------------------
	NOTE	[Contrato] Muestra una advertencia al usuario. ;
			Parametros: ;
				tvMensaje - Texto o coleccion de mensajes. ;
				tnBotones - Botones del dialogo. ;
			Retorna: Number - boton elegido.
	function Advertir( tvMensaje as Variant, tnBotones as Integer ) as Number
	endfunc
enddefine
