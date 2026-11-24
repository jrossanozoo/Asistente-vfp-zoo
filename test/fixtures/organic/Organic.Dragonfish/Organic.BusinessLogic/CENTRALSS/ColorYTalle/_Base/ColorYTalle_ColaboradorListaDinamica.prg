define class ColorYTalle_ColaboradorListaDinamica as Felino_ColaboradorListaDinamica of Felino_ColaboradorListaDinamica.prg
	protected function ObtenerConcepto( tcClave as String ) as String
		return dodefault( tcClave )
	endfunc
enddefine
