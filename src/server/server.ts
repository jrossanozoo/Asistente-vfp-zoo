import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startHost } from 'asistente-vfp-core';
import { createZooPlugin, REQUEST_PREFIX } from '../zoo/zooPlugin';

const connection = createConnection(ProposedFeatures.all);
const zoo = createZooPlugin();
startHost(connection, {
  plugins: [zoo.plugin],
  configSection: 'zoo',
  requestPrefix: REQUEST_PREFIX,
  diagnosticSource: 'Zoo VFP',
});
