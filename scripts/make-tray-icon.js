'use strict';

// Generates the tray PNGs from assets/dev-dashboard.svg.
//
// Electron's nativeImage works best when pre-rendered PNGs at each Windows DPI
// scale (16, 20, 24, 32, 64) are supplied. This runs under Electron and uses
// Chromium canvas to rasterize cleanly with anti-aliasing.
//
// Run with:  npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SRC = path.join(ASSETS, 'dev-dashboard.svg');

// Windows draws the tray at 16px logical; 20/24/32/64 cover common DPI scales.
const SIZES = [16, 20, 24, 32, 64];

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
    width: 128,
    height: 128,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');

  for (const size of SIZES) {
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
      '    var pad = S <= 20 ? 1 : Math.round(S * 0.06);' +
      '    var box = S - pad * 2;' +
      '    ctx.drawImage(img, pad, pad, box, box);' +
      '    resolve(c.toDataURL("image/png"));' +
      '  };' +
      '  img.onerror = function () { reject(new Error("decode failed for SVG")); };' +
      '  img.src = ' + JSON.stringify(dataUri) + ';' +
      '})'
    );

    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const name = size === 32 ? 'tray.png' : 'tray-' + size + '.png';
    fs.writeFileSync(path.join(ASSETS, name), buf);
    console.log('wrote ' + name + ' (' + size + 'x' + size + ', ' + buf.length + ' bytes)');
  }

  app.exit(0);
});
