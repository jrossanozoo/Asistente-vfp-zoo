define class Ent_Cliente as Din_EntidadCliente of Din_EntidadCliente.prg
	function ValidarCuit( tcCuit as String ) as Boolean
	endfunc
	function ValidacionBasica() as Boolean
		return dodefault()
	endfunc
enddefine
