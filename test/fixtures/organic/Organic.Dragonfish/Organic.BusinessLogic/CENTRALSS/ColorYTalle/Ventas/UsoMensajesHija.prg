define class UsoMensajesHija as UsoMensajes of UsoMensajes.prg
	function Otra() as Void
		this.oMensajes.Advertir( "y" )
	endfunc
enddefine
