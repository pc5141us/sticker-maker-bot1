import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import sharp from 'sharp';

// Configure ffmpeg static path
const ffmpegPath = (ffmpegInstaller as any)?.default || ffmpegInstaller;
if (typeof ffmpegPath === 'string') {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function getChromeExecutablePath(): string | undefined {
  const possiblePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(process.env.HOME || '', '.cache/puppeteer/chrome/mac_arm-127.0.6533.88/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export class TgsEngine {
  private static instance: TgsEngine;
  private browser: Browser | null = null;
  private lottieJs: string;
  private idleTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    const lottiePath = path.resolve('node_modules/lottie-web/build/player/lottie.min.js');
    if (fs.existsSync(lottiePath)) {
      this.lottieJs = fs.readFileSync(lottiePath, 'utf-8');
    } else {
      this.lottieJs = '';
    }
  }

  public static getInstance(): TgsEngine {
    if (!TgsEngine.instance) {
      TgsEngine.instance = new TgsEngine();
    }
    return TgsEngine.instance;
  }

  public isAvailable(): boolean {
    const p = getChromeExecutablePath();
    return !!p && fs.existsSync(p);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    if (!this.browser || !this.browser.connected) {
      const execPath = getChromeExecutablePath();
      this.browser = await puppeteer.launch({
        executablePath: execPath,
        headless: 'new' as any,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding'
        ]
      });
    }

    this.scheduleIdleShutdown();
    return this.browser;
  }

  private scheduleIdleShutdown() {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    this.idleTimeout = setTimeout(async () => {
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (_) {}
        this.browser = null;
      }
    }, 300000); // إبقاء المتصفح في الذاكرة 5 دقائق بعد الاستخدام لمنع بطء التشغيل البارد
  }

  /**
   * Convert a .tgs sticker file to a WhatsApp-compatible animated WebP (< 500KB, 512x512)
   */
  public async convertTgs(tgsPath: string, outputPath: string): Promise<string> {
    const browser = await this.getBrowser();
    const tgsBuffer = await fs.promises.readFile(tgsPath);
    const animJson = JSON.parse(zlib.gunzipSync(tgsBuffer).toString('utf-8'));

    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 512, height: 512 });

      const html = `
        <!DOCTYPE html>
        <html><body>
          <div id="anim" style="width:512px;height:512px;"></div>
          <script>${this.lottieJs}</script>
          <script>
            window.getFrames = function(animData) {
              const container = document.getElementById('anim');
              const anim = lottie.loadAnimation({
                container: container,
                renderer: 'canvas',
                loop: false,
                autoplay: false,
                animationData: animData
              });
              const canvas = container.querySelector('canvas');
              const totalFrames = animData.op - animData.ip;
              const targetFps = 9;
              const step = Math.max(1, Math.round(animData.fr / targetFps));
              const frames = [];
              for (let i = 0; i < totalFrames; i += step) {
                anim.goToAndStop(i, true);
                frames.push(canvas.toDataURL('image/png').split(',')[1]);
              }
              anim.destroy();
              return frames.slice(0, 27); // max 27 frames (3 seconds at 9 fps)
            };
          </script>
        </body></html>
      `;

      await page.setContent(html);
      const frames: string[] = await page.evaluate((d: any) => (globalThis as any).getFrames(d), animJson);
      await page.close();

      if (!frames || frames.length === 0) {
        throw new Error('لم يتم استخراج أي إطارات من الاستكر المتحرك');
      }

      const uniqueId = Math.random().toString(36).substring(2, 9);
      const framesDir = path.join(path.dirname(outputPath), `tgs_frames_${uniqueId}`);
      await fs.promises.mkdir(framesDir, { recursive: true });

      for (let i = 0; i < frames.length; i++) {
        await fs.promises.writeFile(
          path.join(framesDir, `frame_${i}.png`),
          Buffer.from(frames[i], 'base64')
        );
      }

      await new Promise<void>((resolve, reject) => {
        ffmpeg(path.join(framesDir, 'frame_%d.png'))
          .inputOptions('-framerate 9')
          .outputOptions([
            '-vf scale=384:384:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
            '-vcodec libwebp',
            '-lossless 0',
            '-compression_level 2',
            '-q:v 25',
            '-loop 0',
            '-an',
            '-threads 0'
          ])
          .save(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err));
      });

      await fs.promises.rm(framesDir, { recursive: true, force: true }).catch(() => {});

      // Verify file size does not exceed 480KB
      const stats = await fs.promises.stat(outputPath);
      if (stats.size > 480 * 1024) {
        const compressedPath = outputPath.replace('.webp', '_comp.webp');
        await sharp(outputPath, { animated: true })
          .webp({ quality: 25, effort: 2 })
          .toFile(compressedPath);
        await fs.promises.rename(compressedPath, outputPath);
      }

      return outputPath;
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    } finally {
      this.scheduleIdleShutdown();
    }
  }

  public async close(): Promise<void> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

export const tgsEngine = TgsEngine.getInstance();
