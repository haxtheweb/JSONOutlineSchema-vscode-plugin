import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { HAXCMS_TOP_LEVEL_KEYS, validateOutline } from '../src/validator';

/**
 * Drift check against a checkout of haxtheweb/haxcms-nodejs, so the schema's
 * theme and license lists and the JOS111 key list keep up with HAXcms. Runs
 * only when HAXCMS_NODEJS_DIR points at that checkout (CI does a sparse
 * checkout of main); skipped otherwise so `npm test` works offline.
 */
const dir = process.env.HAXCMS_NODEJS_DIR;
const root = path.resolve(__dirname, '..', '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/json-outline-schema.json'), 'utf8'));
const read = (file: string) => fs.readFileSync(path.join(dir ?? '', file), 'utf8');

/** Quoted strings inside the array literal that follows `marker`. */
export function arrayAfter(source: string, marker: string): string[] {
    const start = source.indexOf(marker);
    if (start === -1) {
        return [];
    }
    const end = source.indexOf(']', start);
    const body = source.slice(start + marker.length, end);
    const out: string[] = [];
    for (const part of body.split(',')) {
        const s = part.trim();
        if (s.length > 1 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
            out.push(s.slice(1, -1));
        }
    }
    return out;
}

const missingFrom = (list: string[], wanted: string[]) => wanted.filter((v) => !list.includes(v));

suite('arrayAfter', () => {
    test('reads the quoted entries of an array literal', () => {
        const src = 'X.KEYS = Object.freeze([\n  "id",\n  \'title\',\n]);\nY = ["no"];';
        assert.deepStrictEqual(arrayAfter(src, 'X.KEYS = Object.freeze(['), ['id', 'title']);
    });
});

(dir ? suite : suite.skip)('haxcms-nodejs main', () => {
    test('every theme in themes.json is suggested', () => {
        const themes = Object.keys(JSON.parse(read('src/coreConfig/themes.json')));
        assert.ok(themes.length > 0);
        assert.deepStrictEqual(missingFrom(schema.definitions.theme.properties.element.examples, themes), []);
    });

    test('every license code is suggested', () => {
        const codes: string[] = JSON.parse(read('src/lib/licenses.json')).licenses.map((l: { code: string }) => l.code);
        assert.ok(codes.length > 0);
        assert.deepStrictEqual(missingFrom(schema.properties.license.examples, codes), []);
        assert.deepStrictEqual(
            missingFrom(schema.definitions.siteMetadata.properties.site.properties.license.examples, codes), []);
    });

    test('JOS111 keys match JSONOutlineSchema.TOP_LEVEL_KEYS', () => {
        const keys = arrayAfter(read('src/lib/JSONOutlineSchema.js'), 'JSONOutlineSchema.TOP_LEVEL_KEYS = Object.freeze([');
        assert.ok(keys.length > 0, 'TOP_LEVEL_KEYS not found');
        assert.deepStrictEqual([...keys, 'items'].sort(), [...HAXCMS_TOP_LEVEL_KEYS].sort());
    });

    test('boilerplate site.json is valid', () => {
        const text = read('src/boilerplate/site/site.json');
        const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
        assert.ok(validate(JSON.parse(text)), JSON.stringify(validate.errors, null, 2));
        assert.deepStrictEqual(validateOutline(text), []);
    });
});
