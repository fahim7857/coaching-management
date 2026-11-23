import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure production database is stored in writable Windows AppData (%LOCALAPPDATA%\CoachingCenterManagement)
const appDataDir = app.getPath('userData');
process.env.COACHING_DATA_DIR = appDataDir;

let mainWindow = null;
let serverPort = 3000;

async function launchApp() {
    try {
        // Start Express backend and SQLite database on a free port
        serverPort = await startServer();
    } catch (err) {
        console.error('Failed to start Express backend:', err);
    }

    createWindow();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Coaching Center Management System',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false
    });

    // Load the running Express server
    mainWindow.loadURL(`http://localhost:${serverPort}`);

    // Show window smoothly when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    launchApp();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
