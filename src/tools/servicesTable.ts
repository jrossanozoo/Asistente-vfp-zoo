/**
 * Regenera src/zoo/organic/servicesTable.embedded.json desde las fuentes de Organic.Core.
 * Uso: npm run services-table -- [ruta a Organic.Core]   (por defecto ../../Organic.Core)
 */
import * as fs from 'fs';
import * as path from 'path';
import { parsePrg, pathToUri, readPrgSync } from 'asistente-vfp-core';
import { extractServices } from '../zoo/organic/servicesTable';

const coreRoot = process.argv[2] ?? path.resolve(__dirname, '..', '..', '..', '..', 'Organic.Core');
const base = path.join(coreRoot, 'Organic.BusinessLogic', 'CENTRALSS', 'Nucleo', '_Base');
const calls = ['crearobjetoservicios', 'crearobjetoporproducto', 'crearobjeto', 'iniciarservicio'];

function parse(file: string) {
  const p = path.join(base, file);
  return parsePrg(readPrgSync(p), pathToUri(p), { callNames: calls });
}

const table = extractServices(parse('serviciosaplicacion.PRG'), parse('aplicacionbase.prg'));
const out = path.resolve(__dirname, '..', '..', 'src', 'zoo', 'organic', 'servicesTable.embedded.json');
fs.writeFileSync(out, JSON.stringify({ source: 'embedded', services: table.services, globals: table.globals }, null, 2) + '\n');
console.log(`${table.services.length} servicios y ${table.globals.length} globales → ${out}`);
