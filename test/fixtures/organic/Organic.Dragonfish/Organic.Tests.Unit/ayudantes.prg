define class Mensajes as Custom
	function Advertir( tvMensaje ) as Void
	endfunc
enddefine
define class UsaMensajesEnTest as Custom
	function Init() as Void
		local loM as Mensajes
	endfunc
enddefine
