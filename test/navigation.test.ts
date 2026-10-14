import * as assert from 'assert';
import { analyze, declarationOf, locationLinks, referencedId, tree } from '../src/navigation';

const text = JSON.stringify({
    id: 's',
    title: 'S',
    metadata: { site: { homePageId: 'item-a' }, theme: { regions: { header: ['item-c'] } } },
    items: [
        { id: 'item-c', title: 'C', parent: 'item-a', order: 1, indent: 1, slug: 'a/c', location: 'pages/c/index.html', metadata: {} },
        { id: 'item-a', title: 'A', parent: null, order: 0, indent: 0, slug: 'a', location: 'pages/a/index.html', metadata: { relatedItems: 'item-b, item-c' } },
        { id: 'item-b', title: 'B', parent: 'item-a', order: 0, indent: 1, slug: 'a/b', location: 'pages/b/index.html', metadata: {} },
        { id: 'item-d', title: 'D', parent: null, order: 1, indent: 0, slug: 'd', location: 'pages/d/index.html', metadata: {} },
    ],
}, null, 2);

const a = analyze(text)!;
const at = (needle: string, nth = 0, delta = 2) => {
    let i = -1;
    for (let n = 0; n <= nth; n++) {
        i = text.indexOf(needle, i + 1);
    }
    return i + delta;
};

suite('navigation', () => {
    test('analyze rejects non-outlines', () => {
        assert.strictEqual(analyze('{"a":1}'), undefined);
        assert.strictEqual(analyze('{"items": ['), undefined);
    });

    test('location links', () => {
        const links = locationLinks(a);
        assert.deepStrictEqual(links.map((l) => l.location), ['pages/c/index.html', 'pages/a/index.html', 'pages/b/index.html', 'pages/d/index.html']);
        assert.strictEqual(text.substr(links[0].offset, links[0].length), 'pages/c/index.html');
    });

    test('ids referenced from parent, regions, homePageId and relatedItems', () => {
        assert.strictEqual(referencedId(a, at('"parent": "item-a"', 0, 12))?.id, 'item-a');
        assert.strictEqual(referencedId(a, at('"homePageId": "item-a"', 0, 17))?.id, 'item-a');
        assert.strictEqual(referencedId(a, at('"item-c"\n'))?.id, 'item-c');
        const rel = at('item-b, item-c', 0, 0);
        assert.strictEqual(referencedId(a, rel + 2)?.id, 'item-b');
        assert.strictEqual(referencedId(a, rel + 10)?.id, 'item-c');
        assert.strictEqual(referencedId(a, at('"title": "C"', 0, 11)), undefined);
    });

    test('declarations', () => {
        const ref = referencedId(a, at('"id": "item-a"', 0, 9));
        assert.ok(ref?.isDeclaration);
        const d = declarationOf(a, 'item-b')!;
        assert.strictEqual(text.substr(d.offset, d.length), 'item-b');
        assert.strictEqual(text.lastIndexOf('"id": "item-b"', d.offset), d.offset - 7);
    });

    test('tree is in menu order', () => {
        assert.deepStrictEqual(tree(a.outline).map((t) => `${t.depth}:${t.item.id}`), ['0:item-a', '1:item-b', '1:item-c', '0:item-d']);
    });

    test('tree still lists items caught in a cycle', () => {
        const cyc = analyze(JSON.stringify({ items: [{ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' }] }))!;
        assert.strictEqual(tree(cyc.outline).length, 2);
    });
});
