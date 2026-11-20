# XMind to Markdown

## Supported input formats

The converter accepts modern .xmind files whose content is stored in a ZIP archive with a content.json entry. The implementation uses yauzl to inspect and stream archive entries, including ZIP64 archives supported by that library.

Legacy XMind formats based on content.xml, XMind 2008/2012 binary formats, arbitrary ZIP files and non-.xmind inputs are not supported as conversion inputs.

## Conversion behavior

The converter:

- Processes every sheet represented in content.json.
- Preserves the topic hierarchy as a Markdown nested list, including modern XMind `children.attached` branches and `children.detached` floating topics, plus legacy `children.topics` collections.
- Converts topic notes to quoted Markdown lines.
- Converts topic hyperlinks to Markdown links.
- Emits topic marker identifiers as tags.
- Reports the map title, topic count, maximum depth, sheet count, hyperlink count, marker count and conversion warnings.
- Emits extraction and conversion progress and supports cancellation through an operation identifier.

The first sheet supplies the document title. When multiple sheets are present, their converted outlines are included in the output and sheet-specific headings distinguish the additional sheets.

## Archive validation and extraction limits

Before writing extracted data, the main process validates the central directory and entry metadata. The current limits are:

- Maximum total uncompressed archive data: **50 MiB**.
- Maximum archive entry count: **5,000**.
- Maximum uncompressed size of an individual entry: **50 MiB**.

The implementation rejects unsafe absolute or traversal paths, Windows reserved names, duplicate normalized entry names, symbolic links, unsupported special filesystem entries, encrypted entries, unsupported compression methods, invalid entry sizes and non-empty directory entries. Local-header metadata is checked against central-directory metadata.

Extraction streams each entry through a byte limiter and CRC32 verifier. Extracted output is validated again for symlinks, unsupported filesystem entries, entry count and total size. Failed or cancelled extraction removes its temporary directory.

These checks reduce archive traversal and resource-exhaustion risks; they do not imply support for every feature of every XMind generation.

## Not converted

The current Markdown model does not preserve embedded images or attachments, task scheduling/resource metadata, comments, or arbitrary sheet-level metadata. Only fields represented by the converter's topic model are emitted.

## Diagnostics and fixtures

- ZIP regression fixtures are maintained under scripts/__xmind_fixtures__.
- Fixture-generation utilities are under scripts/.
- Manual EOCD and extraction inspection scripts are under scripts/diagnostics/. They are developer diagnostics, not part of the production conversion path.

## Relevant implementation

- src/main/xmind.ts — archive validation, extraction, temporary-directory lifecycle and IPC operation/cancellation handling.
- src/shared/utils/xmind.ts — topic parsing and Markdown rendering.
- src/main/xmind.test.ts and src/renderer/xmind.test.ts — conversion and renderer utility tests.\n