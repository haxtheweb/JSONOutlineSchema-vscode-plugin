# JSON Outline Schema for VS Code

Editing support for [JSON Outline Schema](https://github.com/haxtheweb/webcomponents/tree/master/elements/json-outline-schema) — the format of a HAXcms `site.json`: a flat list of items whose `parent`, `order` and `indent` describe the site's tree.

## Features

- **Validation, autocomplete and hover docs** for `site.json` and `*.jos.json`, from a schema built against the `JSONOutlineSchema` classes in haxcms-nodejs and real HAXcms sites. Values HAXcms has historically written as strings (`"indent": "1"`, `"published": "1"`, `"created": "1697042706"`) are accepted.
- **Outline integrity checks** the schema can't express:

  | Code | Severity | Check |
  |---|---|---|
  | JOS100 | error | Duplicate item `id` |
  | JOS101 | error | `parent` isn't an item in the outline |
  | JOS102 | error | Parent chain loops (item unreachable from the top level) |
  | JOS103 | error | Duplicate `slug` (two pages at one URL) |
  | JOS104 | warning | `indent` doesn't match the item's depth |
  | JOS105 | info | Siblings share an `order` |
  | JOS106 | warning | `metadata.site.homePageId` isn't an item |
  | JOS107 | warning | A theme region lists an unknown item id |
  | JOS108 | warning | `relatedItems` lists an unknown item id |
  | JOS109 | warning | An item's `location` file doesn't exist |

- **Navigation**: `location` values are links to the page file; Go to Definition (F12) on any item id in `parent`, `relatedItems`, `regions` or `homePageId` jumps to that item; hovering one shows its title and slug.
- **JSON Outline Schema: Go to Item…** lists the outline as a tree, in menu order, and jumps to the item you pick.
- **Snippets**: a full starter on an empty file, and a "New item" template inside `items`.

## Settings

- `jsonOutlineSchema.semanticValidation` (default `true`) — the JOS checks above.
- `jsonOutlineSchema.checkLocations` (default `auto`) — JOS109 runs only when a `pages/` folder sits next to the outline, so outlines shipped without their pages (theme demos, exports) stay quiet. `always` / `never` override.

## Notes

The schema is attached by file name, so a `site.json` that isn't an outline gets the schema too. Every top-level key is optional, and the integrity checks only run on files that have an `items` array of outline items, so unrelated files stay clean unless they reuse the same keys with different types.

## Development

```bash
npm install
npm run check     # typecheck + lint + tests
npm run build     # bundle to dist/extension.js
npm run package   # build a .vsix
```

Press `F5` in VS Code to open the `examples/` site in an Extension Development Host; its `site.json` has a few deliberate mistakes.

## Releasing

Bump `version` in `package.json` (and add a CHANGELOG entry) in a PR. When it merges to `main`, the **Release** workflow tags `v<version>`, creates a GitHub release with the `.vsix`, and publishes to the Visual Studio Marketplace and Open VSX. See `.github/workflows/release.yml` for the secrets it needs.

## License

Apache-2.0 — part of [HAXTheWeb](https://haxtheweb.org).
