define class MensajesHijo as Mensajes of Mensajes.prg
	function Advertir( tvMensaje as Variant, tnBotones as Integer ) as Number
		return dodefault( tvMensaje, tnBotones )
	endfunc
enddefine
