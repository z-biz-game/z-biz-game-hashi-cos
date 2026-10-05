// Desktop shell: the game is a browser build, so Electron serves it over the same
// zero-dependency static server instead of file:// (ES module imports need an origin).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../server.cjs');

// 桌面壳也归视觉母题管：icons/ 是 assets/gen/make_art.py 烤出来的真 PNG（512² RGBA），
// 这里把它接到窗口/任务栏上，而不是让资产躺在盘上只有浏览器读。
const WIN_ICON = path.join(__dirname, '..', 'icons', 'icon-512.png');

async function createWindow() {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: '#0b1526',
    title: '数桥 HASHI',
    autoHideMenuBar: true,
    ...(fs.existsSync(WIN_ICON) ? { icon: WIN_ICON } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  win.on('closed', () => server.close());
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
