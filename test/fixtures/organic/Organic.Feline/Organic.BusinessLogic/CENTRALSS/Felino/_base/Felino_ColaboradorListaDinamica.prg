define class Felino_ColaboradorListaDinamica as ColaboradorListaDinamica of ColaboradorListaDinamica.prg
	protected function ObtenerConcepto( tcClave as String ) as String
		return dodefault( tcClave )
	endfunc
enddefine
