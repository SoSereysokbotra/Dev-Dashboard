'use strict';

// Generates assets/icon.ico and high-res icon PNGs from assets/dev-dashboard.svg.
// Runs under Electron (using scripts/launch.js) to leverage Chromium canvas for
// clean anti-aliased SVG rasterization at all Windows standard icon sizes:
// 16, 24, 32, 48, 64, 128, 256.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SRC = path.join(ASSETS, 'dev-dashboard.svg');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function createIcoFromPngs(images) {
  const count = images.length;
  const headerSize = 6;
  const entrySize = 16;
  let currentOffset = headerSize + count * entrySize;

  const entries = [];
  for (const img of images) {
    const w = img.width >= 256 ? 0 : img.width;
    const h = img.height >= 256 ? 0 : img.height;
    const size = img.buffer.length;
    entries.push({
      width: w,
      height: h,
      size: size,
      offset: currentOffset,
      buffer: img.buffer,
    });
    currentOffset += size;
  }

  const out = Buffer.alloc(currentOffset);
  // Header: Reserved (0), Type (1 = icon), Count
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);

  let entryPos = 6;
  for (const e of entries) {
    out.writeUInt8(e.width, entryPos + 0);
    out.writeUInt8(e.height, entryPos + 1);
    out.writeUInt8(0, entryPos + 2); // color count
    out.writeUInt8(0, entryPos + 3); // reserved
    out.writeUInt16LE(1, entryPos + 4); // color planes
    out.writeUInt16LE(32, entryPos + 6); // bit count
    out.writeUInt32LE(e.size, entryPos + 8); // bytes in resource
    out.writeUInt32LE(e.offset, entryPos + 12); // image offset
    entryPos += 16;

    e.buffer.copy(out, e.offset);
  }

  return out;
}

app.disableHardwareAcceleration();

app.whenReady().then(async function () {
  if (!fs.existsSync(SRC)) {
    console.error('Source image not found: ' + SRC);
    app.exit(1);
    return;
  }

  const svgContent = fs.readFileSync(SRC, 'utf8');
  const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);

  const win = new BrowserWindow({
    show: false,
    width: 300,
    height: 300,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');

  const renderedImages = [];

  for (const size of ICO_SIZES) {
    const dataUrl = await win.webContents.executeJavaScript(
      'new Promise(function (resolve, reject) {' +
      '  var img = new Image();' +
      '  img.onload = function () {' +
      '    var S = ' + size + ';' +
      '    var c = document.createElement("canvas");' +
      '    c.width = S; c.height = S;' +
      '    var ctx = c.getContext("2d");' +
      '    ctx.imageSmoothingEnabled = true;' +
      '    ctx.imageSmoothingQuality = "high";' +
      '    var pad = S <= 24 ? 1 : Math.round(S * 0.05);' +
      '    var box = S - pad * 2;' +
      '    ctx.drawImage(img, pad, pad, box, box);' +
      '    resolve(c.toDataURL("image/png"));' +
      '  };' +
      '  img.onerror = function () { reject(new Error("decode failed for SVG")); };' +
      '  img.src = ' + JSON.stringify(dataUri) + ';' +
      '})'
    );

    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    renderedImages.push({ width: size, height: size, buffer: buf });

    if (size === 256) {
      fs.writeFileSync(path.join(ASSETS, 'icon.png'), buf);
      console.log('wrote icon.png (256x256, ' + buf.length + ' bytes)');
    }
  }

  const icoBuf = createIcoFromPngs(renderedImages);
  const icoPath = path.join(ASSETS, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);
  console.log('wrote icon.ico (' + renderedImages.length + ' sizes, ' + icoBuf.length + ' bytes)');

  app.exit(0);
});
