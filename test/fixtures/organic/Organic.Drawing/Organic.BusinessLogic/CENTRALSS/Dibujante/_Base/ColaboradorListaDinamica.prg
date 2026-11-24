define class ColaboradorListaDinamica as ZooSession of ZooSession.prg

	#if .f.
		local this as ColaboradorListaDinamica of ColaboradorListaDinamica.prg
	#endif

	&& Catalogo de opciones de los combos del dominio COMBOLISTADINAMICA.
	&& Cada producto lo extiende ( <Proyecto>_ColaboradorListaDinamica, via CrearObjetoPorProducto ) implementando
	&& ObtenerConcepto y ObtenerColeccionConcepto, y cayendo con dodefault() a su padre en el otherwise.
	&& Varias claves Entidad.Atributo pueden compartir un mismo concepto, y por lo tanto una misma coleccion.
	&& La base define las claves de las entidades del ADN de Drawing (presentes en todos los productos).
	&& Si no hay definicion para la clave se devuelve una coleccion vacia (no se levantan excepciones).

	*-----------------------------------------------------------------------------------------
	function ObtenerColeccion( tcEntidad as String, tcAtributo as String, tlListado as Boolean ) as zoocoleccion OF zoocoleccion.prg
		local lcConcepto as String, loRetorno as zoocoleccion OF zoocoleccion.prg

		lcConcepto = this.ObtenerConcepto( this.ObtenerClave( tcEntidad, tcAtributo ) )
		loRetorno = null

		if !empty( lcConcepto )
			if tlListado
				loRetorno = this.ObtenerColeccionConcepto( lcConcepto + "FILTRO" )
			endif
			if isnull( loRetorno ) or loRetorno.Count = 0
				loRetorno = this.ObtenerColeccionConcepto( lcConcepto )
			endif
		endif

		if isnull( loRetorno )
			loRetorno = this.CrearLista()
		endif

		return loRetorno
	endfunc

	*-----------------------------------------------------------------------------------------
	function ExisteDefinicion( tcEntidad as String, tcAtributo as String ) as Boolean
		return !empty( this.ObtenerConcepto( this.ObtenerClave( tcEntidad, tcAtributo ) ) )
	endfunc

	*-----------------------------------------------------------------------------------------
	protected function ObtenerClave( tcEntidad as String, tcAtributo as String ) as String
		local lcEntidad as String
		lcEntidad = upper( alltrim( tcEntidad ) )
		if ( left( lcEntidad, 4 ) == "ADT_" )
			&& Compatibilidad con los listados de las entidades de auditoria (mismo criterio que ComboXML).
			lcEntidad = strtran( lcEntidad, "ADT_", "" )
		endif
		return lcEntidad + "." + upper( alltrim( tcAtributo ) )
	endfunc

	*-----------------------------------------------------------------------------------------
	protected function ObtenerConcepto( tcClave as String ) as String
		&& Clave = ENTIDAD.ATRIBUTO. Cada producto agrega las suyas y cae aca con dodefault().
		local lcRetorno as String
		do case
		case tcClave == "DISENOEXPO.CATEGORIA"
			lcRetorno = "DISENOEXPOCATEGORIA"
		case inlist( tcClave, "DISENOIMPRESION.CONFIRMAPDF", ;
						"DISENOIMPRESION.SUGIERE" )
			lcRetorno = "PREGUNTARSUGIERE"
		case tcClave == "DISENOIMPRESION.OPCIONDESALIDA"
			lcRetorno = "DISENOIMPRESIONOPCIONDESALIDA"
		case tcClave == "EXPOAGRUPADAS.CATEGORIA"
			lcRetorno = "EXPOAGRUPADASCATEGORIA"
		case tcClave == "ITEMACCIONESAUTOMATICAS.ACCION"
			lcRetorno = "ITEMACCIONESAUTOMATICASACCION"
		case tcClave == "ITEMACCIONESAUTOMATICAS.METODO"
			lcRetorno = "ITEMACCIONESAUTOMATICASMETODO"
		case tcClave == "ITEMATRIBUTOSIMPRESION.FUNCIONAGRUPAR"
			lcRetorno = "ITEMATRIBUTOSIMPRESIONFUNCIONAGRUPAR"
		case tcClave == "ITEMATRIBUTOSIMPRESION.ORIENTACION"
			lcRetorno = "ITEMATRIBUTOSIMPRESIONORIENTACION"
		case tcClave == "ITEMATRIBUTOSIMPRESION.TIPOORDENAMIENTO"
			lcRetorno = "ITEMATRIBUTOSIMPRESIONTIPOORDENAMIENTO"
		case tcClave == "REGISTRODEMANTENIMIENTO.TIPO"
			lcRetorno = "REGISTRODEMANTENIMIENTOTIPO"
		case tcClave == "TALONARIO.ASIGNACION"
			lcRetorno = "TALONARIOASIGNACION"
		otherwise
			lcRetorno = ""
		endcase
		return lcRetorno
	endfunc
enddefine

define class ItemOpcionListaDinamica as ItemValorEtiqueta of ZooComboBox.prg
	lDefault = .F.
enddefine
