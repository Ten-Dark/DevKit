# XMind to Markdown - Test Notes (TEST_XMIN.md)

## Supported formats

- Modern XMind files (`.xmind`) based on the `content.json` format.
- A `.xmind` file is a ZIP archive. The converter extracts the archive and reads
  `content.json` from within it.
- Single-sheet and multi-sheet maps are supported. When `content.json` is an
  array of sheets, only the first sheet is converted and a warning is emitted.

## NOT supported

- Legacy `content.xml` based format.
- XMind 2008 / 2012 binary formats.
- Any non-ZIP or non-`.xmind` file.

## What is extracted

- Topic hierarchy (nested outline).
- Topic titles.
- Notes (plain text content).
- Hyperlinks: `topic.href` and child topics carrying `href` data. Rendered as
  inline Markdown links `[title](url)`.
- Markers: `topic.markers` array of marker id strings. Rendered as tags
  `#marker-id`.

## What is NOT extracted

- Images and embedded attachments.
- Task info (start/due dates, progress, resources).
- Priorities beyond what is represented by markers.
- Comments.
- Sheet-specific metadata beyond the first sheet.

## Error scenarios and messages

| Scenario | Message |
|----------|---------|
| Corrupted or unsupported ZIP archive | `Failed to extract .xmind archive (corrupted or unsupported zip): <reason>` |
| `content.json` not present | `content.json not found in .xmind archive (missing or corrupted archive)` |
| `content.json` is not valid JSON | `content.json is not valid JSON` |
| `rootTopic` missing in sheet | `rootTopic not found in content.json` |
| Unexpected failure | `Failed to convert XMind file to Markdown` |

## Conversion result fields

- `markdown` - generated Markdown string
- `title` - map title (from root topic or file name)
- `topicCount` - number of topics converted
- `depth` - maximum nesting depth
- `sheetsCount` - number of sheets found in `content.json` (1 for single-sheet maps)
- `warnings` - array of warning strings, e.g. multi-sheet notices
- `hyperlinkCount` - number of hyperlinks extracted
- `markerCount` - number of markers extracted
