'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getState: () => ipcRenderer.invoke('get-state'),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, payload) => cb(payload)),
  refresh: () => ipcRenderer.send('refresh'),
  projects: (days) => ipcRenderer.invoke('projects', days),
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
