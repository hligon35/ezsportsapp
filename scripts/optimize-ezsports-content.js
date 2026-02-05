#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs/promises');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Missing dependency: sharp. Install with: npm install --save-dev sharp');
  process.exit(1);
}

let heicConvert = null;
try {
  // Optional: used to decode iPhone HEIC/HEIF reliably on systems where libheif isn't available in sharp.
  heicConvert = require('heic-convert');
} catch {}

let ffmpegStaticPath = null;
try {
  // Optional: bundled ffmpeg binary (recommended on Windows)
  ffmpegStaticPath = require('ffmpeg-static');
} catch {}

const FFMPEG_CMD = ffmpegStaticPath || 'ffmpeg';

const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'assets', 'content', 'EZSports Content');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'assets', 'content', 'ezsports-content-optimized');

const IMAGE_EXTS = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const VIDEO_EXTS = new Set(['.mov', '.mp4', '.m4v', '.webm']);

function toWebPath(absPath) {
  const rel = path.relative(PROJECT_ROOT, absPath);
  return rel.split(path.sep).join('/');
}

function safeBaseName(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function titleFromBase(base) {
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function hasFfmpeg() {
  try {
    const res = spawnSync(FFMPEG_CMD, ['-version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function optimizeImage(inputPath, outDir) {
  const originalName = path.basename(inputPath);
  const base = safeBaseName(originalName);

  const ext = path.extname(originalName).toLowerCase();
  let image;
  if ((ext === '.heic' || ext === '.heif') && heicConvert) {
    const raw = await fs.readFile(inputPath);
    const decoded = await heicConvert({ buffer: raw, format: 'JPEG', quality: 0.92 });
    image = sharp(decoded, { failOnError: false });
  } else {
    image = sharp(inputPath, { failOnError: false });
  }
  const meta = await image.metadata();
  const originalWidth = meta.width || 0;
  const originalHeight = meta.height || 0;

  // Produce sizes that work well for carousels + general content.
  // Keep count small to avoid repo bloat.
  const targets = [640, 1280].filter((w) => !originalWidth || w <= originalWidth);
  if (targets.length === 0) targets.push(640);

  const sources = [];
  for (const width of targets) {
    const outPath = path.join(outDir, `${base}-${width}.webp`);
    await image
      .clone()
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toFile(outPath);

    // Best-effort dimensions for layout stability
    const scale = originalWidth ? Math.min(1, width / originalWidth) : 1;
    sources.push({
      src: toWebPath(outPath),
      width,
      format: 'webp',
      height: originalHeight ? Math.round(originalHeight * scale) : null,
    });
  }

  return {
    type: 'image',
    original: toWebPath(inputPath),
    alt: titleFromBase(base),
    width: originalWidth || null,
    height: originalHeight || null,
    sources,
  };
}

function runFfmpegConvertMovToMp4(inputPath, outPath) {
  return new Promise((resolve, reject) => {
    // Conservative, broadly compatible encode.
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      outPath,
    ];

    const child = spawn(FFMPEG_CMD, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function optimizeVideo(inputPath, outDir, ffmpegAvailable) {
  const originalName = path.basename(inputPath);
  const base = safeBaseName(originalName);

  // If ffmpeg exists, convert MOV -> MP4; otherwise copy as-is so the manifest is still complete.
  const ext = path.extname(originalName).toLowerCase();
  const outExt = ffmpegAvailable && ext === '.mov' ? '.mp4' : ext;
  const outPath = path.join(outDir, `${base}${outExt}`);

  if (ffmpegAvailable && ext === '.mov') {
    await runFfmpegConvertMovToMp4(inputPath, outPath);
  } else {
    await fs.copyFile(inputPath, outPath);
  }

  return {
    type: 'video',
    original: toWebPath(inputPath),
    src: toWebPath(outPath),
    optimized: ffmpegAvailable && ext === '.mov',
  };
}

async function main() {
  await ensureDir(OUTPUT_DIR);

  const ffmpegAvailable = hasFfmpeg();
  if (!ffmpegAvailable) {
    console.warn('ffmpeg not available. Video will be copied without conversion.');
    console.warn('Install ffmpeg (or add ffmpeg-static) and re-run this script for MOV->MP4 optimization.');
  }

  const entries = await fs.readdir(INPUT_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  const items = [];
  for (const fileName of files) {
    const abs = path.join(INPUT_DIR, fileName);
    const ext = path.extname(fileName).toLowerCase();

    try {
      if (IMAGE_EXTS.has(ext)) {
        console.log('Optimizing image:', fileName);
        items.push(await optimizeImage(abs, OUTPUT_DIR));
      } else if (VIDEO_EXTS.has(ext)) {
        console.log('Processing video:', fileName);
        items.push(await optimizeVideo(abs, OUTPUT_DIR, ffmpegAvailable));
      } else {
        console.log('Skipping unsupported file:', fileName);
      }
    } catch (e) {
      console.warn(`Failed to process ${fileName}: ${e.message}`);
    }
  }

  // Keep manifest stable / deterministic order
  items.sort((a, b) => (a.original || '').localeCompare(b.original || ''));

  const manifest = {
    generatedAt: new Date().toISOString(),
    inputDir: toWebPath(INPUT_DIR),
    outputDir: toWebPath(OUTPUT_DIR),
    items,
  };

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Wrote manifest:', toWebPath(manifestPath));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
