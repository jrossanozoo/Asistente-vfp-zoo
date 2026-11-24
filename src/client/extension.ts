import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

const PREFIX = 'asistenteVfpZoo';
let client: LanguageClient | undefined;

const CONFLICTING_EXTENSIONS: { id: string; message: string }[] = [
  {
    id: 'zoo-logic.vsc-f12-vfp',
    message: 'Zoo VFP: "vsc-f12-vfp" está instalada y toma la tecla F12. Conviene desinstalarla: Zoo VFP ya provee Go to Definition.',
  },
  {
    id: 'local.asistente-vfp',
    message: 'Zoo VFP: también está instalada "Asistente VFP" (genérica). Esta extensión ya la incluye: desactivá la genérica para no ver resultados duplicados.',
  },
];

interface ProductsInfo {
  product: string;
  configured: string | null;
  products: string[];
  solutions: { folder: string; projectName?: string; apps: { name: string; sourceRoot?: string; symbolsPath?: string; stubsDir?: string }[] }[];
  services: string;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6010'] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'foxpro' },
      { scheme: 'foxpro-vcx', language: 'foxpro' },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{prg,PRG,Prg}'),
    },
    initializationOptions: {
      storagePath: context.storageUri?.fsPath ?? context.globalStorageUri.fsPath,
    },
  };
  client = new LanguageClient(PREFIX, 'Zoo VFP', serverOptions, clientOptions);

  // Vista de solo lectura de clases VCX.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('foxpro-vcx', {
      provideTextDocumentContent: async (uri) => {
        const text = await client?.sendRequest<string | null>(`${PREFIX}/vcxContent`, { uri: uri.toString() });
        return text ?? `* No se pudo leer la clase ${uri.path}`;
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${PREFIX}.reindex`, async () => {
      if (!client) return;
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Zoo VFP: reindexando' },
        () => client!.sendRequest<{ files: number }>(`${PREFIX}/reindex`),
      );
      vscode.window.showInformationMessage(`Zoo VFP: ${result.files} archivos indexados.`);
    }),

    vscode.commands.registerCommand(`${PREFIX}.selectProduct`, async () => {
      if (!client) return;
      const info = await client.sendRequest<ProductsInfo>(`${PREFIX}/products`);
      const items: (vscode.QuickPickItem & { value: string | null })[] = [
        { label: '$(search) Detectar automáticamente', description: `actual: "${info.product}"`, value: null },
        ...info.products.map((p) => ({ label: p === '' ? '"" (Core / Drawing / Generator)' : p, value: p, picked: p === info.product })),
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Producto activo (cProyecto)' });
      if (!pick) return;
      await vscode.workspace.getConfiguration('zoo').update('producto', pick.value, vscode.ConfigurationTarget.Workspace);
    }),

    vscode.commands.registerCommand(`${PREFIX}.status`, async () => {
      if (!client) return;
      const [status, info] = await Promise.all([
        client.sendRequest<{ files: number; classes: number; roots: { path: string; layer: string; role: string }[] }>(`${PREFIX}/status`),
        client.sendRequest<ProductsInfo>(`${PREFIX}/products`),
      ]);
      const out = client.outputChannel;
      out.appendLine('--- Zoo VFP: estado ---');
      out.appendLine(`Producto activo: "${info.product}"${info.configured === null ? ' (detectado)' : ' (configurado)'}`);
      out.appendLine(`Archivos: ${status.files} · Clases: ${status.classes} · Tabla de servicios: ${info.services}`);
      for (const s of info.solutions) {
        out.appendLine(`Solución ${s.projectName ?? s.folder}`);
        for (const a of s.apps) {
          out.appendLine(`  ${a.name}: fuente=${a.sourceRoot ?? '—'} · symbols=${a.symbolsPath ?? '—'} · stubs=${a.stubsDir ?? '—'}`);
        }
      }
      for (const r of status.roots) out.appendLine(`  raíz [${r.layer}${r.role === 'downstream' ? ', consumidor' : ''}] ${r.path}`);
      out.show(true);
    }),

    vscode.commands.registerCommand(`${PREFIX}.showLocations`, async (uri: string, position: { line: number; character: number }, locations: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[]) => {
      const conv = (p: { line: number; character: number }) => new vscode.Position(p.line, p.character);
      await vscode.commands.executeCommand(
        'editor.action.showReferences',
        vscode.Uri.parse(uri),
        conv(position),
        locations.map((l) => new vscode.Location(vscode.Uri.parse(l.uri), new vscode.Range(conv(l.range.start), conv(l.range.end)))),
      );
    }),

    vscode.commands.registerCommand(`${PREFIX}.mcpConfig`, async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
      const mcp = context.asAbsolutePath(path.join('dist', 'mcp.js'));
      const json = JSON.stringify({ mcpServers: { organic: { command: 'node', args: [mcp, '--root', folder] } } }, null, 2);
      await vscode.env.clipboard.writeText(json);
      vscode.window.showInformationMessage('Zoo VFP: configuración del servidor MCP copiada al portapapeles.');
    }),
  );

  for (const c of CONFLICTING_EXTENSIONS) {
    if (vscode.extensions.getExtension(c.id)) void vscode.window.showWarningMessage(c.message);
  }

  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
