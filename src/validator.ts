import { JSONPath } from 'jsonc-parser';
import { Finding, isObject, locate, parseDocument } from './jsonUtil';

/**
 * Outline integrity checks that JSON Schema can't express: references
 * between items, tree shape and slugs. Structural validation is done by
 * VS Code's JSON language service with schemas/json-outline-schema.json.
 */

export const CODES = {
    duplicateId: 'JOS100',
    unknownParent: 'JOS101',
    parentCycle: 'JOS102',
    duplicateSlug: 'JOS103',
    indentMismatch: 'JOS104',
    duplicateOrder: 'JOS105',
    unknownHomePage: 'JOS106',
    unknownRegionItem: 'JOS107',
    unknownRelatedItem: 'JOS108',
    missingLocation: 'JOS109',
} as const;

export interface OutlineItem {
    index: number;
    id: string;
    title: string;
    parent: string | null;
    order: number;
    indent: number;
    slug?: string;
    location?: string;
}

export interface Outline {
    items: OutlineItem[];
    byId: Map<string, OutlineItem>;
}

export interface ValidateOptions {
    /**
     * Report items whose location doesn't exist. Given the item's location,
     * return false when the file is missing. Leave unset to skip the check
     * (e.g. outlines shipped without their pages).
     */
    locationExists?: (location: string) => boolean;
}

/** Does this parsed JSON look like a JSON Outline Schema document? */
export function looksLikeOutline(value: unknown): value is Record<string, unknown> & { items: unknown[] } {
    return isObject(value) && Array.isArray(value.items) &&
        (value.items.length === 0 || value.items.some((i) => isObject(i) && 'id' in i && ('parent' in i || 'location' in i || 'slug' in i)));
}

const toInt = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isInteger(v)) {
        return v;
    }
    if (typeof v === 'string' && /^-?\d+$/.test(v)) {
        return parseInt(v, 10);
    }
    return undefined;
};

const parentOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function readOutline(value: { items: unknown[] }): Outline {
    const items: OutlineItem[] = [];
    const byId = new Map<string, OutlineItem>();
    value.items.forEach((raw, index) => {
        if (!isObject(raw) || typeof raw.id !== 'string') {
            return;
        }
        const item: OutlineItem = {
            index,
            id: raw.id,
            title: typeof raw.title === 'string' ? raw.title : raw.id,
            parent: parentOf(raw.parent),
            order: toInt(raw.order) ?? 0,
            indent: toInt(raw.indent) ?? 0,
            slug: typeof raw.slug === 'string' ? raw.slug : undefined,
            location: typeof raw.location === 'string' ? raw.location : undefined,
        };
        items.push(item);
        if (!byId.has(item.id)) {
            byId.set(item.id, item);
        }
    });
    return { items, byId };
}

/** Ancestor chain of an item, nearest first; stops at a cycle or unknown parent. */
export function ancestors(outline: Outline, item: OutlineItem): { chain: OutlineItem[]; cycle: boolean } {
    const chain: OutlineItem[] = [];
    const seen = new Set([item.id]);
    let cur = item;
    while (cur.parent) {
        const next = outline.byId.get(cur.parent);
        if (!next) {
            break;
        }
        if (seen.has(next.id)) {
            return { chain, cycle: true };
        }
        seen.add(next.id);
        chain.push(next);
        cur = next;
    }
    return { chain, cycle: false };
}

export function validateOutline(text: string, options: ValidateOptions = {}): Finding[] {
    const { root, value, syntaxErrors } = parseDocument(text);
    if (syntaxErrors.length || !looksLikeOutline(value)) {
        return [];
    }
    const out: Finding[] = [];
    const add = (code: string, severity: Finding['severity'], message: string, path: JSONPath) => {
        out.push({ code, severity, message, path, ...locate(root, path) });
    };
    const outline = readOutline(value);
    const ip = (item: OutlineItem, key: string): JSONPath => ['items', item.index, key];

    const firstById = new Map<string, OutlineItem>();
    const firstBySlug = new Map<string, OutlineItem>();
    const siblingOrder = new Map<string, OutlineItem>();

    for (const item of outline.items) {
        const dupe = firstById.get(item.id);
        if (dupe) {
            add(CODES.duplicateId, 'error', `Duplicate id; also used by "${dupe.title}" (items[${dupe.index}]).`, ip(item, 'id'));
        } else {
            firstById.set(item.id, item);
        }

        if (item.slug !== undefined && item.slug !== '') {
            const other = firstBySlug.get(item.slug);
            if (other) {
                add(CODES.duplicateSlug, 'error', `Duplicate slug; "${other.title}" (items[${other.index}]) already uses "${item.slug}".`, ip(item, 'slug'));
            } else {
                firstBySlug.set(item.slug, item);
            }
        }

        if (item.parent && !outline.byId.has(item.parent)) {
            add(CODES.unknownParent, 'error', `Parent "${item.parent}" is not an item in this outline.`, ip(item, 'parent'));
            continue;
        }
        const { chain, cycle } = ancestors(outline, item);
        if (item.parent === item.id || cycle) {
            add(CODES.parentCycle, 'error', 'Parent chain loops back on itself; this item is unreachable from the top level.', ip(item, 'parent'));
            continue;
        }
        if (item.indent !== chain.length) {
            add(CODES.indentMismatch, 'warning',
                `indent is ${item.indent} but the item is ${chain.length} level(s) deep${chain[0] ? ` (under "${chain[0].title}")` : ''}.`,
                ip(item, 'indent'));
        }
        const key = `${item.parent ?? ''}\u0000${item.order}`;
        const sib = siblingOrder.get(key);
        if (sib) {
            add(CODES.duplicateOrder, 'info', `order ${item.order} is shared with sibling "${sib.title}"; their menu position is ambiguous.`, ip(item, 'order'));
        } else {
            siblingOrder.set(key, item);
        }
    }

    // references from metadata
    const meta = isObject(value.metadata) ? value.metadata : undefined;
    const site = meta && isObject(meta.site) ? meta.site : undefined;
    if (site && typeof site.homePageId === 'string' && site.homePageId !== '' && !outline.byId.has(site.homePageId)) {
        add(CODES.unknownHomePage, 'warning', `homePageId "${site.homePageId}" is not an item in this outline.`, ['metadata', 'site', 'homePageId']);
    }
    const checkRegions = (theme: unknown, base: JSONPath) => {
        if (!isObject(theme) || !isObject(theme.regions)) {
            return;
        }
        for (const [region, ids] of Object.entries(theme.regions)) {
            if (Array.isArray(ids)) {
                ids.forEach((id, i) => {
                    if (typeof id === 'string' && id !== '' && !outline.byId.has(id)) {
                        add(CODES.unknownRegionItem, 'warning', `Region "${region}" references "${id}", which is not an item in this outline.`, [...base, 'regions', region, i]);
                    }
                });
            }
        }
    };
    if (meta) {
        checkRegions(meta.theme, ['metadata', 'theme']);
    }

    value.items.forEach((raw, index) => {
        if (!isObject(raw) || !isObject(raw.metadata)) {
            return;
        }
        const related = raw.metadata.relatedItems;
        const ids = typeof related === 'string' ? related.split(',').map((s) => s.trim()).filter(Boolean)
            : Array.isArray(related) ? related.filter((s): s is string => typeof s === 'string') : [];
        for (const id of ids) {
            if (!outline.byId.has(id)) {
                add(CODES.unknownRelatedItem, 'warning', `relatedItems references "${id}", which is not an item in this outline.`, ['items', index, 'metadata', 'relatedItems']);
            }
        }
        checkRegions(raw.metadata.theme, ['items', index, 'metadata', 'theme']);
    });

    if (options.locationExists) {
        for (const item of outline.items) {
            if (item.location && !/^[a-z]+:\/\//i.test(item.location) && !options.locationExists(item.location)) {
                add(CODES.missingLocation, 'warning', `"${item.location}" does not exist next to this outline.`, ip(item, 'location'));
            }
        }
    }
    return out;
}
