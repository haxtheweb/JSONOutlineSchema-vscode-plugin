import { Node, findNodeAtOffset, getNodePath } from 'jsonc-parser';
import { parseDocument } from './jsonUtil';
import { Outline, OutlineItem, looksLikeOutline, readOutline } from './validator';

/** Editor features for outlines, kept free of the vscode API so they can be tested. */

export interface Span {
    offset: number;
    length: number;
}

export interface Analysis {
    outline: Outline;
    root: Node;
}

export function analyze(text: string): Analysis | undefined {
    const { root, value, syntaxErrors } = parseDocument(text);
    if (!root || syntaxErrors.length || !looksLikeOutline(value)) {
        return undefined;
    }
    return { outline: readOutline(value), root };
}

/** Span of the string node inside the quotes. */
const inner = (n: Node): Span => ({ offset: n.offset + 1, length: Math.max(0, n.length - 2) });

/** The `"location"` value of every item, for document links. */
export function locationLinks(a: Analysis): (Span & { location: string })[] {
    const out: (Span & { location: string })[] = [];
    const items = a.root.children?.find((p) => p.children?.[0].value === 'items')?.children?.[1];
    for (const item of items?.children ?? []) {
        for (const prop of item.children ?? []) {
            const [k, v] = prop.children ?? [];
            if (k?.value === 'location' && v?.type === 'string' && v.value) {
                out.push({ ...inner(v), location: v.value });
            }
        }
    }
    return out;
}

/** The item id referenced by the string at `offset`, if any. */
export function referencedId(a: Analysis, offset: number): { id: string; span: Span; isDeclaration: boolean } | undefined {
    const node = findNodeAtOffset(a.root, offset);
    if (!node || node.type !== 'string' || typeof node.value !== 'string') {
        return undefined;
    }
    const path = getNodePath(node);
    const isDeclaration = path.length === 3 && path[0] === 'items' && path[2] === 'id';
    // relatedItems may hold several comma separated ids
    const parts = node.value.split(',');
    let start = node.offset + 1;
    for (const part of parts) {
        const id = part.trim();
        const lead = part.length - part.trimStart().length;
        if (a.outline.byId.has(id) && offset >= start + lead && offset <= start + lead + id.length) {
            return { id, span: { offset: start + lead, length: id.length }, isDeclaration };
        }
        start += part.length + 1;
    }
    return undefined;
}

/** Span of the `"id"` value that declares the item. */
export function declarationOf(a: Analysis, id: string): Span | undefined {
    const item = a.outline.byId.get(id);
    if (!item) {
        return undefined;
    }
    const items = a.root.children?.find((p) => p.children?.[0].value === 'items')?.children?.[1];
    const node = items?.children?.[item.index]?.children?.find((p) => p.children?.[0].value === 'id')?.children?.[1];
    return node ? inner(node) : undefined;
}

/** Items in menu order (depth first, siblings by order) with their depth. */
export function tree(outline: Outline): { item: OutlineItem; depth: number }[] {
    const children = new Map<string | null, OutlineItem[]>();
    for (const item of outline.items) {
        const key = item.parent && outline.byId.has(item.parent) ? item.parent : null;
        const list = children.get(key) ?? [];
        list.push(item);
        children.set(key, list);
    }
    for (const list of children.values()) {
        list.sort((x, y) => x.order - y.order || x.index - y.index);
    }
    const out: { item: OutlineItem; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | null, depth: number) => {
        for (const item of children.get(parent) ?? []) {
            if (seen.has(item.id)) {
                continue;
            }
            seen.add(item.id);
            out.push({ item, depth });
            walk(item.id, depth + 1);
        }
    };
    walk(null, 0);
    // anything left is stuck in a cycle; list it rather than hide it
    for (const item of outline.items) {
        if (!seen.has(item.id)) {
            seen.add(item.id);
            out.push({ item, depth: 0 });
        }
    }
    return out;
}

export function describe(item: OutlineItem): string {
    return [item.slug ? `/${item.slug}` : undefined, item.location].filter(Boolean).join(' · ');
}

