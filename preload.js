'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getState: () => ipcRenderer.invoke('get-state'),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, payload) => cb(payload)),
  onTheme: (cb) => ipcRenderer.on('theme', (_e, theme) => cb(theme)),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, update) => cb(update)),
  installUpdate: () => ipcRenderer.send('install-update'),
  refresh: () => ipcRenderer.send('refresh'),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  projects: (sinceMs, bucket) => ipcRenderer.invoke('projects', sinceMs, bucket),
  history: (sinceMs) => ipcRenderer.invoke('history', sinceMs),
  expand: (height) => ipcRenderer.send('expand', height),
  collapse: () => ipcRenderer.send('collapse'),
  resize: (height) => ipcRenderer.send('resize', height),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  contextMenu: () => ipcRenderer.send('context-menu'),
});
