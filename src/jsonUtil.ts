import { Node, ParseError, findNodeAtLocation, parseTree, printParseErrorCode, JSONPath } from 'jsonc-parser';

/** A problem found in a document, positioned by character offset. */
export interface Finding {
    code: string;
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    offset: number;
    length: number;
    path: JSONPath;
}

export interface ParsedDocument {
    root: Node | undefined;
    value: unknown;
    syntaxErrors: Finding[];
}

export function parseDocument(text: string): ParsedDocument {
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
    const syntaxErrors: Finding[] = errors.map((e) => ({
        code: 'JSON',
        message: `JSON syntax error: ${printParseErrorCode(e.error)}`,
        severity: 'error',
        offset: e.offset,
        length: Math.max(1, e.length),
        path: [],
    }));
    let value: unknown;
    if (root && errors.length === 0) {
        value = nodeToValue(root);
    }
    return { root, value, syntaxErrors };
}

function nodeToValue(node: Node): unknown {
    switch (node.type) {
        case 'object': {
            const out: Record<string, unknown> = {};
            for (const prop of node.children ?? []) {
                const [k, v] = prop.children ?? [];
                if (k && v) {
                    out[k.value as string] = nodeToValue(v);
                }
            }
            return out;
        }
        case 'array':
            return (node.children ?? []).map(nodeToValue);
        default:
            return node.value;
    }
}

/**
 * Range for a JSON path. With `key` true and the path ending in a property
 * name, highlights the property key instead of its value.
 */
export function locate(root: Node | undefined, path: JSONPath, key = false): { offset: number; length: number } {
    if (!root) {
        return { offset: 0, length: 1 };
    }
    let node = findNodeAtLocation(root, path);
    // walk up until something exists (e.g. a missing child of an existing object)
    let p = path.slice();
    while (!node && p.length) {
        p = p.slice(0, -1);
        node = findNodeAtLocation(root, p);
    }
    if (!node) {
        return { offset: 0, length: 1 };
    }
    if (key && node.parent && node.parent.type === 'property' && node.parent.children) {
        const k = node.parent.children[0];
        return { offset: k.offset, length: k.length };
    }
    // keep big objects/arrays readable: underline the opening token only
    if (node.type === 'object' || node.type === 'array') {
        if (node.parent && node.parent.type === 'property' && node.parent.children) {
            const k = node.parent.children[0];
            return { offset: k.offset, length: k.length };
        }
        return { offset: node.offset, length: 1 };
    }
    return { offset: node.offset, length: node.length };
}

export function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Damerau-free Levenshtein distance, small inputs only. */
export function distance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const d: number[] = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = d[0];
        d[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = d[j];
            d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return d[n];
}

/** Closest known key that looks like a typo of `key`, if any. */
export function suggest(key: string, known: readonly string[]): string | undefined {
    const lower = key.toLowerCase();
    let best: string | undefined;
    let bestScore = Infinity;
    for (const k of known) {
        const kl = k.toLowerCase();
        let score = distance(lower, kl);
        // abbreviations like desc -> description
        if (kl.startsWith(lower) && lower.length >= 3) {
            score = Math.min(score, 1);
        }
        if (score < bestScore) {
            bestScore = score;
            best = k;
        }
    }
    const limit = key.length <= 4 ? 1 : 2;
    return bestScore > 0 && bestScore <= limit ? best : undefined;
}
