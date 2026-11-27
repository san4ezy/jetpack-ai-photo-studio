import type { JetPackAppClient } from '@jetpack-desktop/client';
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
  StudioOpenFolderResult,
  StudioProcessMeta,
  StudioProcessParams,
  StudioProcessProgress,
  StudioProcessResult,
  StudioRestoreResult,
  StudioUploadResult,
} from './jetpack-env.js';

export type StudioTool = 'upscale' | 'enhance' | 'remove_bg' | 'blur_bg' | 'crop' | 'resize';
export type StudioOutputFormat = 'auto' | 'png' | 'jpg' | 'webp';
export type SelectionButtonLabel = 'Select' | 'Select All' | 'Reset';
export type ProjectViewMode = 'list' | 'grid';
export type CanvasZoomMode = 'auto' | 'manual';
export type CropAspectPresetId = '1:1' | '4:5' | '9:16' | '16:9' | '4:3' | '3:2';
export type ResizeAspectPresetId = CropAspectPresetId;
export type CropMode = 'keep_aspect' | CropAspectPresetId | 'custom';
export type ResizeMode = 'keep_aspect' | 'custom';

export interface NormalizedCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampCropRect(rect: NormalizedCropRect): NormalizedCropRect {
  const w = Math.max(0.0001, Math.min(1, Number.isFinite(rect.w) ? rect.w : 1));
  const h = Math.max(0.0001, Math.min(1, Number.isFinite(rect.h) ? rect.h : 1));
  const x = Math.max(0, Math.min(1 - w, Number.isFinite(rect.x) ? rect.x : 0));
  const y = Math.max(0, Math.min(1 - h, Number.isFinite(rect.y) ? rect.y : 0));
  return { x, y, w, h };
}

export function computeCenteredCropRect(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): NormalizedCropRect {
  if (srcWidth <= 0 || srcHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const srcRatio = srcWidth / srcHeight;
  const targetRatio = targetWidth / targetHeight;
  if (Math.abs(srcRatio - targetRatio) < 0.001) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  if (srcRatio > targetRatio) {
    const w = Math.min(1, targetRatio / srcRatio);
    return clampCropRect({
      x: (1 - w) / 2,
      y: 0,
      w,
      h: 1,
    });
  }
  const h = Math.min(1, srcRatio / targetRatio);
  return clampCropRect({
    x: 0,
    y: (1 - h) / 2,
    w: 1,
    h,
  });
}

export interface CropAspectPreset {
  id: CropAspectPresetId;
  label: string;
  width: number;
  height: number;
  description: string;
}

export const CROP_ASPECT_PRESETS: ReadonlyArray<CropAspectPreset> = [
  {
    id: '1:1',
    label: '1:1',
    width: 1080,
    height: 1080,
    description: '1:1 · Квадрат (Instagram Post)',
  },
  {
    id: '4:5',
    label: '4:5',
    width: 1080,
    height: 1350,
    description: '4:5 · Портрет (Instagram Feed)',
  },
  {
    id: '9:16',
    label: '9:16',
    width: 1080,
    height: 1920,
    description: '9:16 · Stories / Reels / TikTok',
  },
  {
    id: '16:9',
    label: '16:9',
    width: 1920,
    height: 1080,
    description: '16:9 · Широкий формат / YouTube',
  },
  {
    id: '4:3',
    label: '4:3',
    width: 1440,
    height: 1080,
    description: '4:3 · Стандарт',
  },
  {
    id: '3:2',
    label: '3:2',
    width: 1500,
    height: 1000,
    description: '3:2 · Класичне фото',
  },
];

export const RESIZE_ASPECT_PRESETS = CROP_ASPECT_PRESETS;

export function computeMaxCropPixelDimensions(
  srcWidth: number,
  srcHeight: number,
  mode: CropMode
): { width: number; height: number } {
  const sw = Math.max(1, Math.round(srcWidth));
  const sh = Math.max(1, Math.round(srcHeight));
  if (mode === 'keep_aspect' || mode === 'custom') {
    return { width: sw, height: sh };
  }
  const preset = CROP_ASPECT_PRESETS.find((p) => p.id === mode);
  if (!preset) {
    return { width: sw, height: sh };
  }
  const targetRatio = preset.width / preset.height;
  const srcRatio = sw / sh;
  if (Math.abs(srcRatio - targetRatio) < 0.0005) {
    return { width: sw, height: sh };
  }
  if (srcRatio > targetRatio) {
    return {
      width: Math.max(1, Math.min(sw, Math.round(sh * targetRatio))),
      height: sh,
    };
  }
  return {
    width: sw,
    height: Math.max(1, Math.min(sh, Math.round(sw / targetRatio))),
  };
}

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 8.0;

export function clampCanvasZoom(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, scale));
}

export function computeFitCanvasScale(
  naturalWidth: number,
  naturalHeight: number,
  availableWidth: number,
  availableHeight: number
): number {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return 1;
  }
  return clampCanvasZoom(Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight));
}

export function computeInitialCanvasScale(
  naturalWidth: number,
  naturalHeight: number,
  availableWidth: number,
  availableHeight: number
): number {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return 1;
  }
  if (naturalWidth <= availableWidth && naturalHeight <= availableHeight) {
    return 1;
  }
  return computeFitCanvasScale(naturalWidth, naturalHeight, availableWidth, availableHeight);
}

export interface StudioFileVersion {
  id: string;
  variant: 'original' | 'output';
  label: string;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
  dpiX: number | null;
  dpiY: number | null;
  colorMode: string | null;
  isOriginal: boolean;
  isActiveWork: boolean;
  canDelete: boolean;
}

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
  copyToClipboard?: (text: string) => Promise<boolean> | boolean;
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

async function defaultCopyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    if (typeof document !== 'undefined' && document.body) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return Boolean(ok);
    }
  } catch {
    // Ignore clipboard fallback error
  }
  return false;
}

export class StudioController {
  private client: StudioRpcClient | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private readonly hooks: StudioControllerHooks;
  private readonly createObjectUrl: (bytes: Uint8Array, mimeType: string) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly copyToClipboardHook: (text: string) => Promise<boolean> | boolean;

  public files: StudioFileView[] = [];
  public workingDir: string = '';
  public accelerator: string = 'cpu';
  public onnxProviders: string[] = ['CPUExecutionProvider'];
  public activeFilename: string | null = null;
  public selectionMode: 'none' | 'selecting' = 'none';
  public selectedOrder: string[] = [];
  public projectViewMode: ProjectViewMode = 'list';

  public tool: StudioTool = 'upscale';
  public upscaleScale: 2 | 4 = 2;
  public removeBgMode: 'transparent' | 'color' = 'transparent';
  public removeBgColor: string = '#0a84ff';
  public blurLevel: number = 40;

  public cropMode: CropMode = 'keep_aspect';
  public cropWidth: string = '';
  public cropHeight: string = '';
  public cropAspectPreset: CropAspectPresetId | null = null;
  public cropRect: NormalizedCropRect | null = null;
  public cropCustomMoved: boolean = false;

  public resizeMode: ResizeMode = 'keep_aspect';
  public resizeWidth: string = '1024';
  public resizeHeight: string = '';

  public outputFormat: StudioOutputFormat = 'auto';

  public isWorkerRunning: boolean = false;
  public isUploading: boolean = false;
  public isProcessing: boolean = false;
  public progress: StudioProcessProgress | null = null;
  public sliderPercent: number = 50;
  public canvasZoomMode: CanvasZoomMode = 'auto';
  public canvasZoom: number = 1;

  private activePreview: StudioPreviewUrls | null = null;
  private previewCache = new Map<string, StudioPreviewUrls>();
  private previewRequestVersion = 0;
  private lastSyncedSourceKey: string = '';

  constructor(hooks: StudioControllerHooks = {}) {
    this.hooks = hooks;
    this.createObjectUrl = hooks.createObjectUrl ?? defaultCreateObjectUrl;
    this.revokeObjectUrl = hooks.revokeObjectUrl ?? defaultRevokeObjectUrl;
    this.copyToClipboardHook = hooks.copyToClipboard ?? defaultCopyToClipboard;
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
    const changed = this.activeFilename !== filename;
    if (changed) {
      this.canvasZoomMode = 'auto';
    }
    this.activeFilename = filename;
    if (changed) {
      this.syncTransformDefaultsForActiveFile(true);
    }
    this.notify();
    void this.loadPreview(filename);
  }

  public toggleFileSelection(filename: string): void {
    if (this.selectionMode !== 'selecting') {
      this.selectSingleFile(filename);
      return;
    }
    const prevActive = this.activeFilename;
    const idx = this.selectedOrder.indexOf(filename);
    if (idx >= 0) {
      this.selectedOrder.splice(idx, 1);
      if (this.activeFilename === filename && this.selectedOrder.length > 0) {
        this.activeFilename = this.selectedOrder[0];
        this.canvasZoomMode = 'auto';
      }
    } else {
      this.selectedOrder.push(filename);
      if (this.activeFilename !== filename) {
        this.canvasZoomMode = 'auto';
      }
      this.activeFilename = filename;
    }
    if (this.activeFilename !== prevActive) {
      this.syncTransformDefaultsForActiveFile(true);
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
    const changed = this.activeFilename !== filename;
    if (changed) {
      this.canvasZoomMode = 'auto';
    }
    this.activeFilename = filename;
    if (changed) {
      this.syncTransformDefaultsForActiveFile(true);
    }
    this.notify();
    void this.loadPreview(filename);
  }

  public setProjectViewMode(mode: ProjectViewMode): void {
    if (this.projectViewMode === mode) return;
    this.projectViewMode = mode;
    this.notify();
  }

  public toggleProjectViewMode(): void {
    this.projectViewMode = this.projectViewMode === 'list' ? 'grid' : 'list';
    this.notify();
  }

  public getEffectiveCanvasScale(
    naturalWidth: number,
    naturalHeight: number,
    availableWidth: number,
    availableHeight: number
  ): number {
    if (this.canvasZoomMode === 'auto') {
      return computeInitialCanvasScale(
        naturalWidth,
        naturalHeight,
        availableWidth,
        availableHeight
      );
    }
    return clampCanvasZoom(this.canvasZoom);
  }

  public zoomIn(currentEffectiveScale?: number): void {
    const base = currentEffectiveScale ?? this.canvasZoom;
    this.canvasZoomMode = 'manual';
    this.canvasZoom = clampCanvasZoom(base * 1.25);
    this.notify();
  }

  public zoomOut(currentEffectiveScale?: number): void {
    const base = currentEffectiveScale ?? this.canvasZoom;
    this.canvasZoomMode = 'manual';
    this.canvasZoom = clampCanvasZoom(base / 1.25);
    this.notify();
  }

  public resetZoom(): void {
    this.canvasZoomMode = 'auto';
    this.canvasZoom = 1;
    this.notify();
  }

  public setZoomExact(scale: number): void {
    this.canvasZoomMode = 'manual';
    this.canvasZoom = clampCanvasZoom(scale);
    this.notify();
  }

  public fitToWorkspace(
    naturalWidth: number,
    naturalHeight: number,
    availableWidth: number,
    availableHeight: number
  ): void {
    this.canvasZoomMode = 'manual';
    this.canvasZoom = computeFitCanvasScale(
      naturalWidth,
      naturalHeight,
      availableWidth,
      availableHeight
    );
    this.notify();
  }

  public getFileVersions(file: StudioFileEntry): StudioFileVersion[] {
    const versions: StudioFileVersion[] = [
      {
        id: 'original',
        variant: 'original',
        label: 'Оригінал',
        filename: file.filename,
        width: file.width,
        height: file.height,
        sizeBytes: file.size_bytes,
        mimeType: file.mime_type,
        dpiX: file.dpi_x ?? null,
        dpiY: file.dpi_y ?? null,
        colorMode: file.color_mode ?? null,
        isOriginal: true,
        isActiveWork: !file.is_processed,
        canDelete: false,
      },
    ];
    if (file.is_processed && file.output_filename) {
      versions.push({
        id: 'output',
        variant: 'output',
        label: 'Оброблений',
        filename: file.output_filename,
        width: file.output_width ?? file.width,
        height: file.output_height ?? file.height,
        sizeBytes: file.output_size_bytes ?? file.size_bytes,
        mimeType: file.output_mime_type ?? file.mime_type,
        dpiX: file.output_dpi_x ?? null,
        dpiY: file.output_dpi_y ?? null,
        colorMode: file.output_color_mode ?? null,
        isOriginal: false,
        isActiveWork: true,
        canDelete: true,
      });
    }
    return versions;
  }

  public getVersionCount(file: StudioFileEntry): number {
    return this.getFileVersions(file).length;
  }

  public setTool(tool: StudioTool): void {
    this.tool = tool;
    if (tool === 'crop' || tool === 'resize') {
      this.syncTransformDefaultsForActiveFile(false);
    }
    this.notify();
  }

  public setOutputFormat(format: StudioOutputFormat): void {
    if (this.outputFormat === format) return;
    this.outputFormat = format;
    this.notify();
  }

  public setSliderPercent(percent: number): void {
    this.sliderPercent = Math.max(0, Math.min(100, percent));
    this.notify();
  }

  public getActiveSourceDimensions(): { width: number; height: number } | null {
    const active = this.activeFile;
    if (!active) return null;
    const width = Math.max(
      1,
      active.is_processed && active.output_width ? active.output_width : active.width
    );
    const height = Math.max(
      1,
      active.is_processed && active.output_height ? active.output_height : active.height
    );
    return { width, height };
  }

  private getCropAspectRatio(srcWidth: number, srcHeight: number): number {
    if (this.cropMode === 'keep_aspect') {
      return Math.max(1, srcWidth) / Math.max(1, srcHeight);
    }
    const preset = CROP_ASPECT_PRESETS.find((p) => p.id === this.cropMode);
    if (preset) {
      return preset.width / preset.height;
    }
    return Math.max(1, srcWidth) / Math.max(1, srcHeight);
  }

  private syncTransformDefaultsForActiveFile(force = false): void {
    const src = this.getActiveSourceDimensions();
    if (!src) {
      this.lastSyncedSourceKey = '';
      return;
    }
    const srcKey = `${this.activeFilename ?? ''}|${src.width}x${src.height}`;
    const sourceChanged = force || srcKey !== this.lastSyncedSourceKey;
    this.lastSyncedSourceKey = srcKey;

    if (sourceChanged) {
      this.cropRect = null;
      this.cropCustomMoved = false;
      const cropDims = computeMaxCropPixelDimensions(src.width, src.height, this.cropMode);
      this.cropWidth = String(cropDims.width);
      this.cropHeight = String(cropDims.height);
      this.resizeWidth = String(src.width);
      this.resizeHeight = String(src.height);
      return;
    }

    if (!this.cropWidth || !this.cropHeight) {
      const cropDims = computeMaxCropPixelDimensions(src.width, src.height, this.cropMode);
      this.cropWidth = String(cropDims.width);
      this.cropHeight = String(cropDims.height);
    }
    if (!this.resizeWidth || !this.resizeHeight) {
      this.resizeWidth = String(src.width);
      this.resizeHeight = String(src.height);
    }
  }

  // --- Crop Tool Controls ---

  public setCropMode(mode: CropMode): void {
    this.cropMode = mode;
    this.cropAspectPreset = mode !== 'keep_aspect' && mode !== 'custom' ? mode : null;
    this.cropRect = null;
    this.cropCustomMoved = false;
    const src = this.getActiveSourceDimensions();
    if (src) {
      const dims = computeMaxCropPixelDimensions(src.width, src.height, mode);
      this.cropWidth = String(dims.width);
      this.cropHeight = String(dims.height);
    } else if (mode !== 'keep_aspect' && mode !== 'custom') {
      const preset = CROP_ASPECT_PRESETS.find((p) => p.id === mode);
      this.cropWidth = String(preset?.width ?? 1080);
      this.cropHeight = String(preset?.height ?? 1080);
    } else {
      this.cropWidth = this.cropWidth || '1080';
      this.cropHeight = this.cropHeight || '1080';
    }
    this.notify();
  }

  public applyCropPreset(presetId: CropAspectPresetId): void {
    this.setCropMode(presetId);
  }

  public setCropWidthInput(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.cropWidth = raw;
      this.notify();
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.cropWidth = raw;
      this.notify();
      return;
    }

    const src = this.getActiveSourceDimensions();
    if (this.cropMode === 'custom') {
      const maxW = src ? src.width : parsed;
      this.cropWidth = String(Math.max(1, Math.min(maxW, parsed)));
    } else {
      const sw = src ? src.width : 1080;
      const sh = src ? src.height : 1080;
      const maxDims = computeMaxCropPixelDimensions(sw, sh, this.cropMode);
      const ratio = this.getCropAspectRatio(sw, sh);
      const w = Math.max(1, Math.min(maxDims.width, parsed));
      const h = Math.max(1, Math.min(maxDims.height, Math.round(w / ratio)));
      this.cropWidth = String(w);
      this.cropHeight = String(h);
    }
    this.notify();
  }

  public setCropHeightInput(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.cropHeight = raw;
      this.notify();
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.cropHeight = raw;
      this.notify();
      return;
    }

    const src = this.getActiveSourceDimensions();
    if (this.cropMode === 'custom') {
      const maxH = src ? src.height : parsed;
      this.cropHeight = String(Math.max(1, Math.min(maxH, parsed)));
    } else {
      const sw = src ? src.width : 1080;
      const sh = src ? src.height : 1080;
      const maxDims = computeMaxCropPixelDimensions(sw, sh, this.cropMode);
      const ratio = this.getCropAspectRatio(sw, sh);
      const h = Math.max(1, Math.min(maxDims.height, parsed));
      const w = Math.max(1, Math.min(maxDims.width, Math.round(h * ratio)));
      this.cropHeight = String(h);
      this.cropWidth = String(w);
    }
    this.notify();
  }

  public normalizeCropInputs(): void {
    const src = this.getActiveSourceDimensions();
    if (!src) return;
    const w = parseInt(this.cropWidth, 10);
    const h = parseInt(this.cropHeight, 10);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      const rect = this.getEffectiveCropRect(src.width, src.height);
      this.cropWidth = String(Math.max(1, Math.round(rect.w * src.width)));
      this.cropHeight = String(Math.max(1, Math.round(rect.h * src.height)));
      this.notify();
    }
  }

  public getEffectiveCropRect(srcWidth: number, srcHeight: number): NormalizedCropRect {
    const sw = Math.max(1, Math.round(srcWidth));
    const sh = Math.max(1, Math.round(srcHeight));
    const maxDims = computeMaxCropPixelDimensions(sw, sh, this.cropMode);
    const rawW = parseInt(this.cropWidth, 10);
    const rawH = parseInt(this.cropHeight, 10);

    let pxW = Number.isFinite(rawW) && rawW > 0 ? Math.min(sw, rawW) : maxDims.width;
    let pxH = Number.isFinite(rawH) && rawH > 0 ? Math.min(sh, rawH) : maxDims.height;

    if (this.cropMode !== 'custom') {
      const ratio = this.getCropAspectRatio(sw, sh);
      if (pxW > maxDims.width) {
        pxW = maxDims.width;
        pxH = maxDims.height;
      } else if (pxH > maxDims.height) {
        pxH = maxDims.height;
        pxW = maxDims.width;
      } else if (Math.abs(pxW / Math.max(1, pxH) - ratio) > 0.02) {
        pxH = Math.max(1, Math.min(maxDims.height, Math.round(pxW / ratio)));
      }
    }

    const wNorm = Math.min(1, pxW / sw);
    const hNorm = Math.min(1, pxH / sh);
    if (this.cropCustomMoved && this.cropRect) {
      return clampCropRect({
        x: this.cropRect.x,
        y: this.cropRect.y,
        w: wNorm,
        h: hNorm,
      });
    }
    return clampCropRect({
      x: (1 - wNorm) / 2,
      y: (1 - hNorm) / 2,
      w: wNorm,
      h: hNorm,
    });
  }

  public setCropPosition(
    x: number,
    y: number,
    srcWidth: number,
    srcHeight: number,
    notifyChange = true
  ): NormalizedCropRect {
    const current = this.getEffectiveCropRect(srcWidth, srcHeight);
    const next = clampCropRect({ x, y, w: current.w, h: current.h });
    this.cropRect = next;
    this.cropCustomMoved = true;
    if (notifyChange) {
      this.notify();
    }
    return next;
  }

  // --- Resize Tool Controls ---

  public setResizeMode(mode: ResizeMode): void {
    this.resizeMode = mode;
    const src = this.getActiveSourceDimensions();

    if (mode === 'keep_aspect') {
      if (src) {
        this.resizeWidth = String(src.width);
        this.resizeHeight = String(src.height);
      } else {
        this.resizeWidth = this.resizeWidth || '1024';
        this.resizeHeight = this.resizeHeight || '1024';
      }
    } else {
      const w = parseInt(this.resizeWidth, 10);
      const h = parseInt(this.resizeHeight, 10);
      if (!Number.isFinite(w) || w <= 0) {
        this.resizeWidth = String(src?.width ?? 1024);
      }
      if (!Number.isFinite(h) || h <= 0) {
        this.resizeHeight = String(src?.height ?? 1024);
      }
    }
    this.notify();
  }

  public setResizeWidthInput(raw: string): void {
    this.resizeWidth = raw;
    if (this.resizeMode === 'keep_aspect') {
      const w = parseInt(raw, 10);
      const src = this.getActiveSourceDimensions();
      if (Number.isFinite(w) && w > 0 && src) {
        this.resizeHeight = String(Math.max(1, Math.round((w * src.height) / src.width)));
      }
    }
    this.notify();
  }

  public setResizeHeightInput(raw: string): void {
    this.resizeHeight = raw;
    if (this.resizeMode === 'keep_aspect') {
      const h = parseInt(raw, 10);
      const src = this.getActiveSourceDimensions();
      if (Number.isFinite(h) && h > 0 && src) {
        this.resizeWidth = String(Math.max(1, Math.round((h * src.width) / src.height)));
      }
    }
    this.notify();
  }

  public buildProcessParams(forBatch = false): StudioProcessParams {
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
      case 'crop': {
        const w = parseInt(this.cropWidth, 10);
        const h = parseInt(this.cropHeight, 10);
        const width = Number.isFinite(w) && w > 0 ? w : null;
        const height = Number.isFinite(h) && h > 0 ? h : null;
        const apiCropMode =
          this.cropMode === 'keep_aspect'
            ? 'keep_aspect'
            : this.cropMode === 'custom'
              ? 'custom'
              : 'ratio';

        if (!forBatch) {
          const src = this.getActiveSourceDimensions();
          if (src) {
            const rect = this.getEffectiveCropRect(src.width, src.height);
            return {
              width,
              height,
              crop_mode: apiCropMode,
              crop_x: rect.x,
              crop_y: rect.y,
              crop_w: rect.w,
              crop_h: rect.h,
            };
          }
        }

        if (apiCropMode === 'ratio') {
          const preset = CROP_ASPECT_PRESETS.find((p) => p.id === this.cropMode);
          return {
            width: preset?.width ?? width,
            height: preset?.height ?? height,
            crop_mode: 'ratio',
            crop_x: null,
            crop_y: null,
            crop_w: null,
            crop_h: null,
          };
        }

        return {
          width: apiCropMode === 'keep_aspect' ? null : width,
          height: apiCropMode === 'keep_aspect' ? null : height,
          crop_mode: apiCropMode,
          crop_x: null,
          crop_y: null,
          crop_w: null,
          crop_h: null,
        };
      }
      case 'resize': {
        const w = parseInt(this.resizeWidth, 10);
        const h = parseInt(this.resizeHeight, 10);
        const width = Number.isFinite(w) && w > 0 ? w : null;
        const height = Number.isFinite(h) && h > 0 ? h : null;
        if (this.resizeMode === 'keep_aspect') {
          return {
            width,
            height,
            keep_aspect: true,
            fit_mode: 'contain',
            crop_x: null,
            crop_y: null,
            crop_w: null,
            crop_h: null,
          };
        }
        return {
          width,
          height,
          keep_aspect: false,
          fit_mode: 'stretch',
          crop_x: null,
          crop_y: null,
          crop_w: null,
          crop_h: null,
        };
      }
    }
  }

  // --- Worker RPC Operations ---

  public async refreshFiles(): Promise<void> {
    if (!this.client || !this.client.isConnected()) return;
    const reply = await this.client.request('studio.list_files', null);
    const { meta, binary } = decodeEnvelope<StudioListFilesResult>(reply.payload);

    const prevActive = this.activeFilename;
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
    this.syncTransformDefaultsForActiveFile(this.activeFilename !== prevActive);

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

      let uploadedActiveChanged = false;
      if (lastUploadedName) {
        if (this.activeFilename !== lastUploadedName) {
          this.canvasZoomMode = 'auto';
          uploadedActiveChanged = true;
        }
        this.activeFilename = lastUploadedName;
      }
      await this.refreshFiles();
      if (uploadedActiveChanged) {
        this.syncTransformDefaultsForActiveFile(true);
        this.notify();
      }

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
    const front = this.selectedOrder[0];
    if (!front || this.previewCache.has(front)) return;
    try {
      await this.loadPreview(front);
    } catch {
      // Non-fatal preload failure
    }
  }

  public async processCurrent(): Promise<void> {
    if (!this.activeFilename) return;
    await this.runProcess([this.activeFilename], false);
  }

  public async processSelected(): Promise<void> {
    if (this.selectedOrder.length === 0) return;
    await this.runProcess([...this.selectedOrder], true);
  }

  private async runProcess(filenames: string[], forBatch = false): Promise<void> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    if (filenames.length === 0) return;

    const jobId = `job-${Date.now()}`;
    const payloadMeta: StudioProcessMeta = {
      filenames,
      tool: this.tool,
      params: this.buildProcessParams(forBatch),
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
    return this.fetchVersionBlob(filename, 'output');
  }

  public async fetchVersionBlob(
    filename: string,
    variant: 'original' | 'output'
  ): Promise<{ filename: string; blob: Blob }> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    const reply = await this.client.request('studio.get_image', {
      filename,
      variant,
    });
    const { meta, binary } = decodeEnvelope<StudioGetImageResult>(reply.payload);
    if (variant === 'output') {
      if (!meta.is_processed || meta.output_length <= 0 || !meta.output_mime) {
        throw new Error(`No processed output available for '${filename}'.`);
      }
      const slice = sliceToUint8Array(binary, meta.output_offset, meta.output_length);
      return {
        filename: meta.output_filename || filename,
        blob: uint8ArrayToBlob(slice, meta.output_mime),
      };
    }
    if (meta.original_length <= 0) {
      throw new Error(`Original image bytes unavailable for '${filename}'.`);
    }
    const slice = sliceToUint8Array(binary, meta.original_offset, meta.original_length);
    return {
      filename: meta.filename || filename,
      blob: uint8ArrayToBlob(slice, meta.original_mime),
    };
  }

  public async takeVersionIntoWork(filename: string, versionId: string): Promise<void> {
    const file = this.files.find((f) => f.filename === filename);
    if (!file) return;
    if (this.selectionMode === 'selecting') {
      this.selectionMode = 'none';
      this.selectedOrder = [];
    }
    const changed = this.activeFilename !== filename;
    if (changed) {
      this.canvasZoomMode = 'auto';
    }
    this.activeFilename = filename;
    if (changed) {
      this.syncTransformDefaultsForActiveFile(true);
    }
    if (versionId === 'original' && file.is_processed) {
      await this.restoreSingle(filename);
      return;
    }
    this.notify();
    await this.loadPreview(filename);
  }

  public async deleteVersion(filename: string, versionId: string): Promise<void> {
    if (versionId !== 'output') {
      throw new Error('Базовий оригінал не можна видалити.');
    }
    await this.restoreSingle(filename);
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

  public async openProjectFolder(): Promise<StudioOpenFolderResult> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error('Worker is not connected.');
    }
    const reply = await this.client.request('studio.open_folder', null);
    const { meta } = decodeEnvelope<StudioOpenFolderResult>(reply.payload);
    const targetPath = meta.path || this.workingDir;
    if (meta.opened) {
      this.toast(`Папку проєкту відкрито: ${targetPath}`);
    } else {
      const copied = targetPath ? await this.copyToClipboardHook(targetPath) : false;
      if (copied) {
        this.toast(
          `Шлях скопійовано в буфер обміну: ${targetPath} — у Finder натисніть Cmd+Shift+G та вставте (Cmd+V).`
        );
      } else {
        this.toast(`Папка проєкту: ${targetPath}`);
      }
    }
    return meta;
  }
}
