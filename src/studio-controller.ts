import type { JetPackAppClient } from '@jetpack/client';
import {
  decodeEnvelope,
  isSupportedImageFilename,
  sliceToUint8Array,
  uint8ArrayToBlob,
} from './codec.js';
import type {
  JetPackOpcodeMap,
  StudioDownloadZipResult,
  StudioFileEntry,
  StudioGetImageResult,
  StudioListFilesResult,
  StudioProcessMeta,
  StudioProcessParams,
  StudioProcessProgress,
  StudioProcessResult,
  StudioRestoreResult,
  StudioUploadResult,
} from './jetpack-env.js';

export type StudioTool = 'upscale' | 'enhance' | 'remove_bg' | 'blur_bg' | 'resize';
export type StudioOutputFormat = 'auto' | 'png' | 'jpg' | 'webp';
export type SelectionButtonLabel = 'Select' | 'Select All' | 'Reset';

export interface StudioFileView extends StudioFileEntry {
  thumbUrl: string | null;
}

export interface StudioPreviewUrls {
  filename: string;
  isProcessed: boolean;
  originalUrl: string | null;
  outputUrl: string | null;
  outputFilename: string | null;
}

export interface StudioRpcClient {
  request: JetPackAppClient<JetPackOpcodeMap>['request'];
  onStream: JetPackAppClient<JetPackOpcodeMap>['onStream'];
  isConnected(): boolean;
}

export interface StudioControllerHooks {
  onChange?: () => void;
  onNotify?: (message: string, isError?: boolean) => void;
  createObjectUrl?: (bytes: Uint8Array, mimeType: string) => string;
  revokeObjectUrl?: (url: string) => void;
}

function defaultCreateObjectUrl(bytes: Uint8Array, mimeType: string): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(uint8ArrayToBlob(bytes, mimeType));
  }
  return `blob:mock/${mimeType}/${bytes.byteLength}`;
}

function defaultRevokeObjectUrl(url: string): void {
  if (
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    URL.revokeObjectURL(url);
  }
}

export class StudioController {
  private client: StudioRpcClient | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private readonly hooks: StudioControllerHooks;
  private readonly createObjectUrl: (bytes: Uint8Array, mimeType: string) => string;
  private readonly revokeObjectUrl: (url: string) => void;

  public files: StudioFileView[] = [];
  public workingDir: string = '';
  public accelerator: string = 'cpu';
  public onnxProviders: string[] = ['CPUExecutionProvider'];
  public activeFilename: string | null = null;
  public selectionMode: 'none' | 'selecting' = 'none';
  public selectedOrder: string[] = [];

  public tool: StudioTool = 'upscale';
  public upscaleScale: 2 | 4 = 2;
  public removeBgMode: 'transparent' | 'color' = 'transparent';
  public removeBgColor: string = '#0a84ff';
  public blurLevel: number = 40;
  public resizeWidth: string = '1024';
  public resizeHeight: string = '';
  public resizeKeepAspect: boolean = true;
  public outputFormat: StudioOutputFormat = 'auto';

  public isWorkerRunning: boolean = false;
  public isUploading: boolean = false;
  public isProcessing: boolean = false;
  public progress: StudioProcessProgress | null = null;
  public sliderPercent: number = 50;

  private activePreview: StudioPreviewUrls | null = null;
  private previewCache = new Map<string, StudioPreviewUrls>();
  private previewRequestVersion = 0;

  constructor(hooks: StudioControllerHooks = {}) {
    this.hooks = hooks;
    this.createObjectUrl = hooks.createObjectUrl ?? defaultCreateObjectUrl;
    this.revokeObjectUrl = hooks.revokeObjectUrl ?? defaultRevokeObjectUrl;
  }

  public setClient(client: StudioRpcClient | null): void {
    if (this.unsubscribeProgress) {
      this.unsubscribeProgress();
      this.unsubscribeProgress = null;
    }
    this.client = client;
    this.isWorkerRunning = Boolean(client && client.isConnected());
    if (client) {
      this.unsubscribeProgress = client.onStream('studio.process.progress', (payload) => {
        try {
          const { meta } = decodeEnvelope<StudioProcessProgress>(payload);
          this.progress = meta;
          this.notify();
        } catch {
          // Ignore malformed progress frames
        }
      });
    } else {
      this.isProcessing = false;
      this.isUploading = false;
      this.progress = null;
    }
    this.notify();
  }

  public dispose(): void {
    if (this.unsubscribeProgress) {
      this.unsubscribeProgress();
      this.unsubscribeProgress = null;
    }
    this.revokeAllThumbUrls();
    this.clearPreviewCache();
  }

  private notify(): void {
    this.hooks.onChange?.();
  }

  private toast(msg: string, isError: boolean = false): void {
    this.hooks.onNotify?.(msg, isError);
  }

  private revokeAllThumbUrls(): void {
    for (const f of this.files) {
      if (f.thumbUrl) {
        this.revokeObjectUrl(f.thumbUrl);
      }
    }
  }

  private clearPreviewCache(exceptFilename?: string): void {
    for (const [key, preview] of this.previewCache.entries()) {
      if (exceptFilename && key === exceptFilename) continue;
      if (preview.originalUrl) this.revokeObjectUrl(preview.originalUrl);
      if (preview.outputUrl) this.revokeObjectUrl(preview.outputUrl);
      this.previewCache.delete(key);
    }
    if (!exceptFilename) {
      this.activePreview = null;
    }
  }

  private invalidatePreview(filename?: string): void {
    if (!filename) {
      this.clearPreviewCache();
      return;
    }
    const existing = this.previewCache.get(filename);
    if (existing) {
      if (existing.originalUrl) this.revokeObjectUrl(existing.originalUrl);
      if (existing.outputUrl) this.revokeObjectUrl(existing.outputUrl);
      this.previewCache.delete(filename);
    }
    if (this.activePreview?.filename === filename) {
      this.activePreview = null;
    }
  }

  // --- Computed State ---

  public get isBusy(): boolean {
    return this.isProcessing || this.isUploading;
  }

  public get processedCount(): number {
    return this.files.filter((f) => f.is_processed).length;
  }

  public get activeFile(): StudioFileView | null {
    if (!this.activeFilename) return null;
    return this.files.find((f) => f.filename === this.activeFilename) ?? null;
  }

  public get selectedFiles(): StudioFileView[] {
    if (this.selectionMode !== 'selecting' || this.selectedOrder.length === 0) {
      return [];
    }
    const byName = new Map(this.files.map((f) => [f.filename, f]));
    return this.selectedOrder
      .map((name) => byName.get(name))
      .filter((item): item is StudioFileView => Boolean(item));
  }

  public getSelectionButtonLabel(): SelectionButtonLabel {
    if (this.selectionMode === 'none') {
      return 'Select';
    }
    if (this.files.length > 0 && this.selectedOrder.length < this.files.length) {
      return 'Select All';
    }
    return 'Reset';
  }

  public get canProcessCurrent(): boolean {
    return this.isWorkerRunning && !this.isBusy && this.activeFile !== null;
  }

  public get canProcessAll(): boolean {
    return (
      this.isWorkerRunning &&
      !this.isBusy &&
      this.selectionMode === 'selecting' &&
      this.selectedOrder.length > 0
    );
  }

  public get canDownloadAll(): boolean {
    return this.isWorkerRunning && !this.isBusy && this.processedCount > 0;
  }

  public get canRestoreAll(): boolean {
    return this.isWorkerRunning && !this.isBusy && this.processedCount > 0;
  }

  public getActivePreview(): StudioPreviewUrls | null {
    if (!this.activeFilename) return null;
    return this.previewCache.get(this.activeFilename) ?? this.activePreview;
  }

  public getPreviewFor(filename: string): StudioPreviewUrls | null {
    return this.previewCache.get(filename) ?? null;
  }

  // --- Selection & Tool State ---

  public cycleSelectionMode(): void {
    const label = this.getSelectionButtonLabel();
    if (label === 'Select') {
      this.selectionMode = 'selecting';
      this.selectedOrder = [];
    } else if (label === 'Select All') {
      this.selectionMode = 'selecting';
      this.selectedOrder = this.files.map((f) => f.filename);
      void this.preloadSelectedPreviews();
    } else {
      this.selectionMode = 'none';
      this.selectedOrder = [];
    }
    this.notify();
  }

  public selectSingleFile(filename: string): void {
    const exists = this.files.some((f) => f.filename === filename);
    if (!exists) return;
    this.activeFilename = filename;
    this.notify();
    void this.loadPreview(filename);
  }

  public toggleFileSelection(filename: string): void {
    if (this.selectionMode !== 'selecting') {
      this.selectSingleFile(filename);
      return;
    }
    const idx = this.selectedOrder.indexOf(filename);
    if (idx >= 0) {
      this.selectedOrder.splice(idx, 1);
      if (this.activeFilename === filename && this.selectedOrder.length > 0) {
        this.activeFilename = this.selectedOrder[0];
      }
    } else {
      this.selectedOrder.push(filename);
      this.activeFilename = filename;
    }
    this.notify();
    void this.loadPreview(filename);
  }

  public promoteSelectedToFront(filename: string): void {
    const idx = this.selectedOrder.indexOf(filename);
    if (idx > 0) {
      this.selectedOrder.splice(idx, 1);
      this.selectedOrder.unshift(filename);
    }
    this.activeFilename = filename;
    this.notify();
    void this.loadPreview(filename);
  }

  public setTool(tool: StudioTool): void {
    this.tool = tool;
    this.notify();
  }

  public setSliderPercent(percent: number): void {
    this.sliderPercent = Math.max(0, Math.min(100, percent));
    this.notify();
  }

  public buildProcessParams(): StudioProcessParams {
    switch (this.tool) {
      case 'upscale':
        return { scale: this.upscaleScale };
      case 'enhance':
        return {};
      case 'remove_bg':
        return {
          bg_mode: this.removeBgMode,
          bg_color: this.removeBgMode === 'color' ? this.removeBgColor : null,
        };
      case 'blur_bg':
        return { level: Math.max(1, Math.min(100, Math.round(this.blurLevel))) };
      case 'resize': {
        const w = parseInt(this.resizeWidth, 10);
        const h = parseInt(this.resizeHeight, 10);
        return {
          width: Number.isFinite(w) && w > 0 ? w : null,
          height: Number.isFinite(h) && h > 0 ? h : null,
          keep_aspect: this.resizeKeepAspect,
        };
      }
    }
  }

  // --- Worker RPC Operations ---

  public async refreshFiles(): Promise<void> {
    if (!this.client || !this.client.isConnected()) return;
    const reply = await this.client.request('studio.list_files', null);
    const { meta, binary } = decodeEnvelope<StudioListFilesResult>(reply.payload);

    this.revokeAllThumbUrls();
    this.workingDir = meta.working_dir;
    this.accelerator = meta.accelerator;
    this.onnxProviders = meta.onnx_providers;
    this.files = meta.files.map((entry) => {
      let thumbUrl: string | null = null;
      if (entry.thumb_length > 0) {
        const slice = sliceToUint8Array(binary, entry.thumb_offset, entry.thumb_length);
        thumbUrl = this.createObjectUrl(slice, entry.thumb_mime);
      }
      return { ...entry, thumbUrl };
    });

    const validSet = new Set(this.files.map((f) => f.filename));
    this.selectedOrder = this.selectedOrder.filter((name) => validSet.has(name));
    if (!this.activeFilename || !validSet.has(this.activeFilename)) {
      this.activeFilename = this.files[0]?.filename ?? null;
    }

    this.notify();
    if (this.activeFilename) {
      await this.loadPreview(this.activeFilename);
    } else {
      this.clearPreviewCache();
    }
  }

  public async uploadFiles(
    items: Array<{ name: string; bytes: Uint8Array }>
  ): Promise<number> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    const valid = items.filter((item) => isSupportedImageFilename(item.name));
    const skipped = items.length - valid.length;
    if (valid.length === 0) {
      if (skipped > 0) {
        this.toast('Ignored unsupported file types. Use PNG, JPG, WEBP, BMP, or TIFF.', true);
      }
      return 0;
    }

    this.isUploading = true;
    this.notify();
    let uploadedCount = 0;
    let lastUploadedName: string | null = null;

    try {
      for (const item of valid) {
        const cleanName = item.name.split(/[\\/]/).pop() || item.name;
        const reply = await this.client.request(
          'studio.upload_files',
          { filename: cleanName, overwrite: true },
          item.bytes
        );
        const { meta } = decodeEnvelope<StudioUploadResult>(reply.payload);
        this.invalidatePreview(meta.file.filename);
        lastUploadedName = meta.file.filename;
        uploadedCount += 1;
      }

      if (lastUploadedName) {
        this.activeFilename = lastUploadedName;
      }
      await this.refreshFiles();

      if (skipped > 0) {
        this.toast(`Uploaded ${uploadedCount} image(s); skipped ${skipped} non-image file(s).`);
      } else {
        this.toast(`Uploaded ${uploadedCount} image(s) to workspace.`);
      }
      return uploadedCount;
    } finally {
      this.isUploading = false;
      this.notify();
    }
  }

  public async loadPreview(filename: string, forceRefresh = false): Promise<StudioPreviewUrls | null> {
    if (!this.client || !this.client.isConnected()) return null;
    if (!forceRefresh && this.previewCache.has(filename)) {
      const cached = this.previewCache.get(filename)!;
      if (this.activeFilename === filename) {
        this.activePreview = cached;
      }
      this.notify();
      return cached;
    }

    const reqId = ++this.previewRequestVersion;
    const reply = await this.client.request('studio.get_image', {
      filename,
      variant: 'both',
    });
    const { meta, binary } = decodeEnvelope<StudioGetImageResult>(reply.payload);

    let originalUrl: string | null = null;
    let outputUrl: string | null = null;
    if (meta.original_length > 0) {
      const origSlice = sliceToUint8Array(binary, meta.original_offset, meta.original_length);
      originalUrl = this.createObjectUrl(origSlice, meta.original_mime);
    }
    if (meta.is_processed && meta.output_length > 0 && meta.output_mime) {
      const outSlice = sliceToUint8Array(binary, meta.output_offset, meta.output_length);
      outputUrl = this.createObjectUrl(outSlice, meta.output_mime);
    }

    const preview: StudioPreviewUrls = {
      filename: meta.filename,
      isProcessed: meta.is_processed,
      originalUrl,
      outputUrl,
      outputFilename: meta.output_filename ?? null,
    };

    const old = this.previewCache.get(meta.filename);
    if (old) {
      if (old.originalUrl) this.revokeObjectUrl(old.originalUrl);
      if (old.outputUrl) this.revokeObjectUrl(old.outputUrl);
    }
    this.previewCache.set(meta.filename, preview);
    if (this.activeFilename === meta.filename || reqId === this.previewRequestVersion) {
      this.activePreview = preview;
    }
    this.notify();
    return preview;
  }

  private async preloadSelectedPreviews(): Promise<void> {
    const targets = this.selectedOrder.slice(0, 6);
    for (const name of targets) {
      if (!this.previewCache.has(name)) {
        try {
          await this.loadPreview(name);
        } catch {
          // Non-fatal preload failure
        }
      }
    }
  }

  public async processCurrent(): Promise<void> {
    if (!this.activeFilename) return;
    await this.runProcess([this.activeFilename]);
  }

  public async processSelected(): Promise<void> {
    if (this.selectedOrder.length === 0) return;
    await this.runProcess([...this.selectedOrder]);
  }

  private async runProcess(filenames: string[]): Promise<void> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    if (filenames.length === 0) return;

    const jobId = `job-${Date.now()}`;
    const payloadMeta: StudioProcessMeta = {
      filenames,
      tool: this.tool,
      params: this.buildProcessParams(),
      output_format: this.outputFormat,
      job_id: jobId,
    };

    this.isProcessing = true;
    this.progress = {
      job_id: jobId,
      filename: filenames[0],
      index: 0,
      total: filenames.length,
      percent: 0,
      stage: 'starting',
    };
    this.notify();

    try {
      const reply = await this.client.request('studio.process', payloadMeta);
      const { meta } = decodeEnvelope<StudioProcessResult>(reply.payload);
      for (const f of meta.processed_files) {
        this.invalidatePreview(f.filename);
      }
      await this.refreshFiles();
      if (this.activeFilename) {
        await this.loadPreview(this.activeFilename, true);
      }
      if (this.selectionMode === 'selecting' && this.selectedOrder.length > 1) {
        await this.preloadSelectedPreviews();
      }
      this.toast(
        `Processed ${meta.processed_files.length} image(s) with ${this.tool}.`
      );
    } finally {
      this.isProcessing = false;
      this.progress = null;
      this.notify();
    }
  }

  public async restoreSingle(filename: string): Promise<void> {
    if (!this.client || !this.client.isConnected()) return;
    const reply = await this.client.request('studio.restore', {
      filename,
      restore_all: false,
    });
    const { meta } = decodeEnvelope<StudioRestoreResult>(reply.payload);
    this.invalidatePreview(filename);
    await this.refreshFiles();
    if (this.activeFilename === filename) {
      await this.loadPreview(filename, true);
    }
    if (meta.restored_count > 0) {
      this.toast(`Restored '${filename}' to original.`);
    }
  }

  public async restoreAll(): Promise<void> {
    if (!this.client || !this.client.isConnected()) return;
    const reply = await this.client.request('studio.restore', {
      filename: null,
      restore_all: true,
    });
    const { meta } = decodeEnvelope<StudioRestoreResult>(reply.payload);
    this.clearPreviewCache();
    await this.refreshFiles();
    if (this.activeFilename) {
      await this.loadPreview(this.activeFilename, true);
    }
    this.toast(`Restored ${meta.restored_count} image(s) to original.`);
  }

  public async fetchOutputFileBlob(
    filename: string
  ): Promise<{ filename: string; blob: Blob }> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    const reply = await this.client.request('studio.get_image', {
      filename,
      variant: 'output',
    });
    const { meta, binary } = decodeEnvelope<StudioGetImageResult>(reply.payload);
    if (!meta.is_processed || meta.output_length <= 0 || !meta.output_mime) {
      throw new Error(`No processed output available for '${filename}'.`);
    }
    const slice = sliceToUint8Array(binary, meta.output_offset, meta.output_length);
    return {
      filename: meta.output_filename || filename,
      blob: uint8ArrayToBlob(slice, meta.output_mime),
    };
  }

  public async fetchAllOutputZip(): Promise<{ filename: string; blob: Blob; fileCount: number }> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    const reply = await this.client.request('studio.download_zip', null);
    const { meta, binary } = decodeEnvelope<StudioDownloadZipResult>(reply.payload);
    return {
      filename: meta.filename || 'ai-photo-studio-output.zip',
      blob: uint8ArrayToBlob(binary, 'application/zip'),
      fileCount: meta.file_count,
    };
  }
}
