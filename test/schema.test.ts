import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { globSync } from 'glob';
import { getLanguageService, TextDocument } from 'vscode-json-languageservice';

/**
 * Checks the schema against real HAXcms site.json files (test/fixtures,
 * from haxtheweb/webcomponents), with ajv and with
 * vscode-json-languageservice — the engine behind VS Code's JSON support —
 * wired up from package.json the way VS Code does it.
 */
const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const schemaPath = pkg.contributes.jsonValidation[0].url as string;
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(read(schemaPath)));

const ls = getLanguageService({ schemaRequestService: async (uri) => read(uri.replace('ext://jos/', '')) });
ls.configure({
    validate: true,
    schemas: pkg.contributes.jsonValidation.map((v: { fileMatch: string | string[]; url: string }) => ({
        uri: `ext://jos/${v.url.replace(/^\.\//, '')}`,
        fileMatch: Array.isArray(v.fileMatch) ? v.fileMatch : [v.fileMatch],
    })),
});
const doc = (uri: string, text: string) => TextDocument.create(uri, 'json', 1, text);
const diagnose = async (uri: string, text: string) => {
    const d = doc(uri, text);
    return ls.doValidation(d, ls.parseJSONDocument(d));
};

const files = [...globSync('test/fixtures/*.json', { cwd: root }), 'examples/site.json'];

suite('json-outline-schema.json', () => {
    for (const file of files) {
        test(`ajv accepts ${file}`, () => {
            assert.ok(validate(JSON.parse(read(file))), JSON.stringify(validate.errors, null, 2));
        });
        test(`VS Code accepts ${file}`, async () => {
            const diags = await diagnose(`file:///ws/${path.basename(file).replace(/^.*\.site\.json$/, 'site.json')}`, read(file));
            assert.deepStrictEqual(diags.map((d) => d.message), []);
        });
    }

    test('the empty HAXcms boilerplate is valid', () => {
        assert.ok(validate({ id: '', title: 'New site', author: '', description: '', license: 'by-sa', metadata: {}, items: [] }));
    });

    const reject = (name: string, value: unknown, where: string) => test(name, () => {
        assert.ok(!validate(value));
        assert.ok(validate.errors?.some((e) => e.instancePath === where), JSON.stringify(validate.errors, null, 2));
    });
    reject('item needs an id', { items: [{ title: 'x' }] }, '/items/0');
    reject('order must be an integer', { items: [{ id: 'a', title: 'a', order: 'first' }] }, '/items/0/order');
    reject('published must be boolean-ish', { items: [{ id: 'a', title: 'a', metadata: { published: 'yes' } }] }, '/items/0/metadata/published');
    reject('regions hold id lists', { metadata: { theme: { regions: { header: 'item-a' } } } }, '/metadata/theme/regions/header');
    reject('hexCode is a color', { metadata: { theme: { variables: { hexCode: 'blue' } } } }, '/metadata/theme/variables/hexCode');

    test('applies to site.json and *.jos.json only', async () => {
        const bad = '{ "items": [ { "title": 3 } ] }';
        assert.ok((await diagnose('file:///ws/site.json', bad)).length > 0);
        assert.ok((await diagnose('file:///ws/course.jos.json', bad)).length > 0);
        assert.strictEqual((await diagnose('file:///ws/package.json', bad)).length, 0);
    });

    test('item snippet is offered inside items', async () => {
        const text = '{ "items": [  ] }';
        const d = doc('file:///ws/site.json', text);
        const list = await ls.doComplete(d, d.positionAt(text.indexOf('[') + 2), ls.parseJSONDocument(d));
        assert.ok(list?.items.some((i) => i.label === 'New item'), list?.items.map((i) => i.label).join(', '));
    });

    test('theme element suggestions', async () => {
        const text = '{ "metadata": { "theme": { "element":  } } }';
        const d = doc('file:///ws/site.json', text);
        const list = await ls.doComplete(d, d.positionAt(text.indexOf('"element":') + 11), ls.parseJSONDocument(d));
        assert.ok(list?.items.some((i) => i.label === '"clean-one"'), list?.items.map((i) => i.label).join(', '));
    });
});

suite('manifest', () => {
    test('every command is registered', () => {
        const src = read('src/extension.ts');
        for (const c of pkg.contributes.commands) {
            assert.ok(src.includes(`'${c.command}'`), c.command);
        }
    });
});
