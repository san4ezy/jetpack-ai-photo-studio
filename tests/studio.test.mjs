import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEnvelope,
  isSupportedImageFilename,
  sliceToUint8Array,
} from '/tmp/ai-photo-studio-test/codec.js';
import {
  clampCropRect,
  computeCenteredCropRect,
  computeFitCanvasScale,
  computeInitialCanvasScale,
  computeMaxCropPixelDimensions,
  CROP_ASPECT_PRESETS,
  StudioController,
} from '/tmp/ai-photo-studio-test/studio-controller.js';

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
    this.openFolderResult = { opened: true, path: '/tmp/app_home', message: null };
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
    if (opcode === 'studio.open_folder') {
      return {
        opcode: 'studio.open_folder.ok',
        correlationId: 7,
        payload: encodeEnvelope(this.openFolderResult),
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

test('computeInitialCanvasScale keeps small images at 1:1 and fits oversized images', () => {
  // Smaller than viewport -> 100% original size
  assert.equal(computeInitialCanvasScale(400, 300, 800, 600), 1);
  assert.equal(computeInitialCanvasScale(800, 600, 800, 600), 1);

  // Larger than viewport -> scaled down to fit
  const fitW = computeInitialCanvasScale(1600, 800, 800, 600);
  assert.equal(fitW, 0.5);

  const fitH = computeInitialCanvasScale(800, 1200, 800, 600);
  assert.equal(fitH, 0.5);
});

test('projectViewMode, zoom controls, and version actions work as specified', async () => {
  const entry = {
    ...makeFileEntry('hero.png', true),
    dpi_x: 300,
    dpi_y: 300,
    color_mode: 'RGBA',
    output_dpi_x: 300,
    output_dpi_y: 300,
    output_color_mode: 'RGBA',
  };
  const client = new MockStudioClient([entry]);
  const ctrl = new StudioController({
    createObjectUrl: (b, m) => `mock://${m}/${b.byteLength}`,
    revokeObjectUrl: () => {},
  });
  ctrl.setClient(client);
  await ctrl.refreshFiles();

  assert.equal(ctrl.projectViewMode, 'list');
  ctrl.toggleProjectViewMode();
  assert.equal(ctrl.projectViewMode, 'grid');

  // Versions for processed file: Original + Processed
  const versions = ctrl.getFileVersions(ctrl.files[0]);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].canDelete, false);
  assert.equal(versions[1].canDelete, true);
  assert.equal(versions[0].dpiX, 300);

  // Zoom controls
  assert.equal(ctrl.canvasZoomMode, 'auto');
  ctrl.zoomIn(1);
  assert.equal(ctrl.canvasZoomMode, 'manual');
  assert.equal(ctrl.canvasZoom, 1.25);
  ctrl.zoomOut();
  assert.equal(ctrl.canvasZoom, 1);
  ctrl.resetZoom();
  assert.equal(ctrl.canvasZoomMode, 'auto');

  // Fetch original & output blobs
  const origBlob = await ctrl.fetchVersionBlob('hero.png', 'original');
  assert.equal(origBlob.filename, 'hero.png');
  const outBlob = await ctrl.fetchVersionBlob('hero.png', 'output');
  assert.equal(outBlob.filename, 'hero.png');

  // Take original into work restores output
  await ctrl.takeVersionIntoWork('hero.png', 'original');
  assert.equal(ctrl.files[0].is_processed, false);
  assert.equal(ctrl.getVersionCount(ctrl.files[0]), 1);

  // Fit-to-workspace expands small images & 100% restores 1:1
  assert.equal(computeFitCanvasScale(400, 300, 800, 600), 2);
  ctrl.fitToWorkspace(400, 300, 800, 600);
  assert.equal(ctrl.canvasZoomMode, 'manual');
  assert.equal(ctrl.canvasZoom, 2);
  ctrl.setZoomExact(1);
  assert.equal(ctrl.canvasZoom, 1);

  // Open project folder RPC
  const folderRes = await ctrl.openProjectFolder();
  assert.equal(folderRes.opened, true);
  assert.equal(folderRes.path, '/tmp/app_home');
  assert.ok(client.calls.some((c) => c.opcode === 'studio.open_folder'));
});

test('Crop tool auto-clamps aspect presets to source image, couples inputs in all ratio modes, and sends exact crop rect for single vs ratio for batch', async () => {
  assert.equal(CROP_ASPECT_PRESETS.length, 6);
  const wideFile = { ...makeFileEntry('wide.png', false), width: 1080, height: 540 };
  const client = new MockStudioClient([wideFile, makeFileEntry('two.jpg', false)]);
  const ctrl = new StudioController({
    createObjectUrl: (b, m) => `mock://${m}/${b.byteLength}`,
    revokeObjectUrl: () => {},
  });
  ctrl.setClient(client);
  await ctrl.refreshFiles();
  ctrl.setTool('crop');

  // Default Keep aspect populates full source dimensions (1080x540) and couples edits within bounds
  assert.equal(ctrl.cropMode, 'keep_aspect');
  assert.equal(ctrl.cropWidth, '1080');
  assert.equal(ctrl.cropHeight, '540');
  ctrl.setCropWidthInput('540');
  assert.equal(ctrl.cropHeight, '270');
  ctrl.setCropHeightInput('100');
  assert.equal(ctrl.cropWidth, '200');
  ctrl.setCropWidthInput('9999');
  assert.equal(ctrl.cropWidth, '1080');
  assert.equal(ctrl.cropHeight, '540');

  // Preset 1:1 on 1080x540 auto-populates max centered square 540x540 (never 1080x1080!)
  assert.deepEqual(computeMaxCropPixelDimensions(1080, 540, '1:1'), { width: 540, height: 540 });
  ctrl.applyCropPreset('1:1');
  assert.equal(ctrl.cropMode, '1:1');
  assert.equal(ctrl.cropAspectPreset, '1:1');
  assert.equal(ctrl.cropWidth, '540');
  assert.equal(ctrl.cropHeight, '540');

  // Editing one side in preset 1:1 updates the companion side and shrinks the crop overlay
  ctrl.setCropWidthInput('270');
  assert.equal(ctrl.cropWidth, '270');
  assert.equal(ctrl.cropHeight, '270');
  const shrunk = ctrl.getEffectiveCropRect(1080, 540);
  assert.ok(Math.abs(shrunk.w - 0.25) < 1e-6);
  assert.ok(Math.abs(shrunk.h - 0.5) < 1e-6);
  assert.ok(Math.abs(shrunk.x - 0.375) < 1e-6);
  assert.ok(Math.abs(shrunk.y - 0.25) < 1e-6);

  // Moving the crop frame updates single-file processCurrent params, while batch processSelected uses ratio with null coords
  const clamped = clampCropRect({ x: -0.5, y: 0.9, w: 0.25, h: 0.5 });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0.5);
  ctrl.setCropPosition(0.1, 0.2, 1080, 540, false);

  await ctrl.processCurrent();
  const singleProc = client.calls.filter((c) => c.opcode === 'studio.process').at(-1);
  assert.equal(singleProc.meta.tool, 'crop');
  assert.equal(singleProc.meta.params.crop_mode, 'ratio');
  assert.ok(Math.abs(singleProc.meta.params.crop_x - 0.1) < 1e-6);
  assert.ok(Math.abs(singleProc.meta.params.crop_y - 0.2) < 1e-6);
  assert.ok(Math.abs(singleProc.meta.params.crop_w - 0.25) < 1e-6);
  assert.ok(Math.abs(singleProc.meta.params.crop_h - 0.5) < 1e-6);

  ctrl.cycleSelectionMode();
  ctrl.cycleSelectionMode(); // Select All
  await ctrl.processSelected();
  const batchProc = client.calls.filter((c) => c.opcode === 'studio.process').at(-1);
  assert.equal(batchProc.meta.tool, 'crop');
  assert.equal(batchProc.meta.params.crop_mode, 'ratio');
  assert.equal(batchProc.meta.params.crop_x, null);
  assert.equal(batchProc.meta.params.crop_y, null);
  assert.equal(batchProc.meta.params.crop_w, null);
  assert.equal(batchProc.meta.params.crop_h, null);

  // Crop: Custom allows independent W and H within source bounds
  ctrl.setCropMode('custom');
  assert.equal(ctrl.cropMode, 'custom');
  assert.equal(ctrl.cropAspectPreset, null);
  ctrl.setCropWidthInput('400');
  ctrl.setCropHeightInput('300');
  assert.equal(ctrl.cropWidth, '400');
  assert.equal(ctrl.cropHeight, '300');
  assert.equal(ctrl.buildProcessParams(true).crop_mode, 'custom');
});

test('Resize tool supports Keep aspect (proportional contain) and Custom (independent stretch) and re-syncs after processing', async () => {
  const client = new MockStudioClient([makeFileEntry('one.png', false)]);
  const ctrl = new StudioController({
    createObjectUrl: (b, m) => `mock://${m}/${b.byteLength}`,
    revokeObjectUrl: () => {},
  });
  ctrl.setClient(client);
  await ctrl.refreshFiles();
  ctrl.setTool('resize');

  // Keep aspect auto-populates active image dims (640x480) and scales proportionally (including upscale > 640)
  assert.equal(ctrl.resizeMode, 'keep_aspect');
  assert.equal(ctrl.resizeWidth, '640');
  assert.equal(ctrl.resizeHeight, '480');
  ctrl.setResizeWidthInput('1280');
  assert.equal(ctrl.resizeHeight, '960');
  ctrl.setResizeHeightInput('240');
  assert.equal(ctrl.resizeWidth, '320');
  assert.deepEqual(ctrl.buildProcessParams(), {
    width: 320,
    height: 240,
    keep_aspect: true,
    fit_mode: 'contain',
    crop_x: null,
    crop_y: null,
    crop_w: null,
    crop_h: null,
  });

  // Custom mode edits both dimensions independently and sends fit_mode='stretch'
  ctrl.setResizeMode('custom');
  assert.equal(ctrl.resizeMode, 'custom');
  ctrl.setResizeWidthInput('500');
  ctrl.setResizeHeightInput('900');
  assert.equal(ctrl.resizeWidth, '500');
  assert.equal(ctrl.resizeHeight, '900');
  assert.deepEqual(ctrl.buildProcessParams(), {
    width: 500,
    height: 900,
    keep_aspect: false,
    fit_mode: 'stretch',
    crop_x: null,
    crop_y: null,
    crop_w: null,
    crop_h: null,
  });

  // After processing (mock returns output 1280x960), transform defaults sync to new dimensions for next step
  await ctrl.processCurrent();
  assert.equal(ctrl.resizeWidth, '1280');
  assert.equal(ctrl.resizeHeight, '960');
  assert.equal(ctrl.cropWidth, '1280');
  assert.equal(ctrl.cropHeight, '960');

  ctrl.setOutputFormat('webp');
  assert.equal(ctrl.outputFormat, 'webp');
});

test('openProjectFolder copies path to clipboard with Cmd+Shift+G hint when sandbox blocks OS open', async () => {
  const client = new MockStudioClient([makeFileEntry('one.png', false)]);
  client.openFolderResult = {
    opened: false,
    path: '/Users/demo/Library/Application Support/JetPack/appdata/dev.codingbro.ai-photo-studio',
    message: 'LaunchServices error -54',
  };

  const copiedTexts = [];
  const notifications = [];
  const ctrl = new StudioController({
    createObjectUrl: (b, m) => `mock://${m}/${b.byteLength}`,
    revokeObjectUrl: () => {},
    copyToClipboard: async (text) => {
      copiedTexts.push(text);
      return true;
    },
    onNotify: (message, isError = false) => notifications.push({ message, isError }),
  });
  ctrl.setClient(client);

  const res = await ctrl.openProjectFolder();
  assert.equal(res.opened, false);
  assert.deepEqual(copiedTexts, [client.openFolderResult.path]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].isError, false);
  assert.ok(notifications[0].message.includes('Cmd+Shift+G'));
  assert.ok(notifications[0].message.includes(client.openFolderResult.path));
});

