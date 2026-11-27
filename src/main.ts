import './styles.css';
import type { JetPackAppClient } from '@jetpack/client';
import type { JetPackOpcodeMap, StudioFileEntry } from './jetpack-env';
import {
  computeFitCanvasScale,
  CROP_ASPECT_PRESETS,
  StudioController,
  type CropAspectPresetId,
  type CropMode,
  type ResizeMode,
  type StudioFileVersion,
  type StudioOutputFormat,
  type StudioTool,
} from './studio-controller';
import { connectStudioClient } from './wire';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDpi(dpiX?: number | null, dpiY?: number | null): string {
  if (!dpiX || !dpiY || dpiX <= 0 || dpiY <= 0) return 'Не задано';
  const rx = Number.isInteger(dpiX) ? String(dpiX) : dpiX.toFixed(1);
  const ry = Number.isInteger(dpiY) ? String(dpiY) : dpiY.toFixed(1);
  return rx === ry ? `${rx} DPI` : `${rx} × ${ry} DPI`;
}

function normalizeExtClass(ext: string): string {
  const lower = (ext || '').toLowerCase().replace(/^\./, '');
  if (lower === 'png') return 'png';
  if (lower === 'jpg' || lower === 'jpeg') return 'jpg';
  if (lower === 'webp') return 'webp';
  if (lower === 'bmp') return 'bmp';
  if (lower === 'tiff' || lower === 'tif') return 'tiff';
  return 'other';
}

function renderExtensionBadge(ext: string, extraClass = ''): string {
  const cls = normalizeExtClass(ext);
  const label = (ext || '?').toUpperCase().slice(0, 4);
  return `<span class="ext-badge ext-${cls} ${extraClass}">${escapeHtml(label)}</span>`;
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readDroppedEntries(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];

  const traverseEntry = async (entry: any): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (f: File) => {
            files.push(f);
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      await new Promise<void>((resolve) => {
        const readNext = () => {
          reader.readEntries(
            async (batch: any[]) => {
              if (!batch || batch.length === 0) {
                resolve();
                return;
              }
              for (const child of batch) {
                await traverseEntry(child);
              }
              readNext();
            },
            () => resolve()
          );
        };
        readNext();
      });
    }
  };

  if (items.some((it) => typeof (it as any).webkitGetAsEntry === 'function')) {
    for (const item of items) {
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) {
        await traverseEntry(entry);
      } else {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }

  return Array.from(dataTransfer.files);
}

const SVG_CHECKMARK = `
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
`;

const SVG_SELECT = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
`;

const SVG_SELECT_ALL = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 6 7 17l-5-5" />
    <path d="m22 10-7.5 7.5L13 16" />
  </svg>
`;

const SVG_RESET_SEL = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
`;

const SVG_WORK = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
`;

const SVG_DOWNLOAD = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
`;

const SVG_TRASH = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
`;

function renderResizePresetIcon(id: CropAspectPresetId): string {
  const rects: Record<CropAspectPresetId, string> = {
    '1:1': '<rect x="3" y="3" width="10" height="10" rx="1.6" />',
    '4:5': '<rect x="3.5" y="2" width="9" height="12" rx="1.6" />',
    '9:16': '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />',
    '16:9': '<rect x="1.5" y="4.5" width="13" height="7" rx="1.5" />',
    '4:3': '<rect x="2" y="3.5" width="12" height="9" rx="1.6" />',
    '3:2': '<rect x="1.5" y="4" width="13" height="8" rx="1.6" />',
  };
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${rects[id]}</svg>`;
}

const SVG_KEEP_ASPECT = `
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="1.8" />
    <path d="M5 10L11 6" />
    <polyline points="8.5 6 11 6 11 8.5" />
    <polyline points="7.5 10 5 10 5 7.5" />
  </svg>
`;

const SVG_CUSTOM_CROP = `
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" stroke-dasharray="2.4 2.2" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
`;

const SVG_CLOSE = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
`;

function bootstrapStudioApp(): void {
  const toastContainer = document.getElementById('toast-container')!;
  const connectionBanner = document.getElementById('connection-banner')!;
  const btnOpenFolder = document.getElementById('btn-open-folder') as HTMLButtonElement;
  const btnViewList = document.getElementById('btn-view-list') as HTMLButtonElement;
  const btnViewGrid = document.getElementById('btn-view-grid') as HTMLButtonElement;
  const btnSelectCycle = document.getElementById('btn-select-cycle') as HTMLButtonElement;
  const btnImportFolder = document.getElementById('btn-import-folder') as HTMLButtonElement;
  const btnAddFiles = document.getElementById('btn-add-files') as HTMLButtonElement;
  const fileInputMulti = document.getElementById('file-input-multi') as HTMLInputElement;
  const fileInputFolder = document.getElementById('file-input-folder') as HTMLInputElement;
  const dropzoneArea = document.getElementById('dropzone-area')!;
  const fileListEl = document.getElementById('file-list')!;
  const emptyDropHint = document.getElementById('empty-drop-hint')!;
  const workspaceSummary = document.getElementById('workspace-summary')!;
  const versionPopup = document.getElementById('version-popup')!;
  const fileInfoPopover = document.getElementById('file-info-popover')!;

  const toolButtons = document.getElementById('tool-buttons')!;
  const toolOptionsEl = document.getElementById('tool-options')!;
  const fileTypeGroup = document.getElementById('file-type-group')!;
  const btnProcess = document.getElementById('btn-process') as HTMLButtonElement;
  const btnProcessAll = document.getElementById('btn-process-all') as HTMLButtonElement;

  const previewStage = document.getElementById('preview-stage')!;
  const canvasViewport = document.getElementById('canvas-viewport')!;
  const canvasContent = document.getElementById('canvas-content')!;
  const imageOverlayActions = document.getElementById('image-overlay-actions')!;
  const btnImgDownload = document.getElementById('btn-img-download') as HTMLButtonElement;
  const btnImgRestore = document.getElementById('btn-img-restore') as HTMLButtonElement;
  const canvasHud = document.getElementById('canvas-hud')!;
  const canvasMinimap = document.getElementById('canvas-minimap')!;
  const minimapImg = document.getElementById('minimap-img') as HTMLImageElement;
  const minimapViewportRect = document.getElementById('minimap-viewport-rect')!;
  const zoomPercentReadout = document.getElementById('zoom-percent-readout')!;
  const btnZoomOut = document.getElementById('btn-zoom-out') as HTMLButtonElement;
  const btnZoomReset = document.getElementById('btn-zoom-reset') as HTMLButtonElement;
  const btnZoom100 = document.getElementById('btn-zoom-100') as HTMLButtonElement;
  const btnZoomIn = document.getElementById('btn-zoom-in') as HTMLButtonElement;

  const progressOverlay = document.getElementById('progress-overlay')!;
  const progressTitle = document.getElementById('progress-title')!;
  const progressPercent = document.getElementById('progress-percent')!;
  const progressBar = document.getElementById('progress-bar')!;
  const progressSub = document.getElementById('progress-sub')!;
  const statusLine = document.getElementById('status-line')!;
  const btnRestoreAll = document.getElementById('btn-restore-all') as HTMLButtonElement;
  const btnDownloadAll = document.getElementById('btn-download-all') as HTMLButtonElement;

  // Global suppression of native browser / webview context menu
  document.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
  });

  const showToast = (message: string, isError = false): void => {
    const el = document.createElement('div');
    el.className = `toast ${isError ? 'error' : ''}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    while (toastContainer.children.length > 4) {
      toastContainer.firstElementChild?.remove();
    }
    window.setTimeout(() => el.remove(), isError ? 7000 : 4500);
  };

  let appClient: JetPackAppClient<JetPackOpcodeMap> | null = null;
  let openVersionFilename: string | null = null;
  let lastToolOptionsKey = '';
  let lastCanvasRenderKey = '';
  let currentNaturalWidth = 0;
  let currentNaturalHeight = 0;
  let currentRenderedWidth = 0;
  let currentRenderedHeight = 0;
  let currentEffectiveScale = 1;
  let currentMinimapWidth = 0;
  let currentMinimapHeight = 0;

  const closeFileInfoPopover = (): void => {
    fileInfoPopover.hidden = true;
    fileInfoPopover.innerHTML = '';
  };

  const openFileInfoPopover = (file: StudioFileEntry, clientX: number, clientY: number): void => {
    const dimsOrig = `${file.width} × ${file.height} px`;
    const dimsOut =
      file.is_processed && file.output_width && file.output_height
        ? `${file.output_width} × ${file.output_height} px`
        : null;
    const dpiOrig = formatDpi(file.dpi_x, file.dpi_y);
    const dpiOut =
      file.is_processed && (file.output_dpi_x || file.output_dpi_y)
        ? formatDpi(file.output_dpi_x, file.output_dpi_y)
        : null;
    const modifiedText = file.modified_ms
      ? new Date(file.modified_ms).toLocaleString('uk-UA')
      : '—';
    const sourceLabel =
      file.source === 'workspace' || !file.source
        ? 'Робоча папка проєкту'
        : file.source;

    fileInfoPopover.innerHTML = `
      <div class="file-info-head">
        <span class="file-info-title" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</span>
        ${renderExtensionBadge(file.extension)}
      </div>
      <div class="file-info-grid">
        <span class="file-info-key">Розмір (px)</span>
        <span class="file-info-val">${escapeHtml(dimsOut ? `${dimsOrig} → ${dimsOut}` : dimsOrig)}</span>
        <span class="file-info-key">Обсяг</span>
        <span class="file-info-val">${escapeHtml(
          file.is_processed && file.output_size_bytes
            ? `${formatBytes(file.size_bytes)} → ${formatBytes(file.output_size_bytes)}`
            : formatBytes(file.size_bytes)
        )}</span>
        <span class="file-info-key">DPI</span>
        <span class="file-info-val">${escapeHtml(dpiOut && dpiOut !== dpiOrig ? `${dpiOrig} → ${dpiOut}` : dpiOrig)}</span>
        <span class="file-info-key">Колір</span>
        <span class="file-info-val">${escapeHtml(
          file.is_processed && file.output_color_mode && file.output_color_mode !== file.color_mode
            ? `${file.color_mode || '—'} → ${file.output_color_mode}`
            : file.color_mode || '—'
        )}</span>
        <span class="file-info-key">MIME</span>
        <span class="file-info-val">${escapeHtml(
          file.is_processed && file.output_mime_type ? file.output_mime_type : file.mime_type
        )}</span>
        <span class="file-info-key">Джерело</span>
        <span class="file-info-val">${escapeHtml(sourceLabel)}</span>
        <span class="file-info-key">Змінено</span>
        <span class="file-info-val">${escapeHtml(modifiedText)}</span>
        <span class="file-info-key">Статус</span>
        <span class="file-info-val">${
          file.is_processed && file.output_filename
            ? `Оброблено (${escapeHtml(file.output_filename)})`
            : 'Оригінал'
        }</span>
      </div>
    `;
    fileInfoPopover.hidden = false;

    const pad = 10;
    const w = fileInfoPopover.offsetWidth || 300;
    const h = fileInfoPopover.offsetHeight || 220;
    const left = Math.max(pad, Math.min(clientX + 8, window.innerWidth - w - pad));
    const top = Math.max(pad, Math.min(clientY + 8, window.innerHeight - h - pad));
    fileInfoPopover.style.left = `${left}px`;
    fileInfoPopover.style.top = `${top}px`;
  };

  const closeVersionPopup = (): void => {
    if (!openVersionFilename) return;
    openVersionFilename = null;
    versionPopup.hidden = true;
    versionPopup.innerHTML = '';
  };

  const renderVersionPopup = (): void => {
    if (!openVersionFilename) {
      versionPopup.hidden = true;
      return;
    }
    const file = controller.files.find((f) => f.filename === openVersionFilename);
    if (!file) {
      closeVersionPopup();
      return;
    }

    const versions: StudioFileVersion[] = controller.getFileVersions(file);
    const preview = controller.getPreviewFor(file.filename);
    versionPopup.hidden = false;
    versionPopup.innerHTML = `
      <div class="version-popup-header">
        <span class="version-popup-title" title="${escapeHtml(file.filename)}">Версії · ${escapeHtml(file.filename)} (${versions.length})</span>
        <button id="btn-close-version-popup" class="btn btn-ghost btn-icon-sm" type="button" title="Закрити" aria-label="Закрити вікно версій">
          ${SVG_CLOSE}
        </button>
      </div>
      <div class="version-popup-list">
        ${versions
          .map((v) => {
            const imgUrl =
              v.variant === 'output'
                ? preview?.outputUrl || file.thumbUrl || ''
                : preview?.originalUrl || file.thumbUrl || '';
            const ext = v.filename.split('.').pop() || file.extension;
            return `
              <div class="version-card ${v.isActiveWork ? 'is-working' : ''}">
                <div class="version-preview-box">
                  ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(v.label)}" />` : ''}
                </div>
                <div class="version-card-footer">
                  <div class="version-card-meta">
                    <div class="version-card-label">
                      <span>${escapeHtml(v.label)}</span>
                      ${renderExtensionBadge(ext)}
                      ${v.isActiveWork ? '<span class="badge badge-working">В роботі</span>' : ''}
                    </div>
                    <div class="version-card-sub">${v.width}×${v.height} · ${formatBytes(v.sizeBytes)}</div>
                  </div>
                  <div class="btn-group" role="group" aria-label="Дії з версією">
                    <button type="button" class="btn btn-accent-soft btn-icon-sm" data-ver-work="${escapeHtml(v.id)}" ${controller.isBusy ? 'disabled' : ''} title="Взяти в роботу" aria-label="Взяти в роботу">
                      ${SVG_WORK}
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon-sm" data-ver-download="${escapeHtml(v.id)}" ${controller.isBusy ? 'disabled' : ''} title="Скачати версію" aria-label="Скачати версію">
                      ${SVG_DOWNLOAD}
                    </button>
                    <button type="button" class="btn btn-ghost btn-danger-soft btn-icon-sm" data-ver-delete="${escapeHtml(v.id)}" ${!v.canDelete || controller.isBusy ? 'disabled' : ''} title="${v.canDelete ? 'Видалити версію' : 'Базовий оригінал не можна видалити'}" aria-label="Видалити версію">
                      ${SVG_TRASH}
                    </button>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    document.getElementById('btn-close-version-popup')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeVersionPopup();
    });

    versionPopup.querySelectorAll<HTMLButtonElement>('[data-ver-work]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const verId = btn.dataset.verWork;
        if (!verId) return;
        try {
          await controller.takeVersionIntoWork(file.filename, verId);
          closeVersionPopup();
        } catch (err: any) {
          showToast(err?.message || String(err), true);
        }
      });
    });

    versionPopup.querySelectorAll<HTMLButtonElement>('[data-ver-download]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const verId = btn.dataset.verDownload;
        if (!verId) return;
        const variant = verId === 'output' ? 'output' : 'original';
        try {
          const { filename, blob } = await controller.fetchVersionBlob(file.filename, variant);
          triggerBlobDownload(filename, blob);
        } catch (err: any) {
          showToast(err?.message || String(err), true);
        }
      });
    });

    versionPopup.querySelectorAll<HTMLButtonElement>('[data-ver-delete]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const verId = btn.dataset.verDelete;
        if (!verId) return;
        try {
          await controller.deleteVersion(file.filename, verId);
        } catch (err: any) {
          showToast(err?.message || String(err), true);
        }
      });
    });
  };

  const renderToolOptions = (): void => {
    const active = controller.activeFile;
    const srcDims = controller.getActiveSourceDimensions();
    const srcHint = active
      ? `${active.output_width ?? active.width}×${active.output_height ?? active.height}`
      : 'px';
    const nextKey = [
      controller.tool,
      controller.upscaleScale,
      controller.accelerator,
      controller.removeBgMode,
      controller.tool === 'crop' || controller.tool === 'resize' ? srcHint : '',
    ].join('|');

    const syncCropControls = (): void => {
      const wInput = document.getElementById('input-crop-w') as HTMLInputElement | null;
      const hInput = document.getElementById('input-crop-h') as HTMLInputElement | null;
      if (wInput) {
        const focusedW = document.activeElement === wInput;
        const rawParsedW = parseInt(wInput.value, 10);
        const clampedExceeds =
          focusedW &&
          Number.isFinite(rawParsedW) &&
          srcDims !== null &&
          rawParsedW > Number(controller.cropWidth || srcDims.width);
        if ((!focusedW && wInput.value !== controller.cropWidth) || clampedExceeds) {
          wInput.value = controller.cropWidth;
        }
      }
      if (hInput) {
        const focusedH = document.activeElement === hInput;
        const rawParsedH = parseInt(hInput.value, 10);
        const clampedExceeds =
          focusedH &&
          Number.isFinite(rawParsedH) &&
          srcDims !== null &&
          rawParsedH > Number(controller.cropHeight || srcDims.height);
        if ((!focusedH && hInput.value !== controller.cropHeight) || clampedExceeds) {
          hInput.value = controller.cropHeight;
        }
      }
      toolOptionsEl.querySelectorAll<HTMLButtonElement>('[data-crop-mode]').forEach((btn) => {
        const isActive = btn.dataset.cropMode === controller.cropMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    };

    const syncResizeControls = (): void => {
      const wInput = document.getElementById('input-resize-w') as HTMLInputElement | null;
      const hInput = document.getElementById('input-resize-h') as HTMLInputElement | null;
      if (wInput && document.activeElement !== wInput && wInput.value !== controller.resizeWidth) {
        wInput.value = controller.resizeWidth;
      }
      if (hInput && document.activeElement !== hInput && hInput.value !== controller.resizeHeight) {
        hInput.value = controller.resizeHeight;
      }
      toolOptionsEl.querySelectorAll<HTMLButtonElement>('[data-resize-mode]').forEach((btn) => {
        const isActive = btn.dataset.resizeMode === controller.resizeMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    };

    if (nextKey === lastToolOptionsKey && toolOptionsEl.childElementCount > 0) {
      if (controller.tool === 'crop') {
        syncCropControls();
      } else if (controller.tool === 'resize') {
        syncResizeControls();
      }
      return;
    }
    lastToolOptionsKey = nextKey;

    if (controller.tool === 'upscale') {
      toolOptionsEl.innerHTML = `
        <span class="field-label">Scale</span>
        <div class="option-row">
          <div class="segmented">
            <button type="button" class="seg-btn ${controller.upscaleScale === 2 ? 'active' : ''}" data-scale="2">2x</button>
            <button type="button" class="seg-btn ${controller.upscaleScale === 4 ? 'active' : ''}" data-scale="4">4x</button>
          </div>
          <span class="muted-meta">Real-ESRGAN (${escapeHtml(controller.accelerator.toUpperCase())})</span>
        </div>
      `;
      toolOptionsEl.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((btn) => {
        btn.addEventListener('click', () => {
          controller.upscaleScale = Number(btn.dataset.scale) === 4 ? 4 : 2;
          render();
        });
      });
      return;
    }

    if (controller.tool === 'enhance') {
      toolOptionsEl.innerHTML = `
        <span class="field-label">Detail Enhance</span>
        <div class="option-row">
          <span class="badge badge-subtle">1x Neural Sharpness &amp; Denoise</span>
        </div>
      `;
      return;
    }

    if (controller.tool === 'remove_bg') {
      const showPicker = controller.removeBgMode === 'color';
      toolOptionsEl.innerHTML = `
        <span class="field-label">Background</span>
        <div class="option-row">
          <div class="segmented">
            <button type="button" class="seg-btn ${controller.removeBgMode === 'transparent' ? 'active' : ''}" data-bg-mode="transparent">Transparent</button>
            <button type="button" class="seg-btn ${controller.removeBgMode === 'color' ? 'active' : ''}" data-bg-mode="color">Color</button>
          </div>
          ${
            showPicker
              ? `<label class="color-picker-wrap">
                   <input id="input-bg-color" type="color" value="${escapeHtml(controller.removeBgColor)}" aria-label="Background Color" />
                   <span class="muted-meta">${escapeHtml(controller.removeBgColor)}</span>
                 </label>`
              : '<span class="muted-meta">Auto PNG alpha</span>'
          }
        </div>
      `;
      toolOptionsEl.querySelectorAll<HTMLButtonElement>('[data-bg-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          controller.removeBgMode = btn.dataset.bgMode === 'color' ? 'color' : 'transparent';
          render();
        });
      });
      const colorInput = document.getElementById('input-bg-color') as HTMLInputElement | null;
      colorInput?.addEventListener('input', () => {
        controller.removeBgColor = colorInput.value;
        const label = colorInput.parentElement?.querySelector('.muted-meta');
        if (label) label.textContent = colorInput.value;
      });
      return;
    }

    if (controller.tool === 'blur_bg') {
      toolOptionsEl.innerHTML = `
        <span class="field-label">Blur Level</span>
        <div class="option-row">
          <input id="input-blur-level" type="range" min="1" max="100" value="${controller.blurLevel}" />
          <span id="blur-level-val" class="badge badge-subtle">${controller.blurLevel}</span>
        </div>
      `;
      const slider = document.getElementById('input-blur-level') as HTMLInputElement;
      const valEl = document.getElementById('blur-level-val')!;
      slider.addEventListener('input', () => {
        controller.blurLevel = Number(slider.value);
        valEl.textContent = slider.value;
      });
      return;
    }

    if (controller.tool === 'crop') {
      const keepActive = controller.cropMode === 'keep_aspect';
      const customActive = controller.cropMode === 'custom';
      const presetButtonsHtml = CROP_ASPECT_PRESETS.map((preset) => {
        const isAct = controller.cropMode === preset.id;
        return `
          <button
            type="button"
            class="btn btn-ghost btn-preset ${isAct ? 'active' : ''}"
            data-crop-mode="${escapeHtml(preset.id)}"
            title="${escapeHtml(preset.description)}"
            aria-label="${escapeHtml(preset.description)}"
            aria-pressed="${isAct ? 'true' : 'false'}"
          >
            ${renderResizePresetIcon(preset.id)}
            <span>${escapeHtml(preset.label)}</span>
          </button>
        `;
      }).join('');

      toolOptionsEl.innerHTML = `
        <span class="field-label">Crop (${escapeHtml(srcHint)})</span>
        <div class="option-row resize-options-row">
          <div class="btn-group resize-presets" role="group" aria-label="Режими кадрування та співвідношення сторін">
            <button
              type="button"
              class="btn btn-ghost btn-preset ${keepActive ? 'active' : ''}"
              data-crop-mode="keep_aspect"
              title="Keep aspect · Кадрування зі збереженням пропорцій оригіналу"
              aria-label="Keep aspect"
              aria-pressed="${keepActive ? 'true' : 'false'}"
            >
              ${SVG_KEEP_ASPECT}
              <span>Keep aspect</span>
            </button>
            ${presetButtonsHtml}
            <button
              type="button"
              class="btn btn-ghost btn-preset ${customActive ? 'active' : ''}"
              data-crop-mode="custom"
              title="Custom · Довільна ширина і висота рамки кадрування"
              aria-label="Custom"
              aria-pressed="${customActive ? 'true' : 'false'}"
            >
              ${SVG_CUSTOM_CROP}
              <span>Custom</span>
            </button>
          </div>
          <div class="resize-dims-group">
            <input id="input-crop-w" class="glass-input num" type="number" min="1" ${srcDims ? `max="${srcDims.width}"` : ''} placeholder="W" value="${escapeHtml(controller.cropWidth)}" aria-label="Ширина рамки кадрування у пікселях" />
            <span class="muted-meta">×</span>
            <input id="input-crop-h" class="glass-input num" type="number" min="1" ${srcDims ? `max="${srcDims.height}"` : ''} placeholder="H" value="${escapeHtml(controller.cropHeight)}" aria-label="Висота рамки кадрування у пікселях" />
          </div>
        </div>
      `;

      toolOptionsEl.querySelectorAll<HTMLButtonElement>('[data-crop-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const nextMode = btn.dataset.cropMode as CropMode | undefined;
          if (nextMode) {
            controller.setCropMode(nextMode);
          }
        });
      });

      const wInput = document.getElementById('input-crop-w') as HTMLInputElement;
      const hInput = document.getElementById('input-crop-h') as HTMLInputElement;
      wInput.addEventListener('input', () => {
        controller.setCropWidthInput(wInput.value);
      });
      hInput.addEventListener('input', () => {
        controller.setCropHeightInput(hInput.value);
      });
      wInput.addEventListener('blur', () => {
        controller.normalizeCropInputs();
        wInput.value = controller.cropWidth;
        hInput.value = controller.cropHeight;
      });
      hInput.addEventListener('blur', () => {
        controller.normalizeCropInputs();
        wInput.value = controller.cropWidth;
        hInput.value = controller.cropHeight;
      });
      return;
    }

    // resize: mutually exclusive [Keep aspect, Custom] + inline W × H inputs
    const keepActive = controller.resizeMode === 'keep_aspect';
    const customActive = controller.resizeMode === 'custom';
    toolOptionsEl.innerHTML = `
      <span class="field-label">Resize (${escapeHtml(srcHint)})</span>
      <div class="option-row resize-options-row">
        <div class="btn-group resize-presets" role="group" aria-label="Режими зміни розміру">
          <button
            type="button"
            class="btn btn-ghost btn-preset ${keepActive ? 'active' : ''}"
            data-resize-mode="keep_aspect"
            title="Keep aspect · Пропорційна зміна розміру без спотворення"
            aria-label="Keep aspect"
            aria-pressed="${keepActive ? 'true' : 'false'}"
          >
            ${SVG_KEEP_ASPECT}
            <span>Keep aspect</span>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-preset ${customActive ? 'active' : ''}"
            data-resize-mode="custom"
            title="Custom · Довільна ширина та висота (можливе розтягування)"
            aria-label="Custom"
            aria-pressed="${customActive ? 'true' : 'false'}"
          >
            ${SVG_CUSTOM_CROP}
            <span>Custom</span>
          </button>
        </div>
        <div class="resize-dims-group">
          <input id="input-resize-w" class="glass-input num" type="number" min="1" placeholder="W" value="${escapeHtml(controller.resizeWidth)}" aria-label="Ширина у пікселях" />
          <span class="muted-meta">×</span>
          <input id="input-resize-h" class="glass-input num" type="number" min="1" placeholder="H" value="${escapeHtml(controller.resizeHeight)}" aria-label="Висота у пікселях" />
        </div>
      </div>
    `;

    toolOptionsEl.querySelectorAll<HTMLButtonElement>('[data-resize-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.resizeMode as ResizeMode | undefined;
        if (nextMode) {
          controller.setResizeMode(nextMode);
        }
      });
    });

    const wInput = document.getElementById('input-resize-w') as HTMLInputElement;
    const hInput = document.getElementById('input-resize-h') as HTMLInputElement;
    wInput.addEventListener('input', () => {
      controller.setResizeWidthInput(wInput.value);
    });
    hInput.addEventListener('input', () => {
      controller.setResizeHeightInput(hInput.value);
    });
  };

  const updateMinimapViewportRect = (): void => {
    if (canvasMinimap.hidden || currentRenderedWidth <= 0 || currentRenderedHeight <= 0) return;
    if (currentMinimapWidth <= 0 || currentMinimapHeight <= 0) return;

    const viewW = canvasViewport.clientWidth || 1;
    const viewH = canvasViewport.clientHeight || 1;
    const pad = 3; // matches .canvas-minimap padding
    const rx = (canvasViewport.scrollLeft / currentRenderedWidth) * currentMinimapWidth;
    const ry = (canvasViewport.scrollTop / currentRenderedHeight) * currentMinimapHeight;
    const rw = Math.min(currentMinimapWidth, (viewW / currentRenderedWidth) * currentMinimapWidth);
    const rh = Math.min(currentMinimapHeight, (viewH / currentRenderedHeight) * currentMinimapHeight);

    minimapViewportRect.style.left = `${pad + Math.max(0, Math.min(currentMinimapWidth - rw, rx))}px`;
    minimapViewportRect.style.top = `${pad + Math.max(0, Math.min(currentMinimapHeight - rh, ry))}px`;
    minimapViewportRect.style.width = `${Math.max(10, rw)}px`;
    minimapViewportRect.style.height = `${Math.max(10, rh)}px`;
  };

  const updateResizeCropOverlay = (): void => {
    const overlay = document.getElementById('resize-crop-overlay');
    const cropBox = document.getElementById('resize-crop-box');
    const labelEl = document.getElementById('crop-frame-label');
    if (!overlay || !cropBox) return;

    if (
      controller.tool !== 'crop' ||
      currentNaturalWidth <= 0 ||
      currentNaturalHeight <= 0
    ) {
      overlay.hidden = true;
      return;
    }

    const rect = controller.getEffectiveCropRect(currentNaturalWidth, currentNaturalHeight);
    overlay.hidden = false;
    cropBox.style.left = `${(rect.x * 100).toFixed(4)}%`;
    cropBox.style.top = `${(rect.y * 100).toFixed(4)}%`;
    cropBox.style.width = `${(rect.w * 100).toFixed(4)}%`;
    cropBox.style.height = `${(rect.h * 100).toFixed(4)}%`;

    const isMovable = rect.w < 0.999 || rect.h < 0.999;
    cropBox.classList.toggle('is-movable', isMovable);
    cropBox.classList.toggle('is-full-frame', !isMovable);

    if (labelEl) {
      const modeName =
        controller.cropMode === 'keep_aspect'
          ? 'Keep aspect'
          : controller.cropAspectPreset ?? 'Custom';
      const pxW = Math.max(1, Math.round(rect.w * currentNaturalWidth));
      const pxH = Math.max(1, Math.round(rect.h * currentNaturalHeight));
      labelEl.textContent = `${modeName} · ${pxW}×${pxH}`;
    }
  };

  const bindCropOverlayHandlers = (frame: HTMLElement): void => {
    const cropBox = frame.querySelector<HTMLElement>('#resize-crop-box');
    if (!cropBox) return;
    let draggingCrop = false;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragStartCropX = 0;
    let dragStartCropY = 0;

    cropBox.addEventListener('pointerdown', (ev) => {
      if (!cropBox.classList.contains('is-movable') || ev.button !== 0) return;
      if (currentNaturalWidth <= 0 || currentNaturalHeight <= 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const startRect = controller.getEffectiveCropRect(currentNaturalWidth, currentNaturalHeight);
      draggingCrop = true;
      dragStartClientX = ev.clientX;
      dragStartClientY = ev.clientY;
      dragStartCropX = startRect.x;
      dragStartCropY = startRect.y;
      cropBox.classList.add('is-dragging');
      cropBox.setPointerCapture(ev.pointerId);
    });

    cropBox.addEventListener('pointermove', (ev) => {
      if (!draggingCrop) return;
      const frameRect = frame.getBoundingClientRect();
      if (frameRect.width <= 0 || frameRect.height <= 0) return;
      const dxNorm = (ev.clientX - dragStartClientX) / frameRect.width;
      const dyNorm = (ev.clientY - dragStartClientY) / frameRect.height;
      const updated = controller.setCropPosition(
        dragStartCropX + dxNorm,
        dragStartCropY + dyNorm,
        currentNaturalWidth,
        currentNaturalHeight,
        false
      );
      cropBox.style.left = `${(updated.x * 100).toFixed(4)}%`;
      cropBox.style.top = `${(updated.y * 100).toFixed(4)}%`;
    });

    const endDrag = () => {
      if (!draggingCrop) return;
      draggingCrop = false;
      cropBox.classList.remove('is-dragging');
    };
    cropBox.addEventListener('pointerup', endDrag);
    cropBox.addEventListener('pointercancel', endDrag);
  };

  const renderCropOverlayMarkup = (): string => `
    <div class="resize-crop-overlay" id="resize-crop-overlay" hidden>
      <div class="resize-crop-box" id="resize-crop-box">
        <span class="crop-grid-h crop-grid-h1"></span>
        <span class="crop-grid-h crop-grid-h2"></span>
        <span class="crop-grid-v crop-grid-v1"></span>
        <span class="crop-grid-v crop-grid-v2"></span>
        <span class="crop-frame-label" id="crop-frame-label"></span>
      </div>
    </div>
  `;

  const updateCanvasGeometry = (): void => {
    const frame = canvasContent.querySelector<HTMLElement>('.viewer-frame');
    if (!frame || currentNaturalWidth <= 0 || currentNaturalHeight <= 0) {
      canvasHud.hidden = true;
      canvasMinimap.hidden = true;
      canvasViewport.classList.remove('is-pannable');
      return;
    }

    const availW = Math.max(120, canvasViewport.clientWidth - 4);
    const availH = Math.max(120, canvasViewport.clientHeight - 4);
    const scale = controller.getEffectiveCanvasScale(
      currentNaturalWidth,
      currentNaturalHeight,
      availW,
      availH
    );
    currentEffectiveScale = scale;
    const renW = Math.max(1, Math.round(currentNaturalWidth * scale));
    const renH = Math.max(1, Math.round(currentNaturalHeight * scale));
    currentRenderedWidth = renW;
    currentRenderedHeight = renH;

    frame.style.width = `${renW}px`;
    frame.style.height = `${renH}px`;

    canvasHud.hidden = false;
    zoomPercentReadout.textContent = `${Math.round(scale * 100)}%`;
    const fitScale = computeFitCanvasScale(
      currentNaturalWidth,
      currentNaturalHeight,
      availW,
      availH
    );
    const isExact100 = Math.abs(scale - 1) < 0.005;
    const isFitted = Math.abs(scale - fitScale) < 0.005;
    btnZoom100.classList.toggle('active', isExact100);
    btnZoomReset.classList.toggle('active', isFitted && !isExact100);

    const overflows = renW > availW + 1 || renH > availH + 1;
    canvasViewport.classList.toggle('is-pannable', overflows && !frame.classList.contains('compare-box'));
    canvasMinimap.hidden = !overflows;

    if (overflows) {
      const maxMiniW = 128;
      const maxMiniH = 92;
      const miniScale = Math.min(maxMiniW / currentNaturalWidth, maxMiniH / currentNaturalHeight);
      currentMinimapWidth = Math.max(36, Math.round(currentNaturalWidth * miniScale));
      currentMinimapHeight = Math.max(28, Math.round(currentNaturalHeight * miniScale));
      canvasMinimap.style.width = `${currentMinimapWidth + 6}px`;
      canvasMinimap.style.height = `${currentMinimapHeight + 6}px`;
      updateMinimapViewportRect();
    }

    updateResizeCropOverlay();
  };

  const renderCanvas = (): void => {
    const selected = controller.selectedFiles;

    // Multi-selection Apple Time Machine Cascade
    if (controller.selectionMode === 'selecting' && selected.length >= 2) {
      const maxVisible = selected.slice(0, 7);
      const frontFile = maxVisible[0];
      const frontPreview = controller.getPreviewFor(frontFile.filename);
      const frontImgKey =
        (frontFile.is_processed ? frontPreview?.outputUrl : frontPreview?.originalUrl) ||
        frontPreview?.originalUrl ||
        frontFile.thumbUrl ||
        '';
      const cascadeKey = `cascade|${maxVisible.map((f) => `${f.filename}:${f.is_processed}`).join(',')}|${frontImgKey}`;
      imageOverlayActions.hidden = true;
      currentNaturalWidth = 0;
      currentNaturalHeight = 0;
      canvasHud.hidden = true;
      canvasMinimap.hidden = true;

      if (cascadeKey === lastCanvasRenderKey) return;
      lastCanvasRenderKey = cascadeKey;

      const baseOffsetY = Math.min(84, (maxVisible.length - 1) * 16);
      canvasContent.innerHTML = `
        <div class="cascade-stage" aria-label="Каскад вибраних зображень">
          ${maxVisible
            .map((file, idx) => {
              const preview = idx === 0 ? controller.getPreviewFor(file.filename) : null;
              const imgUrl =
                idx === 0
                  ? (file.is_processed ? preview?.outputUrl : preview?.originalUrl) ||
                    preview?.originalUrl ||
                    file.thumbUrl ||
                    ''
                  : file.thumbUrl || '';
              const z = maxVisible.length - idx;
              const translateY = Math.round(baseOffsetY - idx * 42);
              const translateZ = -idx * 120;
              const scale = Math.max(0.52, 1 - idx * 0.075);
              const opacity = Math.max(0.18, 1 - idx * 0.135);
              const brightness = Math.max(0.24, 1 - idx * 0.13);
              return `
                <div class="cascade-card" data-cascade-file="${escapeHtml(file.filename)}"
                  style="z-index:${z};opacity:${opacity.toFixed(2)};filter:brightness(${brightness.toFixed(2)});transform:translate3d(0px, ${translateY}px, ${translateZ}px) scale(${scale.toFixed(3)});">
                  ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(file.filename)}" draggable="false" />` : ''}
                  <div class="cascade-caption">
                    <span>#${idx + 1} · ${escapeHtml(file.filename)}</span>
                    ${
                      file.is_processed
                        ? `<span class="status-check" title="Оброблено" aria-label="Оброблено">${SVG_CHECKMARK}</span>`
                        : '<span class="muted-meta">Оригінал</span>'
                    }
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
      canvasContent.querySelectorAll<HTMLElement>('[data-cascade-file]').forEach((card) => {
        card.addEventListener('click', () => {
          const fname = card.dataset.cascadeFile;
          if (fname) controller.promoteSelectedToFront(fname);
        });
      });
      return;
    }

    const active = controller.activeFile;
    if (!active) {
      imageOverlayActions.hidden = true;
      currentNaturalWidth = 0;
      currentNaturalHeight = 0;
      canvasHud.hidden = true;
      canvasMinimap.hidden = true;
      if (lastCanvasRenderKey === 'empty') return;
      lastCanvasRenderKey = 'empty';
      canvasContent.innerHTML = `
        <div class="canvas-empty">
          <h2>AI Photo Studio Ready</h2>
          <p>Перетягніть зображення в ліву панель або натисніть «+», щоб почати локальну обробку.</p>
        </div>
      `;
      return;
    }

    const preview = controller.getActivePreview();
    if (!preview || !preview.originalUrl) {
      imageOverlayActions.hidden = true;
      currentNaturalWidth = 0;
      currentNaturalHeight = 0;
      canvasHud.hidden = true;
      canvasMinimap.hidden = true;
      const loadingKey = `loading|${active.filename}`;
      if (lastCanvasRenderKey === loadingKey) return;
      lastCanvasRenderKey = loadingKey;
      canvasContent.innerHTML = `<div class="muted-meta">Завантаження прев'ю ${escapeHtml(active.filename)}...</div>`;
      return;
    }

    if (active.is_processed && preview.outputUrl) {
      currentNaturalWidth = Math.max(1, active.output_width ?? active.width);
      currentNaturalHeight = Math.max(1, active.output_height ?? active.height);
      imageOverlayActions.hidden = false;
      minimapImg.src = preview.outputUrl;

      const compareKey = `compare|${active.filename}|${preview.originalUrl}|${preview.outputUrl}`;
      if (lastCanvasRenderKey !== compareKey) {
        lastCanvasRenderKey = compareKey;
        const pct = controller.sliderPercent;
        canvasContent.innerHTML = `
          <div class="compare-box viewer-frame" id="compare-box" tabindex="0" aria-label="Слайдер До і Після">
            <img class="compare-img-base" src="${escapeHtml(preview.originalUrl)}" alt="До обробки" draggable="false" />
            <div class="compare-after-layer" id="compare-after-layer" style="clip-path: inset(0 0 0 ${pct}%);">
              <img src="${escapeHtml(preview.outputUrl)}" alt="Після обробки" draggable="false" />
            </div>
            ${renderCropOverlayMarkup()}
            <div class="compare-divider" id="compare-divider" style="left: ${pct}%;">
              <div class="compare-handle">↔</div>
            </div>
            <span class="compare-tag before">До</span>
            <span class="compare-tag after">Після</span>
          </div>
        `;

        const box = document.getElementById('compare-box')!;
        const afterLayer = document.getElementById('compare-after-layer')!;
        const divider = document.getElementById('compare-divider')!;
        bindCropOverlayHandlers(box);

        const applySlider = (clientX: number) => {
          const rect = box.getBoundingClientRect();
          if (rect.width <= 0) return;
          const pctNext = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
          controller.sliderPercent = pctNext;
          afterLayer.style.clipPath = `inset(0 0 0 ${pctNext}%)`;
          divider.style.left = `${pctNext}%`;
        };

        let draggingSlider = false;
        let panningCompare = false;
        let panStartX = 0;
        let panStartY = 0;
        let panStartScrollLeft = 0;
        let panStartScrollTop = 0;

        box.addEventListener('selectstart', (ev) => ev.preventDefault());
        box.addEventListener('dragstart', (ev) => ev.preventDefault());
        box.addEventListener('pointerdown', (ev) => {
          if ((ev.target as HTMLElement).closest('button, .resize-crop-box.is-movable')) return;
          ev.preventDefault();
          window.getSelection()?.removeAllRanges();
          box.focus({ preventScroll: true });
          if (ev.button === 1 || ev.altKey || ev.shiftKey) {
            panningCompare = true;
            panStartX = ev.clientX;
            panStartY = ev.clientY;
            panStartScrollLeft = canvasViewport.scrollLeft;
            panStartScrollTop = canvasViewport.scrollTop;
            box.setPointerCapture(ev.pointerId);
            return;
          }
          draggingSlider = true;
          box.setPointerCapture(ev.pointerId);
          applySlider(ev.clientX);
        });
        box.addEventListener('pointermove', (ev) => {
          if (panningCompare) {
            canvasViewport.scrollLeft = panStartScrollLeft - (ev.clientX - panStartX);
            canvasViewport.scrollTop = panStartScrollTop - (ev.clientY - panStartY);
            updateMinimapViewportRect();
            return;
          }
          if (draggingSlider) applySlider(ev.clientX);
        });
        const stopCompareDrag = () => {
          draggingSlider = false;
          panningCompare = false;
        };
        box.addEventListener('pointerup', stopCompareDrag);
        box.addEventListener('pointercancel', stopCompareDrag);
        box.addEventListener('keydown', (ev) => {
          if (ev.key === 'ArrowLeft') {
            controller.setSliderPercent(controller.sliderPercent - 5);
          } else if (ev.key === 'ArrowRight') {
            controller.setSliderPercent(controller.sliderPercent + 5);
          }
        });
      } else {
        const afterLayer = document.getElementById('compare-after-layer');
        const divider = document.getElementById('compare-divider');
        if (afterLayer) afterLayer.style.clipPath = `inset(0 0 0 ${controller.sliderPercent}%)`;
        if (divider) divider.style.left = `${controller.sliderPercent}%`;
      }

      updateCanvasGeometry();
      return;
    }

    currentNaturalWidth = Math.max(1, active.width);
    currentNaturalHeight = Math.max(1, active.height);
    imageOverlayActions.hidden = true;
    minimapImg.src = preview.originalUrl;

    const singleKey = `single|${active.filename}|${preview.originalUrl}`;
    if (lastCanvasRenderKey !== singleKey) {
      lastCanvasRenderKey = singleKey;
      canvasContent.innerHTML = `
        <div class="single-viewer viewer-frame" id="single-viewer">
          <img src="${escapeHtml(preview.originalUrl)}" alt="${escapeHtml(active.filename)}" draggable="false" />
          ${renderCropOverlayMarkup()}
        </div>
      `;

      const viewer = document.getElementById('single-viewer')!;
      bindCropOverlayHandlers(viewer);
      let panning = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;

      viewer.addEventListener('selectstart', (ev) => ev.preventDefault());
      viewer.addEventListener('dragstart', (ev) => ev.preventDefault());
      viewer.addEventListener('pointerdown', (ev) => {
        if ((ev.target as HTMLElement).closest('.resize-crop-box.is-movable')) return;
        ev.preventDefault();
        window.getSelection()?.removeAllRanges();
        if (!canvasViewport.classList.contains('is-pannable')) return;
        panning = true;
        startX = ev.clientX;
        startY = ev.clientY;
        startLeft = canvasViewport.scrollLeft;
        startTop = canvasViewport.scrollTop;
        canvasViewport.classList.add('is-panning');
        viewer.setPointerCapture(ev.pointerId);
      });
      viewer.addEventListener('pointermove', (ev) => {
        if (!panning) return;
        canvasViewport.scrollLeft = startLeft - (ev.clientX - startX);
        canvasViewport.scrollTop = startTop - (ev.clientY - startY);
        updateMinimapViewportRect();
      });
      const stopPanning = () => {
        panning = false;
        canvasViewport.classList.remove('is-panning');
      };
      viewer.addEventListener('pointerup', stopPanning);
      viewer.addEventListener('pointercancel', stopPanning);
    }

    updateCanvasGeometry();
  };

  const render = (): void => {
    // View mode toggle state
    const isGrid = controller.projectViewMode === 'grid';
    btnViewList.classList.toggle('active', !isGrid);
    btnViewGrid.classList.toggle('active', isGrid);
    btnViewList.setAttribute('aria-pressed', String(!isGrid));
    btnViewGrid.setAttribute('aria-pressed', String(isGrid));
    fileListEl.classList.toggle('view-grid', isGrid);
    fileListEl.classList.toggle('view-list', !isGrid);

    // Selection cycle button icon & tooltip
    const selLabel = controller.getSelectionButtonLabel();
    if (selLabel === 'Select') {
      btnSelectCycle.innerHTML = SVG_SELECT;
      btnSelectCycle.title = 'Вибрати файли (Select)';
      btnSelectCycle.setAttribute('aria-label', 'Вибрати файли');
    } else if (selLabel === 'Select All') {
      btnSelectCycle.innerHTML = SVG_SELECT_ALL;
      btnSelectCycle.title = 'Вибрати всі (Select All)';
      btnSelectCycle.setAttribute('aria-label', 'Вибрати всі');
    } else {
      btnSelectCycle.innerHTML = SVG_RESET_SEL;
      btnSelectCycle.title = 'Скинути виділення (Reset)';
      btnSelectCycle.setAttribute('aria-label', 'Скинути виділення');
    }
    btnSelectCycle.disabled = controller.files.length === 0 || controller.isBusy;

    const selectedSet = new Set(controller.selectedOrder);
    fileListEl.innerHTML = controller.files
      .map((file) => {
        const isActive = controller.activeFilename === file.filename;
        const isSelected = selectedSet.has(file.filename);
        const dims =
          file.is_processed && file.output_width && file.output_height
            ? `${file.output_width}×${file.output_height}`
            : `${file.width}×${file.height}`;
        const sizeStr = formatBytes(file.output_size_bytes ?? file.size_bytes);
        const versionCount = controller.getVersionCount(file);
        const activeExt =
          file.is_processed && file.output_filename
            ? file.output_filename.split('.').pop() || file.extension
            : file.extension;

        if (isGrid) {
          return `
            <div class="file-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-filename="${escapeHtml(file.filename)}">
              <div class="file-thumb-wrap">
                ${file.thumbUrl ? `<img src="${escapeHtml(file.thumbUrl)}" alt="${escapeHtml(file.filename)}" draggable="false" />` : ''}
                ${
                  controller.selectionMode === 'selecting'
                    ? `<span class="file-select-dot">${isSelected ? '✓' : ''}</span>`
                    : ''
                }
                ${
                  file.is_processed
                    ? `<span class="status-check" title="Оброблено" aria-label="Оброблено">${SVG_CHECKMARK}</span>`
                    : ''
                }
                ${renderExtensionBadge(activeExt, 'ext-badge-thumb')}
                <button type="button" class="version-badge" data-versions-for="${escapeHtml(file.filename)}" title="Версії файлу (${versionCount})">${versionCount}</button>
              </div>
              <div class="file-meta">
                <div class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
                <div class="file-sub">${dims} · ${sizeStr}</div>
              </div>
            </div>
          `;
        }

        return `
          <div class="file-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-filename="${escapeHtml(file.filename)}">
            <div class="file-thumb-wrap">
              ${file.thumbUrl ? `<img src="${escapeHtml(file.thumbUrl)}" alt="${escapeHtml(file.filename)}" draggable="false" />` : ''}
              ${
                controller.selectionMode === 'selecting'
                  ? `<span class="file-select-dot">${isSelected ? '✓' : ''}</span>`
                  : ''
              }
              <button type="button" class="version-badge" data-versions-for="${escapeHtml(file.filename)}" title="Версії файлу (${versionCount})">${versionCount}</button>
            </div>
            <div class="file-meta">
              <div class="file-name-row">
                ${renderExtensionBadge(activeExt)}
                <div class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
              </div>
              <div class="file-sub">${dims} · ${sizeStr}</div>
            </div>
            <div>
              ${
                file.is_processed
                  ? `<span class="status-check" title="Оброблено" aria-label="Оброблено">${SVG_CHECKMARK}</span>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    fileListEl.querySelectorAll<HTMLElement>('.file-item').forEach((row) => {
      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('.version-badge')) return;
        ev.stopPropagation();
        closeFileInfoPopover();
        const fname = row.dataset.filename;
        if (!fname) return;
        if (controller.selectionMode === 'selecting') {
          controller.toggleFileSelection(fname);
        } else {
          controller.selectSingleFile(fname);
        }
      });

      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const fname = row.dataset.filename;
        const file = fname ? controller.files.find((f) => f.filename === fname) : null;
        if (file) {
          openFileInfoPopover(file, ev.clientX, ev.clientY);
        }
      });
    });

    fileListEl.querySelectorAll<HTMLButtonElement>('[data-versions-for]').forEach((badge) => {
      badge.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeFileInfoPopover();
        const fname = badge.dataset.versionsFor;
        if (!fname) return;
        if (openVersionFilename === fname) {
          closeVersionPopup();
          return;
        }
        openVersionFilename = fname;
        renderVersionPopup();
        void controller.loadPreview(fname);
      });
    });

    emptyDropHint.classList.toggle('compact', controller.files.length > 0);
    workspaceSummary.textContent = `${controller.files.length} файл(ів) · ${controller.processedCount} оброблено`;

    toolButtons.querySelectorAll<HTMLButtonElement>('.tool-tab').forEach((btn) => {
      const isAct = btn.dataset.tool === controller.tool;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', String(isAct));
    });

    fileTypeGroup.querySelectorAll<HTMLButtonElement>('[data-output-format]').forEach((btn) => {
      const isFmt = btn.dataset.outputFormat === controller.outputFormat;
      btn.classList.toggle('active', isFmt);
      btn.setAttribute('aria-pressed', isFmt ? 'true' : 'false');
    });
    btnProcess.disabled = !controller.canProcessCurrent;
    btnProcessAll.disabled = !controller.canProcessAll;
    btnDownloadAll.disabled = !controller.canDownloadAll;
    btnRestoreAll.disabled = !controller.canRestoreAll;
    btnOpenFolder.disabled = !controller.isWorkerRunning;

    if (controller.isProcessing && controller.progress) {
      progressOverlay.hidden = false;
      progressTitle.textContent = `Обробка (${controller.progress.index + 1}/${controller.progress.total}): ${controller.progress.filename}`;
      progressPercent.textContent = `${Math.round(controller.progress.percent)}%`;
      progressBar.style.width = `${Math.min(100, Math.max(0, controller.progress.percent))}%`;
      progressSub.textContent = `Етап: ${controller.progress.stage}`;
    } else {
      progressOverlay.hidden = true;
    }

    statusLine.textContent = controller.activeFile
      ? `Активний: ${controller.activeFile.filename} · ${controller.processedCount}/${controller.files.length} у output/`
      : 'Додайте зображення у Project Folder';

    renderToolOptions();
    renderVersionPopup();
    renderCanvas();
  };

  const controller = new StudioController({
    onChange: render,
    onNotify: showToast,
  });

  const handleSelectedBrowserFiles = async (fileList: File[]): Promise<void> => {
    if (fileList.length === 0) return;
    const payloadItems: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const file of fileList) {
      const buf = await file.arrayBuffer();
      payloadItems.push({ name: file.name, bytes: new Uint8Array(buf) });
    }
    try {
      await controller.uploadFiles(payloadItems);
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  };

  // Left panel clicks & Drag&Drop
  dropzoneArea.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('.file-item')) return;
    fileInputMulti.click();
  });
  dropzoneArea.addEventListener('scroll', closeFileInfoPopover);
  btnAddFiles.addEventListener('click', () => fileInputMulti.click());
  btnImportFolder.addEventListener('click', () => fileInputFolder.click());

  fileInputMulti.addEventListener('change', async () => {
    const files = fileInputMulti.files ? Array.from(fileInputMulti.files) : [];
    fileInputMulti.value = '';
    await handleSelectedBrowserFiles(files);
  });
  fileInputFolder.addEventListener('change', async () => {
    const files = fileInputFolder.files ? Array.from(fileInputFolder.files) : [];
    fileInputFolder.value = '';
    await handleSelectedBrowserFiles(files);
  });

  dropzoneArea.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    dropzoneArea.classList.add('drag-over');
  });
  dropzoneArea.addEventListener('dragleave', () => {
    dropzoneArea.classList.remove('drag-over');
  });
  dropzoneArea.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    dropzoneArea.classList.remove('drag-over');
    if (!ev.dataTransfer) return;
    const files = await readDroppedEntries(ev.dataTransfer);
    await handleSelectedBrowserFiles(files);
  });

  // View mode & Selection mode toggles
  btnViewList.addEventListener('click', () => controller.setProjectViewMode('list'));
  btnViewGrid.addEventListener('click', () => controller.setProjectViewMode('grid'));
  btnSelectCycle.addEventListener('click', () => controller.cycleSelectionMode());

  // Toolbar tool tabs & format
  toolButtons.querySelectorAll<HTMLButtonElement>('.tool-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.tool as StudioTool | undefined;
      if (next) controller.setTool(next);
    });
  });
  fileTypeGroup.querySelectorAll<HTMLButtonElement>('[data-output-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextFormat = btn.dataset.outputFormat as StudioOutputFormat | undefined;
      if (nextFormat) {
        controller.setOutputFormat(nextFormat);
      }
    });
  });

  // Process & Open Folder buttons (Control Strip)
  btnProcess.addEventListener('click', async () => {
    try {
      await controller.processCurrent();
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });
  btnProcessAll.addEventListener('click', async () => {
    try {
      await controller.processSelected();
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });
  btnOpenFolder.addEventListener('click', async () => {
    try {
      await controller.openProjectFolder();
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });

  // Per-image Overlay Download & Restore
  btnImgDownload.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const active = controller.activeFile;
    if (!active) return;
    try {
      const { filename, blob } = await controller.fetchOutputFileBlob(active.filename);
      triggerBlobDownload(filename, blob);
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });
  btnImgRestore.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const active = controller.activeFile;
    if (!active) return;
    try {
      await controller.restoreSingle(active.filename);
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });

  // Zoom controls
  btnZoomOut.addEventListener('click', () => controller.zoomOut(currentEffectiveScale));
  btnZoomReset.addEventListener('click', () => {
    if (currentNaturalWidth > 0 && currentNaturalHeight > 0) {
      const availW = Math.max(120, canvasViewport.clientWidth - 4);
      const availH = Math.max(120, canvasViewport.clientHeight - 4);
      controller.fitToWorkspace(currentNaturalWidth, currentNaturalHeight, availW, availH);
    } else {
      controller.resetZoom();
    }
  });
  btnZoom100.addEventListener('click', () => controller.setZoomExact(1));
  btnZoomIn.addEventListener('click', () => controller.zoomIn(currentEffectiveScale));

  // Ctrl/Cmd + Wheel zoom on preview stage
  previewStage.addEventListener(
    'wheel',
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      if (currentNaturalWidth <= 0) return;
      ev.preventDefault();
      if (ev.deltaY < 0) {
        controller.zoomIn(currentEffectiveScale);
      } else if (ev.deltaY > 0) {
        controller.zoomOut(currentEffectiveScale);
      }
    },
    { passive: false }
  );

  // Minimap click & drag navigation
  const panFromMinimapPointer = (clientX: number, clientY: number): void => {
    if (currentMinimapWidth <= 0 || currentMinimapHeight <= 0) return;
    const rect = canvasMinimap.getBoundingClientRect();
    const pad = 3;
    const relX = Math.max(0, Math.min(1, (clientX - rect.left - pad) / currentMinimapWidth));
    const relY = Math.max(0, Math.min(1, (clientY - rect.top - pad) / currentMinimapHeight));
    const viewW = canvasViewport.clientWidth;
    const viewH = canvasViewport.clientHeight;
    canvasViewport.scrollLeft = Math.max(0, relX * currentRenderedWidth - viewW / 2);
    canvasViewport.scrollTop = Math.max(0, relY * currentRenderedHeight - viewH / 2);
    updateMinimapViewportRect();
  };

  let draggingMinimap = false;
  canvasMinimap.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    draggingMinimap = true;
    canvasMinimap.setPointerCapture(ev.pointerId);
    panFromMinimapPointer(ev.clientX, ev.clientY);
  });
  canvasMinimap.addEventListener('pointermove', (ev) => {
    if (!draggingMinimap) return;
    panFromMinimapPointer(ev.clientX, ev.clientY);
  });
  canvasMinimap.addEventListener('pointerup', () => {
    draggingMinimap = false;
  });

  canvasViewport.addEventListener('scroll', updateMinimapViewportRect);

  if (typeof ResizeObserver !== 'undefined') {
    const stageObserver = new ResizeObserver(() => {
      updateCanvasGeometry();
    });
    stageObserver.observe(previewStage);
  } else {
    window.addEventListener('resize', updateCanvasGeometry);
  }

  // Batch Download & Restore
  btnDownloadAll.addEventListener('click', async () => {
    try {
      const { filename, blob, fileCount } = await controller.fetchAllOutputZip();
      triggerBlobDownload(filename, blob);
      showToast(`Завантажено ZIP-архів (${fileCount} файл(ів)).`);
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });
  btnRestoreAll.addEventListener('click', async () => {
    try {
      await controller.restoreAll();
    } catch (err: any) {
      showToast(err?.message || String(err), true);
    }
  });

  // Global dismissal for popovers & modals
  document.addEventListener('pointerdown', (ev) => {
    const target = ev.target as HTMLElement;
    if (!fileInfoPopover.hidden && !target.closest('#file-info-popover')) {
      closeFileInfoPopover();
    }
    if (
      openVersionFilename &&
      !target.closest('#version-popup') &&
      !target.closest('[data-versions-for]')
    ) {
      closeVersionPopup();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeFileInfoPopover();
      closeVersionPopup();
    }
  });

  // Connect to JetPack Daemon (SDK JetPackControlBar handles standard status)
  const startConnection = async (): Promise<void> => {
    connectionBanner.hidden = true;
    connectionBanner.className = 'connection-banner glass-panel';
    connectionBanner.innerHTML = '';
    render();

    try {
      appClient = await connectStudioClient({
        isProcessing: () => controller.isProcessing,
        onPairingUri: (uri) => {
          connectionBanner.hidden = false;
          connectionBanner.className = 'connection-banner glass-panel';
          connectionBanner.innerHTML = `
            <div>
              <strong>Підтвердьте підключення браузера у JetPack</strong>
              <div class="muted-meta">Натисніть кнопку нижче або підтвердіть запит у вікні JetPack.</div>
            </div>
            <a class="btn btn-primary" href="${escapeHtml(uri)}">Authorize Browser</a>
          `;
        },
        onProgress: () => {
          connectionBanner.hidden = true;
        },
        onAfterStop: () => {
          controller.setClient(null);
          showToast('Воркер AI Photo Studio зупинено.');
        },
      });

      connectionBanner.hidden = true;
      connectionBanner.innerHTML = '';
      controller.setClient(appClient);
      await controller.refreshFiles();
    } catch (err: any) {
      const msg = err?.message || String(err);
      connectionBanner.hidden = false;
      connectionBanner.className = 'connection-banner glass-panel error';
      connectionBanner.innerHTML = `
        <div>
          <strong>Не вдалося підключитися до JetPack</strong>
          <div class="muted-meta">${escapeHtml(msg)}</div>
        </div>
        <button id="btn-retry-connect" class="btn btn-primary" type="button">Повторити</button>
      `;
      document.getElementById('btn-retry-connect')?.addEventListener('click', () => {
        void startConnection();
      });
      showToast(msg, true);
    }
  };

  void startConnection();
}

bootstrapStudioApp();
