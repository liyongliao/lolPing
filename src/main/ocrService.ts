import { app } from 'electron';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Worker } from 'tesseract.js';

/** Offline models and worker are created only when OCR is explicitly used. */
export class OcrService {
  private worker: Promise<Worker> | null = null;
  private disposed = false;
  async recognize(png: Buffer): Promise<string> {
    if (this.disposed) throw new Error('文字识别已关闭');
    this.worker ??= this.create().catch(error => { this.worker = null; throw error; });
    const worker = await this.worker;
    const result = await worker.recognize(png);
    return result.data.text.trim();
  }
  private async create(): Promise<Worker> {
    const dir = join(app.getPath('userData'), 'ocr-models');
    await mkdir(dir, { recursive: true });
    for (const lang of ['chi_sim', 'eng']) {
      const destination = join(dir, `${lang}.traineddata.gz`);
      try { await access(destination); }
      catch { await copyFile(require.resolve(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), destination); }
    }
    const { createWorker, OEM } = await import('tesseract.js');
    const path = require.resolve('tesseract.js/src/worker-script/node/index.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const worker = await createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, { langPath: dir, gzip: true, cachePath: dir, workerPath: path });
    if (this.disposed) { await worker.terminate(); throw new Error('文字识别已关闭'); }
    return worker;
  }
  dispose(): void { this.disposed = true; void this.worker?.then(w => w.terminate()).catch(() => undefined); }
}
