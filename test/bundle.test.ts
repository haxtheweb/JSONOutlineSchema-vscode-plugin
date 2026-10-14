import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Module = require('module');

/**
 * Loads the shipped bundle (dist/extension.js) against a stub `vscode`
 * module. Catches bundling mistakes (unresolvable requires, missing
 * runtime deps) that unit tests on the sources can't see.
 */
const bundle = path.resolve(__dirname, '..', '..', 'dist', 'extension.js');
const disposable = { dispose() { /* stub */ } };

function stubVscode() {
    const state = {
        commands: [] as string[],
        diagnostics: [] as { code: string; message: string }[],
        onOpen: undefined as undefined | ((doc: unknown) => void),
    };
    const api = {
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        Range: class { constructor(public start: unknown, public end: unknown) { } },
        Diagnostic: class { code?: string; constructor(public range: unknown, public message: string, public severity: number) { } },
        languages: {
            createDiagnosticCollection: () => ({
                set: (_uri: unknown, d: { code: string; message: string }[]) => { state.diagnostics = d; },
                delete() { /* stub */ },
                dispose() { /* stub */ },
            }),
            getDiagnostics: () => [],
            registerDocumentLinkProvider: () => disposable,
            registerDefinitionProvider: () => disposable,
            registerHoverProvider: () => disposable,
        },
        workspace: {
            textDocuments: [],
            getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
            onDidOpenTextDocument: (f: (doc: unknown) => void) => { state.onOpen = f; return disposable; },
            onDidChangeTextDocument: () => disposable,
            onDidCloseTextDocument: () => disposable,
            onDidSaveTextDocument: () => disposable,
            onDidChangeConfiguration: () => disposable,
            openTextDocument: async (o: unknown) => o,
        },
        window: { showInformationMessage() { /* stub */ }, showErrorMessage() { /* stub */ }, showWarningMessage() { /* stub */ } },
        commands: { registerCommand: (id: string) => { state.commands.push(id); return disposable; } },
    };
    return { api, state };
}

suite('bundled extension', () => {
    test('activates and reports diagnostics', async () => {
        const { api, state } = stubVscode();
        const load = (Module as unknown as { _load: (...a: unknown[]) => unknown });
        const original = load._load;
        load._load = function (request: unknown, ...rest: unknown[]) {
            return request === 'vscode' ? api : original.call(this, request, ...rest);
        };
        try {
            delete require.cache[bundle];
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const ext = require(bundle);
            ext.activate({ subscriptions: [] });
        } finally {
            load._load = original;
        }
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
        assert.deepStrictEqual(state.commands.sort(), pkg.contributes.commands.map((c: { command: string }) => c.command).sort());

        const text = JSON.stringify({ items: [
            { id: 'a', title: 'A', parent: null, indent: 0, order: 0 },
            { id: 'b', title: 'B', parent: 'a', indent: 0, order: 0 },
        ] });
        assert.ok(state.onOpen);
        state.onOpen({
            fileName: '/ws/site.json',
            uri: { scheme: 'untitled', toString: () => 'untitled:/ws/site.json' },
            getText: () => text,
            positionAt: (o: number) => o,
        });
        assert.deepStrictEqual(state.diagnostics.map((d) => d.code), ['JOS104']);
    });
});
