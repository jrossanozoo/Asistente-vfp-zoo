define class CiclosDeTipo as Custom
	oA = null
	oB = null
	oX = null
	function Init() as Void
		this.oA = this.oB
		this.oB = this.oA
		this.oX = this.oX.Siguiente()
		with this
			.oA = .oA.Otro()
		endwith
	endfunc
	function MismaVariable() as Void
		local loX
		loX = _Screen.Zoo.CrearObjeto( "Mensajes" )
		loX = loX.Advertir( "x" )
		loX.Advertir( "y" )
	endfunc
	function Alternadas() as Void
		local loA, loB
		loA = loB
		loB = loA
		loA = loB
		loB.Advertir( "z" )
	endfunc
	function SinOrigen() as Void
		local loY
		loY = loY.Algo()
		loY.Algo()
	endfunc
	function UsarPropiedades() as Void
		this.oA.Advertir( "a" )
		this.oX.Advertir( "b" )
	endfunc
enddefine
