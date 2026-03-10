/**
 * Convert pixel-art car PNGs to SpriteData arrays for spriteData.ts
 *
 * Strategy: crop to car region → downsample by native grid → remove bg via flood fill →
 * crop to bounding box → scale to target size → output TypeScript SpriteData
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ASSETS = path.join(__dirname, '..', 'webview-ui', 'public', 'assets');

// Target: Porsche is 69x22 (5x2 tiles). Max 80x32 to fit in 5-tile-wide garage.
const MAX_WIDTH = 80;
const MAX_HEIGHT = 32;

const CARS = [
  {
    name: 'LAMBO',
    file: 'lambo.png',
    gridSize: 7,
    cropPx: [105, 175, 665, 350], // car body only, inside the border/cyan
    bgThreshold: 35,
  },
  {
    name: 'FERRARI',
    file: 'ferrari.png',
    gridSize: 5,
    cropPx: [620, 195, 300, 225], // side view only
    bgThreshold: 20,
  },
  {
    name: 'MULTIPLA',
    file: 'multipla.png',
    gridSize: 8,
    cropPx: [112, 160, 360, 240],
    bgThreshold: 25,
  },
  {
    name: 'MASSERATI',
    file: 'masserati.png',
    gridSize: 8,
    cropPx: [168, 96, 816, 440],
    bgThreshold: 25,
  },
  {
    name: 'RANGE_ROVER',
    file: 'range-rover.png',
    gridSize: 8,
    cropPx: [112, 96, 672, 504],
    bgThreshold: 25,
  },
];

function readPng(filePath) {
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
}

function toHex(c) {
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

function colorDistance(c1, c2) {
  return Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
}

function downsample(png, gridSize, cropPx) {
  const [cx, cy, cw, ch] = cropPx;
  const cols = Math.floor(cw / gridSize);
  const rows = Math.floor(ch / gridSize);
  const pixels = [];

  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const px = cx + Math.floor(c * gridSize + gridSize / 2);
      const py = cy + Math.floor(r * gridSize + gridSize / 2);
      row.push(getPixel(png, px, py));
    }
    pixels.push(row);
  }
  return { pixels, cols, rows };
}

function floodFillRemoveBg(pixels, rows, cols, threshold) {
  // Find bg color from corners
  const corners = [pixels[0][0], pixels[0][cols-1], pixels[rows-1][0], pixels[rows-1][cols-1]];
  const bgColor = corners[0]; // top-left corner as reference

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const result = pixels.map(row => [...row]);
  const queue = [];

  const isBgLike = (p) => {
    if (!p) return true;
    if (colorDistance(p, bgColor) < threshold) return true;
    // Also treat near-white as bg
    if (p.r > 235 && p.g > 235 && p.b > 235) return true;
    return false;
  };

  // Seed from all edges
  for (let c = 0; c < cols; c++) {
    queue.push([0, c], [rows - 1, c]);
  }
  for (let r = 0; r < rows; r++) {
    queue.push([r, 0], [r, cols - 1]);
  }

  while (queue.length > 0) {
    const [r, c] = queue.pop();
    if (r < 0 || r >= rows || c < 0 || c >= cols || visited[r][c]) continue;
    visited[r][c] = true;

    if (isBgLike(result[r][c])) {
      result[r][c] = null;
      queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }
  }
  return result;
}

function removeGroundLine(pixels, rows, cols) {
  const result = pixels.map(row => [...row]);
  for (let r = rows - 1; r >= Math.max(0, rows - 4); r--) {
    let nonNull = 0, grayish = 0;
    for (let c = 0; c < cols; c++) {
      const p = result[r][c];
      if (p) {
        nonNull++;
        const avg = (p.r + p.g + p.b) / 3;
        const maxDiff = Math.max(Math.abs(p.r - avg), Math.abs(p.g - avg), Math.abs(p.b - avg));
        if (maxDiff < 15 && avg > 60 && avg < 200) grayish++;
      }
    }
    if (nonNull > 0 && grayish / nonNull > 0.5) {
      for (let c = 0; c < cols; c++) {
        const p = result[r][c];
        if (p) {
          const avg = (p.r + p.g + p.b) / 3;
          const maxDiff = Math.max(Math.abs(p.r - avg), Math.abs(p.g - avg), Math.abs(p.b - avg));
          if (maxDiff < 15 && avg > 60 && avg < 200) result[r][c] = null;
        }
      }
    }
  }
  return result;
}

function cropToBounds(pixels, rows, cols) {
  let minR = rows, maxR = 0, minC = cols, maxC = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pixels[r][c]) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (minR > maxR) return { pixels: [[]], width: 0, height: 0 };
  const cropped = [];
  for (let r = minR; r <= maxR; r++) {
    cropped.push(pixels[r].slice(minC, maxC + 1));
  }
  return { pixels: cropped, width: maxC - minC + 1, height: maxR - minR + 1 };
}

/**
 * Nearest-neighbor scale to fit within maxW x maxH
 */
function scaleToFit(pixels, width, height, maxW, maxH) {
  if (width <= maxW && height <= maxH) return { pixels, width, height };

  const scale = Math.min(maxW / width, maxH / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const result = [];
  for (let r = 0; r < newH; r++) {
    const row = [];
    for (let c = 0; c < newW; c++) {
      const srcX = Math.floor(c / scale);
      const srcY = Math.floor(r / scale);
      row.push(pixels[Math.min(srcY, height - 1)][Math.min(srcX, width - 1)]);
    }
    result.push(row);
  }

  return { pixels: result, width: newW, height: newH };
}

function toSpriteData(pixels, width, height) {
  return pixels.map(row => row.map(p => p ? toHex(p) : ''));
}

function formatSpriteData(name, spriteData) {
  const w = spriteData[0].length;
  const h = spriteData.length;
  const tileW = Math.ceil(w / 16);
  const tileH = Math.ceil(h / 16);

  const lines = spriteData.map(row => {
    const cells = row.map(c => c ? `'${c}'` : `''`);
    return `  [${cells.join(',')}],`;
  });

  return `/** ${name}: ${w}x${h} pixels (~${tileW}x${tileH} tiles) */\nexport const ${name}_SPRITE: SpriteData = [\n${lines.join('\n')}\n]`;
}

// Debug: write a visible PNG of the sprite
function writeDebugPng(name, spriteData) {
  const h = spriteData.length;
  const w = spriteData[0].length;
  const scale = 4;
  const png = new PNG({ width: w * scale, height: h * scale });

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const hex = spriteData[r][c];
      let pr = 200, pg = 200, pb = 200, pa = 255;
      if (hex) {
        pr = parseInt(hex.slice(1, 3), 16);
        pg = parseInt(hex.slice(3, 5), 16);
        pb = parseInt(hex.slice(5, 7), 16);
      } else {
        pa = 0;
      }
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const idx = ((r * scale + sy) * w * scale + (c * scale + sx)) * 4;
          png.data[idx] = pr;
          png.data[idx + 1] = pg;
          png.data[idx + 2] = pb;
          png.data[idx + 3] = pa;
        }
      }
    }
  }

  const buffer = PNG.sync.write(png);
  const outPath = path.join(__dirname, `debug_${name.toLowerCase()}.png`);
  fs.writeFileSync(outPath, buffer);
  console.log(`  Debug PNG: ${outPath}`);
}

// Process
for (const car of CARS) {
  console.log(`\n=== ${car.name} (${car.file}) ===`);

  const png = readPng(path.join(ASSETS, car.file));
  console.log(`  Source: ${png.width}x${png.height}`);

  const { pixels, cols, rows } = downsample(png, car.gridSize, car.cropPx);
  console.log(`  Downsampled: ${cols}x${rows}`);

  // Log corner colors for debugging
  const tl = pixels[0][0], tr = pixels[0][cols-1], bl = pixels[rows-1][0], br = pixels[rows-1][cols-1];
  console.log(`  Corners: TL=rgb(${tl.r},${tl.g},${tl.b}) TR=rgb(${tr.r},${tr.g},${tr.b}) BL=rgb(${bl.r},${bl.g},${bl.b}) BR=rgb(${br.r},${br.g},${br.b})`);

  let cleaned = floodFillRemoveBg(pixels, rows, cols, car.bgThreshold);
  cleaned = removeGroundLine(cleaned, rows, cols);

  let { pixels: cropped, width, height } = cropToBounds(cleaned, rows, cols);
  console.log(`  After crop: ${width}x${height}`);

  const { pixels: scaled, width: sw, height: sh } = scaleToFit(cropped, width, height, MAX_WIDTH, MAX_HEIGHT);
  console.log(`  After scale: ${sw}x${sh} (${Math.ceil(sw/16)}x${Math.ceil(sh/16)} tiles)`);

  const spriteData = toSpriteData(scaled, sw, sh);
  writeDebugPng(car.name, spriteData);

  const output = formatSpriteData(car.name, spriteData);
  const outPath = path.join(__dirname, `${car.name.toLowerCase()}_sprite.ts`);
  fs.writeFileSync(outPath, output);
  console.log(`  Written to: ${outPath}`);
}
