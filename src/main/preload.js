const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Directory selection
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // Project detection
  detectProject: (projectPath) => ipcRenderer.invoke('detect-project', projectPath),

  // Docker status
  checkDockerDaemon: () => ipcRenderer.invoke('check-docker-daemon'),
  getDockerContainers: (projectPath) => ipcRenderer.invoke('get-docker-containers', projectPath),

  // Code execution
  executeCode: (projectPath, code, useDocker, container, models) =>
    ipcRenderer.invoke('execute-code', { projectPath, code, useDocker, container, models }),

  // Raw PHP execution
  executePhp: (projectPath, code, useDocker, container) =>
    ipcRenderer.invoke('execute-php', { projectPath, code, useDocker, container }),

  // Platform info
  platform: process.platform
});
