# Changelog

## 1.1.0

Caught up with HAXcms ([haxtheweb/issues#3392](https://github.com/haxtheweb/issues/issues/3392)).

- `metadata.hideTitle` on items (page-break hide title).
- Theme suggestions now list all 66 themes in HAXcms (was 27), license suggestions all 20 license codes (adds public domain mark and software licenses), on both `license` and `metadata.site.license`.
- New check JOS110: a slug starting with `/`.
- New check JOS111 (info): a top-level key HAXcms doesn't keep and drops on its next save.
- Hover text for `locked` says what a lock does in HAXcms; item ids explain that numbers are converted on load and refused on save.
- CI compares the theme, license and top-level key lists with haxcms-nodejs main, on each PR and weekly.

## 1.0.0

- JSON schema for JSON Outline Schema / HAXcms `site.json` and `*.jos.json`, with hover docs, completions (theme elements, licenses, regions) and snippets.
- Outline integrity checks JOS100–JOS109.
- Document links for `location`, Go to Definition and hover for item id references, and a Go to Item… tree picker.
