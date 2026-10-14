import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CODES, validateOutline } from '../src/validator';

const root = path.resolve(__dirname, '..', '..');
const fixture = (name: string) => fs.readFileSync(path.join(root, 'test', 'fixtures', name), 'utf8');

type Item = Record<string, unknown>;
const item = (id: string, extra: Item = {}): Item => ({
    id, title: id, slug: id, location: `pages/${id}/index.html`, parent: null, order: 0, indent: 0, metadata: {}, ...extra,
});
const outline = (items: Item[], metadata: Item = {}) => JSON.stringify({ id: 's', title: 'S', metadata, items }, null, 2);
const codes = (text: string, opts = {}) => validateOutline(text, opts).map((f) => f.code);

suite('outline validation', () => {
    test('valid tree', () => {
        assert.deepStrictEqual(codes(outline([
            item('a'),
            item('b', { parent: 'a', indent: 1 }),
            item('c', { parent: 'b', indent: '2', order: '0' }),
            item('d', { order: 1 }),
        ])), []);
    });

    test('"" and null both mean top level', () => {
        assert.deepStrictEqual(codes(outline([item('a', { parent: '' }), item('b', { order: 1 })])), []);
    });

    test('duplicate id', () => {
        assert.deepStrictEqual(codes(outline([item('a'), item('a', { slug: 'a2', order: 1 })])), [CODES.duplicateId]);
    });

    test('duplicate slug', () => {
        assert.deepStrictEqual(codes(outline([item('a', { slug: 'x' }), item('b', { slug: 'x', order: 1 })])), [CODES.duplicateSlug]);
    });

    test('unknown parent', () => {
        assert.deepStrictEqual(codes(outline([item('a', { parent: 'nope', indent: 1 })])), [CODES.unknownParent]);
    });

    test('cycles', () => {
        assert.deepStrictEqual(codes(outline([item('a', { parent: 'a' })])), [CODES.parentCycle]);
        assert.deepStrictEqual(codes(outline([item('a', { parent: 'b', indent: 1 }), item('b', { parent: 'a', indent: 1 })])),
            [CODES.parentCycle, CODES.parentCycle]);
    });

    test('indent must match depth', () => {
        const findings = validateOutline(outline([item('a'), item('b', { parent: 'a', indent: 0 })]));
        assert.deepStrictEqual(findings.map((f) => f.code), [CODES.indentMismatch]);
        assert.match(findings[0].message, /1 level\(s\) deep \(under "a"\)/);
    });

    test('shared sibling order', () => {
        assert.deepStrictEqual(codes(outline([item('a'), item('b')])), [CODES.duplicateOrder]);
        assert.deepStrictEqual(codes(outline([item('a'), item('b', { parent: 'a', indent: 1 })])), []);
    });

    test('metadata references', () => {
        assert.deepStrictEqual(codes(outline([item('a')], { site: { homePageId: 'x' } })), [CODES.unknownHomePage]);
        assert.deepStrictEqual(codes(outline([item('a')], { theme: { regions: { header: ['a', 'x'] } } })), [CODES.unknownRegionItem]);
        assert.deepStrictEqual(codes(outline([item('a', { metadata: { relatedItems: 'a, x' } })])), [CODES.unknownRelatedItem]);
        assert.deepStrictEqual(codes(outline([item('a', { metadata: { theme: { regions: { footerPrimary: ['x'] } } } })])), [CODES.unknownRegionItem]);
    });

    test('locations are only checked on request', () => {
        const text = outline([item('a'), item('b', { order: 1, location: 'https://example.com' })]);
        assert.deepStrictEqual(codes(text), []);
        assert.deepStrictEqual(codes(text, { locationExists: () => false }), [CODES.missingLocation]);
    });

    test('non-outline JSON named site.json is left alone', () => {
        assert.deepStrictEqual(codes('{ "name": "my site", "items": [ { "sku": 1 }, { "sku": 1 } ] }'), []);
        assert.deepStrictEqual(codes('{ "title": 3 }'), []);
        assert.deepStrictEqual(codes('{ "items": '), []);
    });

    test('finding points at the value', () => {
        const text = outline([item('a'), item('b', { parent: 'zzz', indent: 1 })]);
        const [f] = validateOutline(text);
        assert.strictEqual(text.substr(f.offset, f.length), '"zzz"');
    });

    test('real HAXcms site: only the known indent slip', () => {
        const findings = validateOutline(fixture('haxcms-elements.site.json'));
        assert.deepStrictEqual(findings.map((f) => f.code), [CODES.indentMismatch]);
        assert.match(findings[0].message, /under "Welcome"/);
        assert.deepStrictEqual(validateOutline(fixture('clean-one.site.json')), []);
    });

    test('example site shows each deliberate mistake', () => {
        const text = fs.readFileSync(path.join(root, 'examples', 'site.json'), 'utf8');
        const dir = path.join(root, 'examples');
        assert.deepStrictEqual(
            codes(text, { locationExists: (l: string) => fs.existsSync(path.join(dir, l)) }).sort(),
            [CODES.duplicateSlug, CODES.indentMismatch, CODES.missingLocation, CODES.unknownRegionItem].sort(),
        );
    });
});
