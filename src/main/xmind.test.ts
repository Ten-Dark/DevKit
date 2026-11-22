import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { deflateRawSync } from 'zlib';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { ipcMain, dialog } from 'electron';
import { resetIpcRegistry } from './ipc-registry.js';
vi.mock('electron', () => ({
    ipcMain: { handle: vi.fn() },
    dialog: {
        showSaveDialog: vi.fn(),
        showOpenDialog: vi.fn(),
    },
}));
vi.mock('./window.js', () => ({
    mainWindow: null,
}));
import { MAX_EXTRACT_TOTAL_SIZE, registerXMindHandlers, extractXMindToTemp, validateExtractedDirectory, validateZipCentralDirectory, } from './xmind.js';
const handled = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Fixtures are pre-built valid .xmind ZIP archives in scripts/__xmind_fixtures__
const FIXTURES_DIR = path.resolve(__dirname, '../../scripts/__xmind_fixtures__');
function crc32(buffer: Buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildDeflatedZip(contents: Buffer[], declaredSizes: number[] = contents.map(content => content.length)) {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let localOffset = 0;
    contents.forEach((content, index) => {
        const name = Buffer.from(`entry-${index}.bin`);
        const compressed = deflateRawSync(content);
        const checksum = crc32(content);
        const localHeader = Buffer.alloc(30 + name.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(declaredSizes[index], 22);
        localHeader.writeUInt16LE(name.length, 26);
        name.copy(localHeader, 30);
        localParts.push(localHeader, compressed);
        const centralEntry = Buffer.alloc(46 + name.length);
        centralEntry.writeUInt32LE(0x02014b50, 0);
        centralEntry.writeUInt16LE(20, 4);
        centralEntry.writeUInt16LE(20, 6);
        centralEntry.writeUInt16LE(8, 10);
        centralEntry.writeUInt32LE(checksum, 16);
        centralEntry.writeUInt32LE(compressed.length, 20);
        centralEntry.writeUInt32LE(declaredSizes[index], 24);
        centralEntry.writeUInt16LE(name.length, 28);
        centralEntry.writeUInt32LE(localOffset, 42);
        name.copy(centralEntry, 46);
        centralParts.push(centralEntry);
        localOffset += localHeader.length + compressed.length;
    });
    const localData = Buffer.concat(localParts);
    const centralDirectory = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(contents.length, 8);
    eocd.writeUInt16LE(contents.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(localData.length, 16);
    return Buffer.concat([localData, centralDirectory, eocd]);
}
async function createDeclaredSizeArchive(actualSizes: number[], declaredSizes: number[] = actualSizes) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-size-boundary-'));
    const file = path.join(dir, 'boundary.xmind');
    await fs.writeFile(file, buildDeflatedZip(actualSizes.map(size => Buffer.alloc(size, 0x20)), declaredSizes));
    return { dir, file };
}
async function createExtractedDirectory(size: number) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-extracted-size-'));
    const file = path.join(dir, 'entry.bin');
    await fs.writeFile(file, Buffer.alloc(0));
    await fs.truncate(file, size);
    return dir;
}
beforeEach(() => {
    handled.clear();
    resetIpcRegistry();
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
        handled.set(channel, handler);
    });
    registerXMindHandlers();
});
afterEach(() => {
    vi.clearAllMocks();
});
function createInvokeEvent(senderId = 1, send: ReturnType<typeof vi.fn> = vi.fn()) {
    return { sender: { id: senderId, isDestroyed: () => false, send }, senderFrame: { url: 'http://localhost:5173/', parent: null } };
}
async function invokeWithEvent(channel: string, event: ReturnType<typeof createInvokeEvent>, ...args: unknown[]): Promise<any> {
    const handler = handled.get(channel);
    if (!handler)
        throw new Error('No handler for channel: ' + channel);
    if (channel === 'convertXMindToMarkdown') {
        vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
            canceled: false,
            filePaths: [args[0] as string],
        } as any);
        const selectedPath = await handled.get('selectXMindFile')!(event);
        return handler(event, selectedPath, ...args.slice(1));
    }
    return handler(event, ...args);
}
async function invoke(channel: string, ...args: unknown[]): Promise<any> {
    return invokeWithEvent(channel, createInvokeEvent(), ...args);
}
describe('xmind main process', () => {
    it('rejects conversion paths that were not selected through the file dialog', async () => {
        const event = createInvokeEvent(77);
        const handler = handled.get('convertXMindToMarkdown')!;
        await expect(handler(event, path.join(FIXTURES_DIR, 'single.xmind')))
            .rejects.toThrow(/must be selected through the file dialog/);
    });

    it('reads the already-opened archive handle even if its original path is replaced', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-open-handle-'));
        const selectedPath = path.join(dir, 'selected.xmind');
        const movedPath = path.join(dir, 'selected-original.xmind');
        const originalFixture = path.join(FIXTURES_DIR, 'single.xmind');
        const replacementFixture = path.join(FIXTURES_DIR, 'special.xmind');
        let fileDescriptor: number | null = null;
        let extractedDir: string | null = null;
        try {
            await fs.copyFile(originalFixture, selectedPath);
            fileDescriptor = (await import('fs')).openSync(selectedPath, 'r');
            await fs.rename(selectedPath, movedPath);
            await fs.copyFile(replacementFixture, selectedPath);

            const descriptorForExtraction = fileDescriptor;
            fileDescriptor = null; // yauzl owns and closes the descriptor
            extractedDir = await extractXMindToTemp(selectedPath, { fileDescriptor: descriptorForExtraction });
            const content = await fs.readFile(path.join(extractedDir, 'content.json'), 'utf8');
            expect(content).toContain('Root Topic');
            expect(content).not.toContain('Topic with');
        }
        finally {
            if (fileDescriptor !== null) {
                try { (await import('fs')).closeSync(fileDescriptor); } catch { /* already closed */ }
            }
            if (extractedDir) await fs.rm(extractedDir, { recursive: true, force: true });
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('converts modern attached and detached topic collections end-to-end', async () => {
        const result = await invoke('convertXMindToMarkdown', path.join(FIXTURES_DIR, 'modern.xmind'));
        expect(result.title).toBe('Modern Root');
        expect(result.topicCount).toBe(4);
        expect(result.depth).toBe(2);
        expect(result.markdown).toContain('- Attached Branch');
        expect(result.markdown).toContain('- Nested Attached');
        expect(result.markdown).toContain('- Nested Detached');
        expect(result.markdown).toContain('- Floating Topic');
    });

    describe('C6 — deep nesting does not stack overflow', () => {
        it('converts deeply nested XMind (500 levels)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'deep.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.topicCount).toBe(500);
            expect(result.depth).toBe(500);
            expect(result.markdown).toContain('Level 0');
        });
    });
    describe('C7 — notes rendering', () => {
        it('preserves multi-line notes with exact content', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'special.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            // Full exact comparison of notes section
            expect(result.markdown).toContain('> This is a note');
            expect(result.markdown).toContain('> \\# This looks like a heading');
            expect(result.markdown).toContain('> Line 3');
            // Multi-line notes: each line gets its own > prefix
            const lines = result.markdown.split('\n');
            const blockquoteLines = lines.filter((l: string) => l.trimStart().startsWith('> '));
            expect(blockquoteLines.length).toBeGreaterThanOrEqual(3);
        });
        it('does not turn note text starting with # into a heading', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'special.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            const headingLines = result.markdown
                .split('\n')
                .filter((l: string) => /^# /.test(l));
            expect(headingLines.length).toBe(1);
            expect(headingLines[0]).toBe('# Root');
        });
    });
    describe('C8 — hyperlinks with special characters', () => {
        it('escapes ) in URL', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'special.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.markdown).toContain('\\)');
        });
        it('escapes # in topic title to prevent heading', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'special.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.markdown).toContain('Topic with \\# heading');
        });
    });
    describe('P7 — content.json preference', () => {
        it('prefers content.json in archive root', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'single.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Root Topic');
            expect(result.markdown).toContain('Child 1');
        });
        it('finds content.json when rootTopic is present', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'nested.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Nested');
        });
    });
    describe('P8 — multiple sheets', () => {
        it('converts all sheets in multi-sheet XMind', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'multi.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.sheetsCount).toBe(2);
            expect(result.markdown).toContain('Child A');
            expect(result.markdown).toContain('Child B');
            expect(result.topicCount).toBe(2);
        });
        it('includes warning about multiple sheets', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'multi.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.warnings.some((w: string) => w.includes('Multiple sheets'))).toBe(true);
        });
    });
    describe('P9 — ZIP extraction safety', () => {
        it('rejects corrupted ZIP (no EOCD record)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'corrupted.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Invalid ZIP archive|Failed to extract/);
        });
        it('accepts valid normal XMind ZIP', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'single.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Root Topic');
        });
        it('rejects entry claiming huge uncompressed size (ZIP bomb)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-big-entry.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/exceeds limit/);
        });
        it('rejects too many entries (> 5000)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-many-entries.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/entry count exceeds limit/);
        });
        it('rejects Zip Slip path traversal (../)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-zip-slip.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects absolute path (/etc/passwd)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-absolute.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects Windows absolute path (C:\\...)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-absolute-win.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects duplicate entry names', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-duplicate.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Duplicate ZIP entry/);
        });
        // ZIP64 tests
        it('accepts valid ZIP64 archive through yauzl', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-zip64-eocd.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Zip64');
        });
        it('rejects ZIP64 sentinel values in standard fields', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-zip64-sentinel.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/exceeds limit/);
        });
        // Windows path tests
        it('rejects drive-relative path (C:file.txt)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-drive-relative.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects UNC path (\\\\server\\share\\...)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-unc.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects dot component (./content.json)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-dot.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects Windows reserved name (CON)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-reserved-con.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects Windows reserved name (NUL)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-reserved-nul.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        it('rejects Windows reserved name (COM1)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-reserved-com1.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Unsafe ZIP entry path/);
        });
        // Duplicate entry tests
        it('rejects case-insensitive duplicate entries', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-dup-case.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Duplicate ZIP entry/);
        });
        it('rejects Unicode NFC/NFD duplicate entries', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-dup-unicode.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Duplicate ZIP entry/);
        });
        // Symlink entry test
        it('rejects symlink entry (Unix external attribute)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-symlink.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/symlink entry detected/);
        });
        // Central Directory bounds tests
        it('rejects local header offset beyond file size', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-bad-cd-offset.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/local header offset.*exceeds file size|Invalid ZIP archive/);
        });
        it('rejects central directory size exceeding file', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-bad-cd-size.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Invalid ZIP archive|content.json not found/);
        });
        // EOCD validation tests
        it('accepts valid archive with normal comment', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-valid-comment.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Test');
        });
        it('accepts archive with EOCD-like signature bytes inside comment', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-sig-in-comment.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Test');
        });
        it('rejects EOCD with incorrect comment length', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-bad-comment-len.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Invalid ZIP archive|content.json not found/);
        });
        it('rejects truncated EOCD', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-truncated.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Invalid ZIP archive|End of Central Directory/);
        });
        it('rejects ambiguous EOCD-like signatures in the comment', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-eocd-multi-sig-comment.xmind');
            await expect(invoke('convertXMindToMarkdown', xmindPath)).rejects.toThrow(/Invalid ZIP archive|content.json not found/);
        });
        it('accepts full ZIP64 structure (locator + EOCD record)', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'p9-zip64-full.xmind');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Test');
        });
    });
    describe('P10 — case-insensitive extension', () => {
        it('converts .XMIND (uppercase) file', async () => {
            const xmindPath = path.join(FIXTURES_DIR, 'uppercase.XMIND');
            const result = await invoke('convertXMindToMarkdown', xmindPath);
            expect(result.title).toBe('Root Topic');
        });
    });
    describe('ZIP declared uncompressed-size boundaries', () => {
        it.each([
            ['limit - 1', MAX_EXTRACT_TOTAL_SIZE - 1],
            ['limit', MAX_EXTRACT_TOTAL_SIZE],
        ])('accepts a single entry at %s', async (_label, size) => {
            const archive = await createDeclaredSizeArchive([size]);
            try {
                const entries = await validateZipCentralDirectory(archive.file);
                expect(entries).toHaveLength(1);
                expect(entries[0].uncompressedSize).toBe(size);
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        });
        it('rejects a single entry at limit + 1', async () => {
            const archive = await createDeclaredSizeArchive([MAX_EXTRACT_TOTAL_SIZE + 1]);
            try {
                await expect(validateZipCentralDirectory(archive.file)).rejects.toThrow(/uncompressed size exceeds limit/);
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        });
        it('rejects aggregate size above limit across multiple entries', async () => {
            const perEntrySize = Math.floor(MAX_EXTRACT_TOTAL_SIZE / 2) + 1;
            const archive = await createDeclaredSizeArchive([perEntrySize, perEntrySize]);
            try {
                await expect(validateZipCentralDirectory(archive.file)).rejects.toThrow(/total uncompressed size exceeds limit/);
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        }, 15_000);
        it('rejects actual decompressed data larger than the declared size', async () => {
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-size-mismatch-'));
            const file = path.join(dir, 'size-mismatch.xmind');
            await fs.writeFile(file, buildDeflatedZip([Buffer.alloc(1024, 0x20)], [1]));
            try {
                await expect(invoke('convertXMindToMarkdown', file)).rejects.toThrow();
            }
            finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });
    describe('bounded streaming extraction', () => {
        it.each([
            ['limit - 1', MAX_EXTRACT_TOTAL_SIZE - 1],
            ['limit', MAX_EXTRACT_TOTAL_SIZE],
        ])('extracts actual data at %s', async (_label, size) => {
            const archive = await createDeclaredSizeArchive([size]);
            let extractedDir = null;
            try {
                extractedDir = await extractXMindToTemp(archive.file);
                const stat = await fs.stat(path.join(extractedDir, 'entry-0.bin'));
                expect(stat.size).toBe(size);
            }
            finally {
                if (extractedDir)
                    await fs.rm(extractedDir, { recursive: true, force: true });
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        }, 15000);
        it('stops extraction at limit + 1 and removes partial output', async () => {
            const archive = await createDeclaredSizeArchive([MAX_EXTRACT_TOTAL_SIZE + 1], [MAX_EXTRACT_TOTAL_SIZE]);
            const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            try {
                await expect(extractXMindToTemp(archive.file)).rejects.toThrow(/exceeded the .* limit while writing data/);
                const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
                expect(after.sort()).toEqual(before.sort());
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        }, 15000);
        it('enforces aggregate runtime limit across multiple entries', async () => {
            const half = Math.floor(MAX_EXTRACT_TOTAL_SIZE / 2);
            const archive = await createDeclaredSizeArchive([half, half + 1], [half, half]);
            const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            try {
                await expect(extractXMindToTemp(archive.file)).rejects.toThrow(/exceeded the .* limit while writing data/);
                const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
                expect(after.sort()).toEqual(before.sort());
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        }, 15000);
        it('rejects actual decompressed bytes exceeding the declared entry size', async () => {
            const archive = await createDeclaredSizeArchive([1024], [1023]);
            try {
                await expect(extractXMindToTemp(archive.file)).rejects.toThrow(/expanded beyond its declared size/);
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        });
        it('rejects malformed compressed streams and cleans partial output', async () => {
            const archive = await createDeclaredSizeArchive([1024]);
            const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            try {
                const bytes = await fs.readFile(archive.file);
                const dataStart = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
                bytes[dataStart] = 0xFF;
                await fs.writeFile(archive.file, bytes);
                await expect(extractXMindToTemp(archive.file)).rejects.toThrow();
                const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
                expect(after.sort()).toEqual(before.sort());
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        });
        it('cleans up when extraction is interrupted by AbortSignal', async () => {
            const archive = await createDeclaredSizeArchive([MAX_EXTRACT_TOTAL_SIZE]);
            const controller = new AbortController();
            const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            const extraction = extractXMindToTemp(archive.file, { signal: controller.signal });
            const abortTimer = setTimeout(() => controller.abort(), 50);
            try {
                await expect(extraction).rejects.toThrow(/aborted/i);
                const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
                expect(after.sort()).toEqual(before.sort());
            }
            finally {
                clearTimeout(abortTimer);
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        }, 15000);
    });

    describe('XMind conversion progress and cancellation IPC', () => {
        it('emits extraction and conversion progress for the active operation', async () => {
            const send = vi.fn();
            const event = createInvokeEvent(11, send);
            const converted = await invokeWithEvent('convertXMindToMarkdown', event, path.join(FIXTURES_DIR, 'single.xmind'), 'progress-operation');
            expect(converted.topicCount).toBeGreaterThan(0);
            const progress = send.mock.calls.filter(([channel]) => channel === 'xmind-conversion-progress').map(([, payload]) => payload);
            expect(progress).toContainEqual({ operationId: 'progress-operation', phase: 'extracting', processed: 0, total: 174, processedEntries: 0, totalEntries: 1 });
            expect(progress).toContainEqual({ operationId: 'progress-operation', phase: 'extracting', processed: 174, total: 174, processedEntries: 1, totalEntries: 1 });
            expect(progress).toContainEqual({ operationId: 'progress-operation', phase: 'converting', stage: 'sheets', processed: 0, total: 1, processedEntries: 0, totalEntries: 0 });
            expect(progress).toContainEqual({ operationId: 'progress-operation', phase: 'converting', stage: 'sheets', processed: 1, total: 1, processedEntries: 0, totalEntries: 0 });
            expect(progress.some((item: any) => item.stage === 'parsing' && item.processed > 0)).toBe(true);
            expect(progress.some((item: any) => item.stage === 'rendering' && item.total === converted.topicCount)).toBe(true);
        });
        it('cancels extraction, cleans temporary output, and permits a later operation', async () => {
            const archive = await createDeclaredSizeArchive([1024, 1024]);
            const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            let cancelResult;
            let foreignCancelResult;
            let shouldCancel = true;
            const event = createInvokeEvent(12, vi.fn((channel: string, payload: any) => {
                if (shouldCancel && channel === 'xmind-conversion-progress' && payload.phase === 'extracting' && payload.processedEntries === 1) {
                    shouldCancel = false;
                    const cancelHandler = handled.get('cancelXMindConversion');
                    foreignCancelResult = cancelHandler?.(createInvokeEvent(99), 'cancel-operation');
                    cancelResult = cancelHandler?.(event, 'cancel-operation');
                }
            }));
            try {
                await expect(invokeWithEvent('convertXMindToMarkdown', event, archive.file, 'cancel-operation')).rejects.toThrow('Operation aborted');
                await expect(foreignCancelResult).resolves.toEqual({ success: false });
                await expect(cancelResult).resolves.toEqual({ success: true });
                const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
                expect(after.sort()).toEqual(before.sort());
                const retry = await invokeWithEvent('convertXMindToMarkdown', event, path.join(FIXTURES_DIR, 'single.xmind'), 'cancel-operation');
                expect(retry.topicCount).toBeGreaterThan(0);
            }
            finally {
                await fs.rm(archive.dir, { recursive: true, force: true });
            }
        });
        it.each(['parsing', 'rendering'])('cancels cooperatively during %s and cleans temporary output', async (stage) => {
            const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            let cancelResult: unknown;
            let shouldCancel = true;
            const event = createInvokeEvent(13, vi.fn((channel: string, payload: any) => {
                if (shouldCancel && channel === 'xmind-conversion-progress' && payload.stage === stage && payload.processed >= 128) {
                    shouldCancel = false;
                    cancelResult = handled.get('cancelXMindConversion')?.(event, 'cancel-' + stage);
                }
            }));
            await expect(
                invokeWithEvent('convertXMindToMarkdown', event, path.join(FIXTURES_DIR, 'deep.xmind'), 'cancel-' + stage),
            ).rejects.toThrow('Operation aborted');
            await expect(cancelResult).resolves.toEqual({ success: true });
            const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xmind-md-'));
            expect(after.sort()).toEqual(before.sort());
        });
        it('does not allow another WebContents to cancel an operation', async () => {
            const cancelHandler = handled.get('cancelXMindConversion');
            expect(cancelHandler).toBeDefined();
            await expect(cancelHandler(createInvokeEvent(99), 'unknown-operation')).resolves.toEqual({ success: false });
        });
    });

    describe('actual extracted-size boundaries', () => {
        it.each([
            ['limit - 1', MAX_EXTRACT_TOTAL_SIZE - 1],
            ['limit', MAX_EXTRACT_TOTAL_SIZE],
        ])('accepts actual extracted data at %s', async (_label, size) => {
            const dir = await createExtractedDirectory(size);
            try {
                await expect(validateExtractedDirectory(dir)).resolves.toBeUndefined();
            }
            finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
        it('rejects actual extracted data at limit + 1', async () => {
            const dir = await createExtractedDirectory(MAX_EXTRACT_TOTAL_SIZE + 1);
            try {
                await expect(validateExtractedDirectory(dir)).rejects.toThrow(/Extracted data size exceeds limit/);
            }
            finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });
});
