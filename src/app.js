// Tauri API
const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

// Monaco Editor Setup
require.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
  }
});

let editor;
let currentProject = null;
let projectInfo = null;

const defaultCode = `$users = User::all();
dump($users->count());
`;

// Theme management
let currentTheme = localStorage.getItem('theme') || 'dark';

function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
  }

  if (editor) {
    monaco.editor.setTheme(theme === 'dark' ? 'tinkerbestDark' : 'tinkerbestLight');
  }
}

// Initialize Monaco Editor
require(['vs/editor/editor.main'], function () {
  monaco.languages.register({ id: 'php' });

  monaco.editor.defineTheme('tinkerbestDark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: 'C586C0' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'type', foreground: '4EC9B0' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#2a2a2a',
      'editorCursor.foreground': '#aeafad',
    }
  });

  monaco.editor.defineTheme('tinkerbestLight', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000' },
      { token: 'keyword', foreground: 'AF00DB' },
      { token: 'string', foreground: 'A31515' },
      { token: 'number', foreground: '098658' },
      { token: 'variable', foreground: '001080' },
      { token: 'type', foreground: '267f99' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1e1e1e',
      'editorLineNumber.foreground': '#6e6e6e',
      'editorLineNumber.activeForeground': '#1e1e1e',
      'editor.selectionBackground': '#add6ff',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editorCursor.foreground': '#1e1e1e',
    }
  });

  editor = monaco.editor.create(document.getElementById('editor'), {
    value: defaultCode,
    language: 'php',
    theme: currentTheme === 'dark' ? 'tinkerbestDark' : 'tinkerbestLight',
    fontSize: 14,
    fontFamily: "'SF Mono', 'Fira Code', 'Monaco', Consolas, monospace",
    lineNumbers: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    suggest: {
      showKeywords: true,
      showSnippets: true,
    }
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    runCode();
  });

  editor.focus();
});

// DOM Elements
const selectProjectBtn = document.getElementById('selectProject');
const projectNameSpan = document.getElementById('projectName');
const runButton = document.getElementById('runButton');
const clearOutputBtn = document.getElementById('clearOutput');
const outputDiv = document.getElementById('output');
const statusSpan = document.getElementById('status');
const projectPathSpan = document.getElementById('projectPath');
const useDockerCheckbox = document.getElementById('useDocker');
const dockerControls = document.getElementById('dockerControls');
const containerSelect = document.getElementById('containerSelect');
const executionTimeSpan = document.getElementById('executionTime');
const projectInfoDiv = document.getElementById('projectInfo');
const laravelBadge = document.getElementById('laravelBadge');
const phpVersionBadge = document.getElementById('phpVersion');
const dockerBadge = document.getElementById('dockerBadge');
const statusBar = document.querySelector('.status-bar');
const resizer = document.getElementById('resizer');

// Theme toggle
const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// Apply saved theme on load
applyTheme(currentTheme);

// Window drag functionality for title bar
document.querySelectorAll('[data-tauri-drag-region]').forEach(el => {
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, select, a')) return;
    getCurrentWindow().startDragging();
  });
});

// Event Listeners
selectProjectBtn.addEventListener('click', selectProject);
runButton.addEventListener('click', runCode);
clearOutputBtn.addEventListener('click', clearOutput);
useDockerCheckbox.addEventListener('change', onDockerToggle);

function onDockerToggle() {
  if (useDockerCheckbox.checked) {
    containerSelect.style.display = 'block';
  } else {
    containerSelect.style.display = 'none';
  }
}

function populateContainers(containers) {
  containerSelect.innerHTML = '';

  if (containers.length === 0) {
    const option = document.createElement('option');
    option.value = 'laravel.test';
    option.textContent = 'laravel.test';
    containerSelect.appendChild(option);
    return;
  }

  containers.forEach((container) => {
    const option = document.createElement('option');
    option.value = container;
    option.textContent = container;
    if (container === 'laravel.test') {
      option.selected = true;
    }
    containerSelect.appendChild(option);
  });
}

// Resizer functionality
let isResizing = false;
resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const container = document.querySelector('.main');
  const containerRect = container.getBoundingClientRect();
  const editorPanel = document.querySelector('.editor-panel');
  const outputPanel = document.querySelector('.output-panel');

  const newEditorWidth = e.clientX - containerRect.left;
  const containerWidth = containerRect.width;

  if (newEditorWidth >= 300 && containerWidth - newEditorWidth >= 300) {
    editorPanel.style.flex = 'none';
    editorPanel.style.width = `${newEditorWidth}px`;
    outputPanel.style.flex = '1';
  }
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  resizer.classList.remove('resizing');
  document.body.style.cursor = '';
});

// Select Project
async function selectProject() {
  const path = await invoke('select_directory');
  if (!path) return;

  currentProject = path;
  setStatus('Detecting project...');

  try {
    projectInfo = await invoke('detect_project', { projectPath: path });

    const projectName = path.split('/').pop();
    projectNameSpan.textContent = projectName;
    projectPathSpan.textContent = path;

    projectInfoDiv.classList.remove('hidden');

    if (projectInfo.isLaravel) {
      laravelBadge.classList.remove('hidden');
      laravelBadge.textContent = projectInfo.laravelVersion
        ? `Laravel ${projectInfo.laravelVersion.replace('^', '')}`
        : 'Laravel';
    } else {
      laravelBadge.classList.add('hidden');
    }

    if (projectInfo.phpVersion) {
      phpVersionBadge.classList.remove('hidden');
      phpVersionBadge.textContent = `PHP ${projectInfo.phpVersion}`;
    } else {
      phpVersionBadge.classList.add('hidden');
    }

    if (projectInfo.hasSail || projectInfo.hasDocker) {
      dockerControls.style.display = 'flex';
      populateContainers(projectInfo.runningContainers || []);

      if (projectInfo.dockerDaemonRunning) {
        dockerBadge.classList.remove('hidden');
        dockerBadge.textContent = projectInfo.sailRunning ? 'Sail Running' : 'Docker';

        if (projectInfo.sailRunning) {
          useDockerCheckbox.checked = true;
          onDockerToggle();
        }
      } else {
        dockerBadge.classList.remove('hidden');
        dockerBadge.textContent = 'Docker Not Running';
        useDockerCheckbox.checked = false;
        containerSelect.style.display = 'none';
      }
    } else {
      dockerControls.style.display = 'none';
      dockerBadge.classList.add('hidden');
    }

    runButton.disabled = false;

    if (projectInfo.isLaravel && editor) {
      editor.setValue(`$users = User::all();
dump($users->count() . ' users found');
`);
    }

    setStatus('Ready', 'default');

  } catch (error) {
    setStatus('Error detecting project', 'error');
    console.error(error);
  }
}

// Run Code
async function runCode() {
  if (!currentProject || !editor) return;

  const code = editor.getValue();
  if (!code.trim()) {
    setOutput('No code to execute.', 'error');
    return;
  }

  const useDocker = useDockerCheckbox.checked;
  const container = useDocker ? containerSelect.value : null;

  setStatus('Running...', 'default');
  runButton.disabled = true;
  outputDiv.innerHTML = '<div class="loading">Executing...</div>';
  executionTimeSpan.classList.add('hidden');

  try {
    let result;

    if (projectInfo && projectInfo.isLaravel) {
      const models = projectInfo.models || [];
      result = await invoke('execute_code', {
        projectPath: currentProject,
        code: code,
        useDocker: useDocker,
        container: container,
        models: models
      });
    } else {
      result = await invoke('execute_php', {
        projectPath: currentProject,
        code: code,
        useDocker: useDocker,
        container: container
      });
    }

    executionTimeSpan.textContent = `${result.executionTime}ms`;
    executionTimeSpan.classList.remove('hidden');

    if (result.success) {
      setOutput(result.output || '(no output)', 'success');
      setStatus('Done', 'success');
    } else {
      const errorOutput = result.error || result.output || 'Unknown error';
      setOutput(errorOutput, 'error');
      setStatus('Error', 'error');
    }

  } catch (error) {
    setOutput(`Execution failed: ${error.message || error}`, 'error');
    setStatus('Error', 'error');
  } finally {
    runButton.disabled = false;
  }
}

function clearOutput() {
  outputDiv.innerHTML = `<div class="output-placeholder">
    <p>Output cleared</p>
    <p class="hint">Use <kbd>⌘</kbd> + <kbd>Enter</kbd> to run</p>
  </div>`;
  executionTimeSpan.classList.add('hidden');
}

function setOutput(content, type = 'success') {
  outputDiv.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = type === 'error' ? 'output-error' : 'output-success';
  pre.textContent = content;
  outputDiv.appendChild(pre);
}

function setStatus(message, type = 'default') {
  statusSpan.textContent = message;
  statusBar.className = 'status-bar';
  if (type === 'error') {
    statusBar.classList.add('error');
  } else if (type === 'success') {
    statusBar.classList.add('success');
  }

  if (type !== 'default') {
    setTimeout(() => {
      statusBar.className = 'status-bar';
    }, 3000);
  }
}

window.addEventListener('resize', () => {
  if (editor) {
    editor.layout();
  }
});
