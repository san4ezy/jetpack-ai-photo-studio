import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEnvelope,
  isSupportedImageFilename,
  sliceToUint8Array,
} from '/tmp/ai-photo-studio-test/codec.js';
import { StudioController } from '/tmp/ai-photo-studio-test/studio-controller.js';

function encodeEnvelope(meta, binary = new Uint8Array()) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + metaBytes.byteLength + binary.byteLength);
  new DataView(out.buffer).setUint32(0, metaBytes.byteLength, true);
  out.set(metaBytes, 4);
  out.set(binary, 4 + metaBytes.byteLength);
  return out;
}

function makeFileEntry(filename, isProcessed = false) {
  return {
    filename,
    stem: filename.replace(/\.[^.]+$/, ''),
    extension: filename.split('.').pop().toLowerCase(),
    mime_type: 'image/png',
    size_bytes: 1200,
    width: 640,
    height: 480,
    modified_ms: 1700000000000,
    is_processed: isProcessed,
    output_filename: isProcessed ? `${filename.replace(/\.[^.]+$/, '')}.png` : null,
    output_mime_type: isProcessed ? 'image/png' : null,
    output_size_bytes: isProcessed ? 1500 : null,
    output_width: isProcessed ? 1280 : null,
    output_height: isProcessed ? 960 : null,
    thumb_offset: 0,
    thumb_length: 4,
    thumb_mime: 'image/webp',
  };
}

class MockStudioClient {
  constructor(initialFiles = []) {
    this.files = initialFiles;
    this.calls = [];
    this.listeners = new Map();
  }
  isConnected() {
    return true;
  }
  onStream(opcode, cb) {
    if (!this.listeners.has(opcode)) this.listeners.set(opcode, new Set());
    this.listeners.get(opcode).add(cb);
    return () => this.listeners.get(opcode)?.delete(cb);
  }
  async request(opcode, meta, binary) {
    this.calls.push({ opcode, meta, binary });
    if (opcode === 'studio.list_files') {
      const thumbBlob = new Uint8Array([1, 2, 3, 4]);
      const entries = this.files.map((f) => ({ ...f, thumb_offset: 0, thumb_length: 4 }));
      return {
        opcode: 'studio.list_files.ok',
        correlationId: 1,
        payload: encodeEnvelope(
          {
            working_dir: '/tmp/app_home',
            processed_count: entries.filter((e) => e.is_processed).length,
            accelerator: 'mps',
            onnx_providers: ['CoreMLExecutionProvider', 'CPUExecutionProvider'],
            files: entries,
          },
          thumbBlob
        ),
      };
    }
    if (opcode === 'studio.upload_files') {
      const entry = makeFileEntry(meta.filename, false);
      this.files = [...this.files.filter((f) => f.filename !== meta.filename), entry];
      return {
        opcode: 'studio.upload_files.ok',
        correlationId: 2,
        payload: encodeEnvelope({ file: entry, working_dir: '/tmp/app_home' }, new Uint8Array([1, 2, 3, 4])),
      };
    }
    if (opcode === 'studio.get_image') {
      const orig = new Uint8Array([10, 20, 30]);
      const entry = this.files.find((f) => f.filename === meta.filename);
      const out = entry?.is_processed ? new Uint8Array([40, 50, 60, 70]) : new Uint8Array();
      return {
        opcode: 'studio.get_image.ok',
        correlationId: 3,
        payload: encodeEnvelope(
          {
            filename: meta.filename,
            is_processed: Boolean(entry?.is_processed),
            original_mime: 'image/png',
            original_offset: 0,
            original_length: orig.byteLength,
            output_filename: entry?.output_filename ?? null,
            output_mime: entry?.output_mime_type ?? null,
            output_offset: orig.byteLength,
            output_length: out.byteLength,
          },
          new Uint8Array([...orig, ...out])
        ),
      };
    }
    if (opcode === 'studio.process') {
      const targetSet = new Set(meta.filenames);
      this.files = this.files.map((f) =>
        targetSet.has(f.filename) ? makeFileEntry(f.filename, true) : f
      );
      const processed = this.files.filter((f) => targetSet.has(f.filename));
      return {
        opcode: 'studio.process.ok',
        correlationId: 4,
        payload: encodeEnvelope({
          job_id: meta.job_id,
          processed_files: processed,
          processed_count: this.files.filter((f) => f.is_processed).length,
        }),
      };
    }
    if (opcode === 'studio.restore') {
      if (meta.restore_all) {
        const count = this.files.filter((f) => f.is_processed).length;
        this.files = this.files.map((f) => makeFileEntry(f.filename, false));
        return {
          opcode: 'studio.restore.ok',
          correlationId: 5,
          payload: encodeEnvelope({ restored_count: count, processed_count: 0 }),
        };
      }
      this.files = this.files.map((f) =>
        f.filename === meta.filename ? makeFileEntry(f.filename, false) : f
      );
      return {
        opcode: 'studio.restore.ok',
        correlationId: 5,
        payload: encodeEnvelope({
          restored_count: 1,
          processed_count: this.files.filter((f) => f.is_processed).length,
        }),
      };
    }
    if (opcode === 'studio.download_zip') {
      const zipBytes = new Uint8Array([80, 75, 3, 4]);
      return {
        opcode: 'studio.download_zip.ok',
        correlationId: 6,
        payload: encodeEnvelope(
          { filename: 'ai-photo-studio-output.zip', file_count: 2, total_bytes: zipBytes.byteLength },
          zipBytes
        ),
      };
    }
    throw new Error(`Unexpected opcode ${opcode}`);
  }
}

test('zero-copy envelope decoding and filename filtering', () => {
  assert.equal(isSupportedImageFilename('photo.JPG'), true);
  assert.equal(isSupportedImageFilename('render.webp'), true);
  assert.equal(isSupportedImageFilename('.DS_Store'), false);
  assert.equal(isSupportedImageFilename('readme.txt'), false);

  const raw = new Uint8Array([9, 8, 7, 6, 5]);
  const env = encodeEnvelope({ ok: true, size: 5 }, raw);
  const { meta, binary } = decodeEnvelope(env);
  assert.deepEqual(meta, { ok: true, size: 5 });
  assert.deepEqual(Array.from(sliceToUint8Array(binary, 1, 3)), [8, 7, 6]);
});

test('three-state selection toggle cycles Select -> Select All -> Reset and controls Process All', async () => {
  const client = new MockStudioClient([
    makeFileEntry('one.png', false),
    makeFileEntry('two.jpg', false),
  ]);
  const ctrl = new StudioController({
    createObjectUrl: (b, m) => `mock://${m}/${b.byteLength}`,
    revokeObjectUrl: () => {},
  });
  ctrl.setClient(client);
  await ctrl.refreshFiles();

  assert.equal(ctrl.getSelectionButtonLabel(), 'Select');
  assert.equal(ctrl.canProcessCurrent, true);
  assert.equal(ctrl.canProcessAll, false);
  assert.equal(ctrl.canDownloadAll, false);
  assert.equal(ctrl.canRestoreAll, false);

  // 1. Click Select -> becomes Select All, nothing selected yet
  ctrl.cycleSelectionMode();
  assert.equal(ctrl.selectionMode, 'selecting');
  assert.equal(ctrl.getSelectionButtonLabel(), 'Select All');
  assert.equal(ctrl.canProcessAll, false);

  // 2. Click Select All -> selects all files, becomes Reset
  ctrl.cycleSelectionMode();
  assert.equal(ctrl.selectedOrder.length, 2);
  assert.equal(ctrl.getSelectionButtonLabel(), 'Reset');
  assert.equal(ctrl.canProcessAll, true);

  // 3. Process All -> processes both files, activates Download All and Restore All
  ctrl.setTool('blur_bg');
  ctrl.blurLevel = 75;
  await ctrl.processSelected();
  assert.equal(ctrl.processedCount, 2);
  assert.equal(ctrl.canDownloadAll, true);
  assert.equal(ctrl.canRestoreAll, true);

  // 4. Download All ZIP & Restore All
  const zip = await ctrl.fetchAllOutputZip();
  assert.equal(zip.filename, 'ai-photo-studio-output.zip');
  assert.equal(zip.fileCount, 2);

  await ctrl.restoreAll();
  assert.equal(ctrl.processedCount, 0);
  assert.equal(ctrl.canDownloadAll, false);
  assert.equal(ctrl.canRestoreAll, false);

  // 5. Click Reset -> clears selection and returns to Select
  ctrl.cycleSelectionMode();
  assert.equal(ctrl.selectionMode, 'none');
  assert.equal(ctrl.selectedOrder.length, 0);
  assert.equal(ctrl.getSelectionButtonLabel(), 'Select');
});

test('uploadFiles skips non-image files and transfers Uint8Array binary payload', async () => {
  const client = new MockStudioClient([]);
  const ctrl = new StudioController({
    createObjectUrl: (b, m) => `mock://${m}/${b.byteLength}`,
    revokeObjectUrl: () => {},
  });
  ctrl.setClient(client);

  const count = await ctrl.uploadFiles([
    { name: 'notes.txt', bytes: new Uint8Array([1, 2]) },
    { name: 'portrait.png', bytes: new Uint8Array([137, 80, 78, 71]) },
  ]);

  assert.equal(count, 1);
  assert.equal(ctrl.files.length, 1);
  assert.equal(ctrl.activeFilename, 'portrait.png');
  const uploadCall = client.calls.find((c) => c.opcode === 'studio.upload_files');
  assert.ok(uploadCall);
  assert.deepEqual(uploadCall.meta, { filename: 'portrait.png', overwrite: true });
  assert.deepEqual(Array.from(uploadCall.binary), [137, 80, 78, 71]);
});
