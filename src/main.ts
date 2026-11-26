import './styles.css';
import type { JetPackAppClient } from '@jetpack/client';
import type { JetPackOpcodeMap } from './jetpack-env';
import {
  StudioController,
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

function bootstrapStudioApp(): void {
  const toastContainer = document.getElementById('toast-container')!;
  const connectionBanner = document.getElementById('connection-banner')!;
  const accelBadge = document.getElementById('accel-badge')!;
  const btnSelectCycle = document.getElementById('btn-select-cycle') as HTMLButtonElement;
  const btnImportFolder = document.getElementById('btn-import-folder') as HTMLButtonElement;
  const btnAddFiles = document.getElementById('btn-add-files') as HTMLButtonElement;
  const fileInputMulti = document.getElementById('file-input-multi') as HTMLInputElement;
  const fileInputFolder = document.getElementById('file-input-folder') as HTMLInputElement;
  const dropzoneArea = document.getElementById('dropzone-area')!;
  const fileListEl = document.getElementById('file-list')!;
  const emptyDropHint = document.getElementById('empty-drop-hint')!;
  const workspaceSummary = document.getElementById('workspace-summary')!;
  const toolButtons = document.getElementById('tool-buttons')!;
  const toolOptionsEl = document.getElementById('tool-options')!;
  const selectFileType = document.getElementById('select-file-type') as HTMLSelectElement;
  const btnProcess = document.getElementById('btn-process') as HTMLButtonElement;
  const btnProcessAll = document.getElementById('btn-process-all') as HTMLButtonElement;
  const canvasContent = document.getElementById('canvas-content')!;
  const progressOverlay = document.getElementById('progress-overlay')!;
  const progressTitle = document.getElementById('progress-title')!;
  const progressPercent = document.getElementById('progress-percent')!;
  const progressBar = document.getElementById('progress-bar')!;
  const progressSub = document.getElementById('progress-sub')!;
  const statusLine = document.getElementById('status-line')!;
  const btnRestoreAll = document.getElementById('btn-restore-all') as HTMLButtonElement;
  const btnDownloadAll = document.getElementById('btn-download-all') as HTMLButtonElement;

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

  const renderToolOptions = (): void => {
    const active = controller.activeFile;
    if (controller.tool === 'upscale') {
      toolOptionsEl.innerHTML = `
        <span class="field-label">Scale Factor</span>
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
        <span class="field-label">Background Fill</span>
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

    // resize
    const srcHint = active ? `${active.output_width ?? active.width}×${active.output_height ?? active.height}` : 'px';
    toolOptionsEl.innerHTML = `
      <span class="field-label">New Size (${escapeHtml(srcHint)})</span>
      <div class="option-row">
        <input id="input-resize-w" class="glass-input num" type="number" min="1" placeholder="Width" value="${escapeHtml(controller.resizeWidth)}" />
        <span class="muted-meta">×</span>
        <input id="input-resize-h" class="glass-input num" type="number" min="1" placeholder="Auto" value="${escapeHtml(controller.resizeHeight)}" />
        <label class="muted-meta" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
          <input id="input-keep-aspect" type="checkbox" ${controller.resizeKeepAspect ? 'checked' : ''} />
          Keep aspect
        </label>
      </div>
    `;
    const wInput = document.getElementById('input-resize-w') as HTMLInputElement;
    const hInput = document.getElementById('input-resize-h') as HTMLInputElement;
    const aspectInput = document.getElementById('input-keep-aspect') as HTMLInputElement;
    wInput.addEventListener('input', () => {
      controller.resizeWidth = wInput.value;
    });
    hInput.addEventListener('input', () => {
      controller.resizeHeight = hInput.value;
    });
    aspectInput.addEventListener('change', () => {
      controller.resizeKeepAspect = aspectInput.checked;
    });
  };

  const renderCanvas = (): void => {
    const selected = controller.selectedFiles;

    // Multi-selection Apple Time Machine Cascade
    if (controller.selectionMode === 'selecting' && selected.length >= 2) {
      const maxVisible = selected.slice(0, 6);
      canvasContent.innerHTML = `
        <div class="cascade-stage" aria-label="Каскад вибраних зображень">
          ${maxVisible
            .map((file, idx) => {
              const preview = controller.getPreviewFor(file.filename);
              const imgUrl =
                (file.is_processed ? preview?.outputUrl : preview?.originalUrl) ||
                preview?.originalUrl ||
                file.thumbUrl ||
                '';
              const z = maxVisible.length - idx;
              const translateY = -idx * 22;
              const translateX = idx * 34;
              const translateZ = -idx * 95;
              const scale = Math.max(0.7, 1 - idx * 0.065);
              const opacity = Math.max(0.32, 1 - idx * 0.16);
              return `
                <div class="cascade-card" data-cascade-file="${escapeHtml(file.filename)}"
                  style="z-index:${z};opacity:${opacity};transform:translate3d(${translateX}px, ${translateY}px, ${translateZ}px) scale(${scale});">
                  ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(file.filename)}" />` : ''}
                  <div class="cascade-caption">
                    <span>#${idx + 1} · ${escapeHtml(file.filename)}</span>
                    ${file.is_processed ? '<span class="badge badge-processed">Оброблено</span>' : '<span class="muted-meta">Оригінал</span>'}
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
      canvasContent.innerHTML = `
        <div class="canvas-empty">
          <h2>AI Photo Studio Ready</h2>
          <p>Перетягніть зображення в ліву панель або натисніть «+ Додати фото», щоб почати локальну обробку.</p>
        </div>
      `;
      return;
    }

    const preview = controller.getActivePreview();
    if (!preview || !preview.originalUrl) {
      canvasContent.innerHTML = `<div class="muted-meta">Завантаження прев'ю ${escapeHtml(active.filename)}...</div>`;
      return;
    }

    if (active.is_processed && preview.outputUrl) {
      const pct = controller.sliderPercent;
      canvasContent.innerHTML = `
        <div class="compare-box" id="compare-box" tabindex="0" aria-label="Слайдер До і Після">
          <img class="compare-img-base" src="${escapeHtml(preview.originalUrl)}" alt="До обробки" />
          <div class="compare-after-layer" id="compare-after-layer" style="clip-path: inset(0 0 0 ${pct}%);">
            <img src="${escapeHtml(preview.outputUrl)}" alt="Після обробки" />
          </div>
          <div class="compare-divider" id="compare-divider" style="left: ${pct}%;">
            <div class="compare-handle">↔</div>
          </div>
          <span class="compare-tag before">До</span>
          <span class="compare-tag after">Після</span>
          <div class="image-overlay-actions">
            <button id="btn-img-download" class="btn btn-overlay" type="button">Download</button>
            <button id="btn-img-restore" class="btn btn-overlay" type="button">Restore</button>
          </div>
        </div>
      `;

      const box = document.getElementById('compare-box')!;
      const afterLayer = document.getElementById('compare-after-layer')!;
      const divider = document.getElementById('compare-divider')!;

      const applySlider = (clientX: number) => {
        const rect = box.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pctNext = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        controller.sliderPercent = pctNext;
        afterLayer.style.clipPath = `inset(0 0 0 ${pctNext}%)`;
        divider.style.left = `${pctNext}%`;
      };

      let dragging = false;
      box.addEventListener('pointerdown', (ev) => {
        if ((ev.target as HTMLElement).closest('button')) return;
        dragging = true;
        box.setPointerCapture(ev.pointerId);
        applySlider(ev.clientX);
      });
      box.addEventListener('pointermove', (ev) => {
        if (dragging) applySlider(ev.clientX);
      });
      box.addEventListener('pointerup', () => {
        dragging = false;
      });
      box.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowLeft') {
          controller.setSliderPercent(controller.sliderPercent - 5);
        } else if (ev.key === 'ArrowRight') {
          controller.setSliderPercent(controller.sliderPercent + 5);
        }
      });

      document.getElementById('btn-img-download')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try {
          const { filename, blob } = await controller.fetchOutputFileBlob(active.filename);
          triggerBlobDownload(filename, blob);
        } catch (err: any) {
          showToast(err?.message || String(err), true);
        }
      });

      document.getElementById('btn-img-restore')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try {
          await controller.restoreSingle(active.filename);
        } catch (err: any) {
          showToast(err?.message || String(err), true);
        }
      });
      return;
    }

    canvasContent.innerHTML = `
      <div class="single-viewer">
        <img src="${escapeHtml(preview.originalUrl)}" alt="${escapeHtml(active.filename)}" />
      </div>
    `;
  };

  const render = (): void => {
    accelBadge.textContent = controller.accelerator.toUpperCase();
    btnSelectCycle.textContent = controller.getSelectionButtonLabel();
    btnSelectCycle.disabled = controller.files.length === 0 || controller.isBusy;

    const selectedSet = new Set(controller.selectedOrder);
    fileListEl.innerHTML = controller.files
      .map((file) => {
        const isActive = controller.activeFilename === file.filename;
        const isSelected = selectedSet.has(file.filename);
        const dims = file.is_processed && file.output_width && file.output_height
          ? `${file.output_width}×${file.output_height}`
          : `${file.width}×${file.height}`;
        const sizeStr = formatBytes(file.output_size_bytes ?? file.size_bytes);
        return `
          <div class="file-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-filename="${escapeHtml(file.filename)}">
            <div class="file-thumb-wrap">
              ${file.thumbUrl ? `<img src="${escapeHtml(file.thumbUrl)}" alt="${escapeHtml(file.filename)}" />` : ''}
              ${
                controller.selectionMode === 'selecting'
                  ? `<span class="file-select-dot">${isSelected ? '✓' : ''}</span>`
                  : ''
              }
            </div>
            <div class="file-meta">
              <div class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
              <div class="file-sub">${dims} · ${sizeStr}</div>
            </div>
            <div>
              ${file.is_processed ? '<span class="badge badge-processed">Оброблено</span>' : ''}
            </div>
          </div>
        `;
      })
      .join('');

    fileListEl.querySelectorAll<HTMLElement>('.file-item').forEach((row) => {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fname = row.dataset.filename;
        if (!fname) return;
        if (controller.selectionMode === 'selecting') {
          controller.toggleFileSelection(fname);
        } else {
          controller.selectSingleFile(fname);
        }
      });
    });

    emptyDropHint.classList.toggle('compact', controller.files.length > 0);
    workspaceSummary.textContent = `${controller.files.length} файл(ів) · ${controller.processedCount} оброблено`;

    toolButtons.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
      const isAct = btn.dataset.tool === controller.tool;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', String(isAct));
    });

    selectFileType.value = controller.outputFormat;
    btnProcess.disabled = !controller.canProcessCurrent;
    btnProcessAll.disabled = !controller.canProcessAll;
    btnDownloadAll.disabled = !controller.canDownloadAll;
    btnRestoreAll.disabled = !controller.canRestoreAll;

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

  // Selection mode toggle
  btnSelectCycle.addEventListener('click', () => controller.cycleSelectionMode());

  // Toolbar tool switchers & format
  toolButtons.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.tool as StudioTool | undefined;
      if (next) controller.setTool(next);
    });
  });
  selectFileType.addEventListener('change', () => {
    controller.outputFormat = selectFileType.value as StudioOutputFormat;
  });

  // Process buttons
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

  // Connect to JetPack Daemon
  const startConnection = async (): Promise<void> => {
    connectionBanner.hidden = false;
    connectionBanner.className = 'connection-banner glass-panel';
    connectionBanner.innerHTML = '<span>Підключення до JetPack daemon та запуск AI Photo Studio...</span>';
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
        onProgress: (prog) => {
          connectionBanner.hidden = false;
          connectionBanner.innerHTML = `
            <div>
              <strong>Підготовка середовища (${escapeHtml(prog.stage || 'init')})</strong>
              <div class="muted-meta">${escapeHtml(prog.message || '')}</div>
            </div>
            <span class="badge badge-subtle">${Math.round(prog.percent ?? 0)}%</span>
          `;
        },
        onAfterStop: () => {
          controller.setClient(null);
          showToast('Воркер AI Photo Studio зупинено.');
        },
      });

      connectionBanner.hidden = true;
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
