const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

let mainWindow;

// Common paths where Docker binaries might be located
const DOCKER_PATHS = [
  '/usr/local/bin',
  '/usr/bin',
  '/opt/homebrew/bin',
  '/opt/local/bin',
  '/Applications/Docker.app/Contents/Resources/bin',
  process.env.HOME + '/.docker/bin'
];

// Get extended PATH for Docker commands
function getExtendedPath() {
  const currentPath = process.env.PATH || '';
  const additionalPaths = DOCKER_PATHS.filter(p => !currentPath.includes(p)).join(':');
  return additionalPaths ? `${additionalPaths}:${currentPath}` : currentPath;
}

// Find Docker binary
function findDockerBinary(binary) {
  const extendedPath = getExtendedPath();
  const paths = extendedPath.split(':');

  for (const p of paths) {
    const fullPath = path.join(p, binary);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return binary; // fallback to just the binary name
}

// Get environment with extended PATH
function getDockerEnv() {
  return {
    ...process.env,
    PATH: getExtendedPath()
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  // Disable Cmd+R / Ctrl+R refresh
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Select project directory
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Laravel Project Directory'
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Check if Docker daemon is running
ipcMain.handle('check-docker-daemon', async () => {
  return await isDockerDaemonRunning();
});

// Get running Docker containers for project
ipcMain.handle('get-docker-containers', async (event, projectPath) => {
  return await getRunningContainers(projectPath);
});

// Detect project type and environment
ipcMain.handle('detect-project', async (event, projectPath) => {
  const info = {
    isLaravel: false,
    hasSail: false,
    hasDocker: false,
    sailRunning: false,
    dockerDaemonRunning: false,
    runningContainers: [],
    phpVersion: null,
    laravelVersion: null,
    models: []
  };

  try {
    // Check for Laravel (artisan file)
    const artisanPath = path.join(projectPath, 'artisan');
    info.isLaravel = fs.existsSync(artisanPath);

    // Scan for models if Laravel project
    if (info.isLaravel) {
      info.models = scanModels(projectPath);
    }

    // Check for Sail
    const sailPath = path.join(projectPath, 'vendor/bin/sail');
    info.hasSail = fs.existsSync(sailPath);

    // Check for docker-compose.yml
    const dockerComposePath = path.join(projectPath, 'docker-compose.yml');
    info.hasDocker = fs.existsSync(dockerComposePath);

    // Check if Docker daemon is running
    info.dockerDaemonRunning = await isDockerDaemonRunning();

    // Check if Sail/Docker is running
    if ((info.hasSail || info.hasDocker) && info.dockerDaemonRunning) {
      info.sailRunning = await checkDockerRunning(projectPath);
      if (info.sailRunning) {
        info.runningContainers = await getRunningContainers(projectPath);
      }
    }

    // Get PHP version
    info.phpVersion = await getPhpVersion(projectPath, info);

    // Get Laravel version from composer.json
    const composerPath = path.join(projectPath, 'composer.json');
    if (fs.existsSync(composerPath)) {
      const composer = JSON.parse(fs.readFileSync(composerPath, 'utf-8'));
      if (composer.require && composer.require['laravel/framework']) {
        info.laravelVersion = composer.require['laravel/framework'];
      }
    }

  } catch (error) {
    console.error('Error detecting project:', error);
  }

  return info;
});

// Execute code
ipcMain.handle('execute-code', async (event, { projectPath, code, useDocker, container, models }) => {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Wrap the code for execution via artisan tinker
    const wrappedCode = wrapCodeForTinker(code, models || []);

    let command;
    let args;
    let options = {
      cwd: projectPath,
      env: { ...getDockerEnv(), TERM: 'dumb' },
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    };

    if (useDocker) {
      const containerName = container || 'laravel.test';
      // Use Sail or docker-compose exec
      const sailPath = path.join(projectPath, 'vendor/bin/sail');
      if (fs.existsSync(sailPath) && containerName === 'laravel.test') {
        command = './vendor/bin/sail';
        args = ['artisan', 'tinker', '--execute', wrappedCode];
      } else {
        command = findDockerBinary('docker-compose');
        args = ['exec', '-T', containerName, 'php', 'artisan', 'tinker', '--execute', wrappedCode];
      }
    } else {
      command = 'php';
      args = ['artisan', 'tinker', '--execute', wrappedCode];
    }

    const child = spawn(command, args, options);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      const executionTime = Date.now() - startTime;

      // Clean up output (remove tinker prompts and artifacts)
      let output = cleanTinkerOutput(stdout);

      resolve({
        success: exitCode === 0,
        output: output,
        error: stderr,
        executionTime,
        exitCode
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        output: '',
        error: error.message,
        executionTime: Date.now() - startTime,
        exitCode: -1
      });
    });
  });
});

// Execute raw PHP code (without Laravel)
ipcMain.handle('execute-php', async (event, { projectPath, code, useDocker, container }) => {
  return new Promise((resolve) => {
    const startTime = Date.now();

    let command;
    let args;
    let options = {
      cwd: projectPath,
      env: getDockerEnv(),
      maxBuffer: 1024 * 1024 * 10
    };

    if (useDocker) {
      const containerName = container || 'laravel.test';
      const sailPath = path.join(projectPath, 'vendor/bin/sail');
      if (fs.existsSync(sailPath) && containerName === 'laravel.test') {
        command = './vendor/bin/sail';
        args = ['php', '-r', code];
      } else {
        command = findDockerBinary('docker-compose');
        args = ['exec', '-T', containerName, 'php', '-r', code];
      }
    } else {
      command = 'php';
      args = ['-r', code];
    }

    const child = spawn(command, args, options);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        output: stdout,
        error: stderr,
        executionTime: Date.now() - startTime,
        exitCode
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        output: '',
        error: error.message,
        executionTime: Date.now() - startTime,
        exitCode: -1
      });
    });
  });
});

// Helper functions

async function isDockerDaemonRunning() {
  return new Promise((resolve) => {
    const dockerBinary = findDockerBinary('docker');
    exec(`"${dockerBinary}" info`, { env: getDockerEnv() }, (error) => {
      resolve(!error);
    });
  });
}

async function checkDockerRunning(projectPath) {
  return new Promise((resolve) => {
    const dockerBinary = findDockerBinary('docker');
    // Use docker compose v2 syntax
    exec(`"${dockerBinary}" compose ps --format json`, {
      cwd: projectPath,
      env: getDockerEnv()
    }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(false);
        return;
      }
      // Check if any container is running
      const lines = stdout.trim().split('\n').filter(l => l.startsWith('{'));
      for (const line of lines) {
        try {
          const container = JSON.parse(line);
          if (container.State === 'running') {
            resolve(true);
            return;
          }
        } catch (e) {}
      }
      resolve(false);
    });
  });
}

async function getRunningContainers(projectPath) {
  return new Promise((resolve) => {
    const dockerBinary = findDockerBinary('docker');
    // Use docker compose v2 syntax (space, not hyphen)
    exec(`"${dockerBinary}" compose ps --format json`, {
      cwd: projectPath,
      env: getDockerEnv()
    }, (error, stdout) => {
      if (!error && stdout.trim()) {
        try {
          // Parse JSON output - each line is a JSON object
          const lines = stdout.trim().split('\n').filter(l => l.length > 0 && l.startsWith('{'));
          const services = new Set();
          for (const line of lines) {
            const container = JSON.parse(line);
            if (container.State === 'running' && container.Service) {
              services.add(container.Service);
            }
          }
          if (services.size > 0) {
            resolve(Array.from(services));
            return;
          }
        } catch (e) {
          // JSON parsing failed
        }
      }

      // Fallback: try docker-compose v1
      const dockerCompose = findDockerBinary('docker-compose');
      exec(`"${dockerCompose}" ps --services`, {
        cwd: projectPath,
        env: getDockerEnv()
      }, (err, out) => {
        if (err || !out.trim()) {
          resolve(['laravel.test']);
          return;
        }
        const containers = out.trim().split('\n').filter(c => c.length > 0);
        resolve(containers.length > 0 ? containers : ['laravel.test']);
      });
    });
  });
}

async function getPhpVersion(projectPath, info) {
  return new Promise((resolve) => {
    let command;
    let options = {
      cwd: projectPath,
      env: getDockerEnv()
    };

    if (info.sailRunning) {
      command = './vendor/bin/sail php -v';
    } else {
      command = 'php -v';
    }

    exec(command, options, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const match = stdout.match(/PHP (\d+\.\d+\.\d+)/);
      resolve(match ? match[1] : null);
    });
  });
}

// Scan for model classes in the project
function scanModels(projectPath) {
  const models = [];
  const modelsDir = path.join(projectPath, 'app', 'Models');

  if (!fs.existsSync(modelsDir)) {
    return models;
  }

  function scanDir(dir, namespace) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        // Recurse into subdirectories
        scanDir(filePath, `${namespace}\\${file}`);
      } else if (file.endsWith('.php')) {
        const className = file.replace('.php', '');
        const fullNamespace = `${namespace}\\${className}`;
        models.push({
          name: className,
          namespace: fullNamespace
        });
      }
    }
  }

  scanDir(modelsDir, 'App\\Models');

  return models;
}

function wrapCodeForTinker(code, models) {
  // Remove opening PHP tag if present
  code = code.replace(/^<\?php\s*/i, '');
  code = code.replace(/^\s*<\?\s*/i, '');

  // Generate use statements for models
  if (models && models.length > 0) {
    const useStatements = models
      .map(m => `use ${m.namespace};`)
      .join(' ');
    code = `${useStatements} ${code}`;
  }

  return code;
}

function cleanTinkerOutput(output) {
  // Remove tinker prompt artifacts
  let cleaned = output
    .replace(/>>>\s*/g, '')
    .replace(/\.\.\.\s*/g, '')
    .replace(/=>\s*null\s*$/gm, '')
    .replace(/Psy Shell.*\n/g, '')
    .trim();

  return cleaned;
}
