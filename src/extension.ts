import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Finding } from './jsonUtil';
import { validateOutline } from './validator';
import { analyze, declarationOf, describe, locationLinks, referencedId, tree } from './navigation';

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
};

/** Same files the schema is attached to in package.json (jsonValidation). */
export function isOutlineFile(fileName: string): boolean {
    const base = path.basename(fileName);
    return base === 'site.json' || base.endsWith('.jos.json');
}

const selector: vscode.DocumentSelector = [
    { language: 'json', pattern: '**/site.json' },
    { language: 'json', pattern: '**/*.jos.json' },
];

const span = (doc: vscode.TextDocument, s: { offset: number; length: number }) =>
    new vscode.Range(doc.positionAt(s.offset), doc.positionAt(s.offset + s.length));

/** Check locations only for outlines that have their pages next to them. */
function locationChecker(doc: vscode.TextDocument): ((location: string) => boolean) | undefined {
    if (doc.uri.scheme !== 'file') {
        return undefined;
    }
    const mode = vscode.workspace.getConfiguration('jsonOutlineSchema', doc.uri).get<string>('checkLocations', 'auto');
    const dir = path.dirname(doc.uri.fsPath);
    if (mode === 'never' || (mode === 'auto' && !fs.existsSync(path.join(dir, 'pages')))) {
        return undefined;
    }
    return (location) => fs.existsSync(path.join(dir, location.split(/[?#]/)[0]));
}

export function activate(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection('json-outline-schema');
    const timers = new Map<string, NodeJS.Timeout>();

    const run = (doc: vscode.TextDocument) => {
        if (!isOutlineFile(doc.fileName)) {
            return;
        }
        if (!vscode.workspace.getConfiguration('jsonOutlineSchema', doc.uri).get<boolean>('semanticValidation', true)) {
            collection.delete(doc.uri);
            return;
        }
        const findings = validateOutline(doc.getText(), { locationExists: locationChecker(doc) });
        collection.set(doc.uri, findings.map((f) => {
            const d = new vscode.Diagnostic(span(doc, f), f.message, SEVERITY[f.severity]);
            d.source = 'JSON Outline Schema';
            d.code = f.code;
            return d;
        }));
    };
    const schedule = (doc: vscode.TextDocument) => {
        const key = doc.uri.toString();
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            run(doc);
        }, 300));
    };

    context.subscriptions.push(
        collection,
        vscode.workspace.onDidOpenTextDocument(run),
        vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
        vscode.workspace.onDidSaveTextDocument(run),
        vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('jsonOutlineSchema')) {
                vscode.workspace.textDocuments.forEach(run);
            }
        }),

        // "location": "pages/x/index.html" opens the page
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(doc) {
                const a = analyze(doc.getText());
                if (!a || doc.uri.scheme === 'untitled') {
                    return [];
                }
                const dir = vscode.Uri.joinPath(doc.uri, '..');
                return locationLinks(a)
                    .filter((l) => !/^[a-z]+:\/\//i.test(l.location))
                    .map((l) => {
                        const link = new vscode.DocumentLink(span(doc, l), vscode.Uri.joinPath(dir, l.location.split(/[?#]/)[0]));
                        link.tooltip = 'Open page';
                        return link;
                    });
            },
        }),

        // parent / relatedItems / regions / homePageId jump to the item
        vscode.languages.registerDefinitionProvider(selector, {
            provideDefinition(doc, position) {
                const a = analyze(doc.getText());
                const ref = a && referencedId(a, doc.offsetAt(position));
                const decl = a && ref && !ref.isDeclaration ? declarationOf(a, ref.id) : undefined;
                return decl ? new vscode.Location(doc.uri, span(doc, decl)) : undefined;
            },
        }),

        // ...and say which item an id is
        vscode.languages.registerHoverProvider(selector, {
            provideHover(doc, position) {
                const a = analyze(doc.getText());
                const ref = a && referencedId(a, doc.offsetAt(position));
                if (!a || !ref || ref.isDeclaration) {
                    return undefined;
                }
                const item = a.outline.byId.get(ref.id);
                if (!item) {
                    return undefined;
                }
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**${item.title.replace(/[\\`*_[\]]/g, '\\$&')}**`);
                const info = describe(item);
                if (info) {
                    md.appendMarkdown(`\n\n${info.replace(/[\\`*_[\]]/g, '\\$&')}`);
                }
                return new vscode.Hover(md, span(doc, ref.span));
            },
        }),

        vscode.commands.registerCommand('jsonOutlineSchema.goToItem', async () => {
            const editor = vscode.window.activeTextEditor;
            const doc = editor?.document;
            const a = doc && isOutlineFile(doc.fileName) ? analyze(doc.getText()) : undefined;
            if (!editor || !doc || !a) {
                vscode.window.showErrorMessage('Open a valid site.json (JSON Outline Schema) first.');
                return;
            }
            const picks = tree(a.outline).map(({ item, depth }) => ({
                label: `${' '.repeat(depth)}${item.title}`,
                description: describe(item),
                id: item.id,
            }));
            const pick = await vscode.window.showQuickPick(picks, {
                placeHolder: 'Go to item',
                matchOnDescription: true,
            });
            const decl = pick && declarationOf(a, pick.id);
            if (decl) {
                const range = span(doc, decl);
                editor.selection = new vscode.Selection(range.start, range.end);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
        }),

        vscode.commands.registerCommand('jsonOutlineSchema.validateFile', () => {
            const doc = vscode.window.activeTextEditor?.document;
            if (!doc || !isOutlineFile(doc.fileName)) {
                vscode.window.showErrorMessage('Open a site.json or *.jos.json file first.');
                return;
            }
            run(doc);
            const count = vscode.languages.getDiagnostics(doc.uri).length;
            vscode.window.showInformationMessage(count === 0
                ? 'JSON Outline Schema: no problems found.'
                : `JSON Outline Schema: ${count} problem(s) — see the Problems panel.`);
        }),
    );

    vscode.workspace.textDocuments.forEach(run);
}

export function deactivate(): void {
    // nothing beyond context.subscriptions
}
