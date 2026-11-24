define class ComboListaDinamica as ComboServicio of ComboServicio.prg

	#if .f.
		local this as ComboListaDinamica of ComboListaDinamica.prg
	#endif

	&& Dominio COMBOLISTADINAMICA: combo cuyas opciones salen de una coleccion armada por
	&& ColaboradorListaDinamica (resuelto por producto) segun Entidad + Atributo.
	&& En la generacion los valores no quedan fijos en el formulario (ver AntesDeSerializar);
	&& el formulario generado los carga en runtime con .ROWSOURCE = .ObtenerLista(...) (ver DespuesDeSerializar).
	&& El colaborador se puede inyectar (InyectarColaborador); si no, lo crea ObtenerColaborador().

	oColaborador = null
	protected lColaboradorPropio
	lColaboradorPropio = .f.

	*-----------------------------------------------------------------------------------------
	function InyectarColaborador( toColaborador as ColaboradorListaDinamica of ColaboradorListaDinamica.prg ) as Void
		&& El combo no libera un colaborador inyectado: lo libera quien lo creo (puede compartirse entre combos).
		this.LiberarColaborador()
		this.oColaborador = toColaborador
	endfunc

	*-----------------------------------------------------------------------------------------
	NOTE	[Dependencia] Devuelve el colaborador que arma las opciones del combo. ;
			Unico punto que conoce la clase concreta: si no se inyecto una, la crea por producto ;
			( <Proyecto>_ColaboradorListaDinamica ) y la guarda para los siguientes usos. ;
			Quien la pide NO la libera: la libera Destroy, y solo si la creo el combo. ;
			Retorna: ColaboradorListaDinamica - el inyectado o, si no hay, el creado por el combo.
	protected function ObtenerColaborador() as ColaboradorListaDinamica of ColaboradorListaDinamica.prg
		if vartype( this.oColaborador ) # "O"
			this.oColaborador = _Screen.zoo.CrearObjetoPorProducto( "ColaboradorListaDinamica", "ColaboradorListaDinamica.prg" )
			this.lColaboradorPropio = .t.
		endif
		return this.oColaborador
	endfunc

	*-----------------------------------------------------------------------------------------
	protected function LiberarColaborador() as Void
		if this.lColaboradorPropio and vartype( this.oColaborador ) == "O"
			this.oColaborador.Release()
		endif
		this.oColaborador = null
		this.lColaboradorPropio = .f.
	endfunc

	*-----------------------------------------------------------------------------------------
	NOTE	[Generacion] Devuelve las opciones del combo listas para asignar a RowSource. ;
			Lo llama el formulario generado (ver DespuesDeSerializar). ;
			Parametros: ;
				tcEntidad - Entidad del combo (con o sin el prefijo ADT_). ;
				tcAtributo - Atributo de la entidad. ;
			Retorna: String - etiqueta,valor,... sin coma final; "" si la clave no tiene definicion.
	function ObtenerLista( tcEntidad as String, tcAtributo as String ) as String
		local lcRetorno as String, loColaborador as ColaboradorListaDinamica of ColaboradorListaDinamica.prg, ;
			loColeccion as zoocoleccion OF zoocoleccion.prg, loItem as ItemOpcionListaDinamica of ColaboradorListaDinamica.prg

		loColaborador = this.ObtenerColaborador()
		loColeccion = loColaborador.ObtenerColeccion( tcEntidad, tcAtributo, this.lEstoyEnUnListado )

		lcRetorno = ""
		for each loItem in loColeccion foxobject
			lcRetorno = lcRetorno + loItem.cEtiqueta + ',' + transform( loItem.xValor ) + ','
		endfor

		return left( lcRetorno, len( lcRetorno ) - 1 )
	endfunc

	*-----------------------------------------------------------------------------------------
	NOTE	[Generacion] Carga cValores y xValorDefault con las opciones que arma el colaborador. ;
			Solo en un listado (lEstoyEnUnListado): ahi las usa Armar() via ObtenerValoresCombo. ;
			Fuera de un listado los deja vacios, porque el formulario generado carga las opciones ;
			con ObtenerLista() en runtime (ver DespuesDeSerializar). ;
			xValorDefault toma el valor del item marcado con lDefault o, si no hay ninguno, el del primero.
	function ObtenerDatos() as Void
		local loColeccion as zoocoleccion OF zoocoleccion.prg, loItem as ItemOpcionListaDinamica of ColaboradorListaDinamica.prg, ;
			lcCursor as String, lnArea as Integer, llHayDefault as Boolean, loError as Exception

		this.cValores = ""
		this.xValorDefault = ""
		if this.lEstoyEnUnListado
			lnArea = select()
			lcCursor = "ComboListaDinamica" + sys( 2015 )
			try
				loColeccion = this.ObtenerColeccion()

				if this.CrearCursorDesdeColeccion( lcCursor, loColeccion ) > 0
					select ( lcCursor )
					scan
						loItem = loColeccion.Item[ nItem ]
						if !llHayDefault and ( lDefault or recno() = 1 )
							this.xValorDefault = loItem.xValor
							llHayDefault = lDefault
						endif
						this.cValores = this.cValores + loItem.cEtiqueta + ',' + transform( loItem.xValor ) + ','
					endscan
					this.cValores = substr( this.cValores, 1, len( this.cValores ) - 1 )
				endif

			catch to loError
				goServicios.Errores.LevantarExcepcion( loError )
			finally
				use in select( lcCursor )
				select ( lnArea )
			endtry
		endif
	endfunc

	*-----------------------------------------------------------------------------------------
	protected function ObtenerColeccion() as zoocoleccion OF zoocoleccion.prg
		local loColaborador as ColaboradorListaDinamica of ColaboradorListaDinamica.prg

		loColaborador = this.ObtenerColaborador()
		return loColaborador.ObtenerColeccion( this.cEntidad, this.ObtenerNombreDeAtributo(), this.lEstoyEnUnListado )
	endfunc

	*-----------------------------------------------------------------------------------------
	protected function CrearCursorDesdeColeccion( tcCursor as String, toColeccion as zoocoleccion OF zoocoleccion.prg ) as Integer
		local lnI as Integer, loItem as ItemOpcionListaDinamica of ColaboradorListaDinamica.prg

		&& El cursor referencia al item (nItem) para no alterar el tipo ni el ancho del valor de retorno.
		create cursor ( tcCursor ) ( nItem I, cEtiqueta C(254), lDefault L )
		for lnI = 1 to toColeccion.Count
			loItem = toColeccion.Item[ lnI ]
			insert into ( tcCursor ) ( nItem, cEtiqueta, lDefault ) values ( lnI, loItem.cEtiqueta, loItem.lDefault )
		endfor

		this.FiltrarCursor( tcCursor )
		return reccount( tcCursor )
	endfunc

	*-----------------------------------------------------------------------------------------
	function AntesDeSerializar() as String
		local lcVacio as String, lcTipoDato as String

		&& Solo en la generacion: el formulario generado no lleva las opciones, las carga ObtenerLista().
		lcTipoDato = upper( alltrim( this.cTipoDato ) )
		do case
		case lcTipoDato == "N"
			lcVacio = ",0"
		case lcTipoDato == "L"
			lcVacio = ",.F."
		otherwise
			lcVacio = ","
		endcase
		this.cValores = lcVacio
		this.RowSource = lcVacio

		return ""
	endfunc

	*-----------------------------------------------------------------------------------------
	NOTE	[Generacion] Devuelve las lineas que el generador agrega al formulario para este combo. ;
			Reemplaza el .CompletarCombo() que emite zooComboBox. Las arma el colaborador del producto ;
			con ObtenerPropiedadesSerializadas: la carga de opciones con ObtenerLista() y las ;
			propiedades propias de cada producto (Sorted, IncrementalSearch, etc.). ;
			Retorna: String - una sentencia por linea, con 8 tabs al principio y separadas por CRLF.
	function DespuesDeSerializar() as String
		local lcSentencia as String, loColaborador as Object
		loColaborador = this.ObtenerColaborador()
		lcSentencia = loColaborador.ObtenerPropiedadesSerializadas( this.cEntidad, this.ObtenerNombreDeAtributo(), this.lEstoyEnUnListado )
		return lcSentencia
	endfunc

	*-----------------------------------------------------------------------------------------
	function CompletarCombo() as Void
		this.Armar()
	endfunc

	*-----------------------------------------------------------------------------------------
	function Destroy() as Void
		this.LiberarColaborador()
		dodefault()
	endfunc

enddefine
