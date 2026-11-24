import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tools = process.argv.includes('--tools');

/**
 * El núcleo vive en el repo hermano Asistente-vfp y se empaqueta dentro del .vsix.
 * Sus dependencias se resuelven primero desde node_modules de este repo para no duplicarlas.
 */
const coreAlias = {
  'asistente-vfp-core': path.join(here, '..', 'Asistente-vfp', 'src', 'core', 'index.ts'),
};

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  alias: coreAlias,
  nodePaths: [path.join(here, 'node_modules')],
};

const builds = tools
  ? [{ ...common, entryPoints: ['src/tools/servicesTable.ts'], outfile: 'dist/tools/servicesTable.js' }]
  : [
      { ...common, entryPoints: ['src/client/extension.ts'], outfile: 'dist/client.js', external: ['vscode'] },
      { ...common, entryPoints: ['src/server/server.ts'], outfile: 'dist/server.js' },
      { ...common, entryPoints: ['src/mcp/server.ts'], outfile: 'dist/mcp.js' },
    ];

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context(b);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
