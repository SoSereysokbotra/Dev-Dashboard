'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardBridge', {
  getSummaries: function () {
    return ipcRenderer.invoke('dashboard:get-summaries');
  },
  onSummaryUpdate: function (cb) {
    ipcRenderer.on('dashboard:update', function (_e, payload) { cb(payload); });
  },
  onOpenModule: function (cb) {
    ipcRenderer.on('navigation:open-module', function (_e, id) { cb(id); });
  },
  getPanel: function (id) {
    return ipcRenderer.invoke('dashboard:get-panel', id);
  },
  invokeAction: function (id, action, args) {
    return ipcRenderer.invoke('dashboard:invoke-action', { id, action, args });
  },
  setWindowHeight: function (height) {
    return ipcRenderer.invoke('window:set-height', height);
  },
  hide: function () {
    ipcRenderer.send('widget:hide');
  },
  openMenu: function () {
    ipcRenderer.send('widget:menu');
  },
  getTheme: function () {
    return ipcRenderer.invoke('theme:get');
  },
  setTheme: function (theme) {
    return ipcRenderer.invoke('theme:set', theme);
  },
  toggleTheme: function () {
    return ipcRenderer.invoke('theme:toggle');
  },
  onThemeChange: function (cb) {
    ipcRenderer.on('theme:changed', function (_e, theme) { cb(theme); });
  },
});
