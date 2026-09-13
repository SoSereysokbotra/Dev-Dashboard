'use strict';

(function () {
  const bridge = window.dashboardBridge;

  let currentView = 'home'; // 'home' | 'panel'
  let currentModuleId = null;
  let cachedModules = [];

  // DOM elements
  const titleText = document.getElementById('titleText');
  const statusDot = document.getElementById('statusDot');
  const backBtn = document.getElementById('backBtn');
  const themeBtn = document.getElementById('themeBtn');
  const menuBtn = document.getElementById('menuBtn');
  const hideBtn = document.getElementById('hideBtn');
  const homeView = document.getElementById('homeView');
  const panelView = document.getElementById('panelView');
  const panelHead = document.getElementById('panelHead');
  const panelBody = document.getElementById('panelBody');
  const moduleList = document.getElementById('moduleList');
  const keyHint = document.getElementById('keyHint');

  // --- theme ---

  function applyTheme(themePayload) {
    if (!themePayload) return;
    const resolved = themePayload.resolved || 'dark';
    document.documentElement.dataset.theme = resolved;
  }

  if (bridge && bridge.getTheme) {
    bridge.getTheme().then(applyTheme);
    bridge.onThemeChange(applyTheme);
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      if (bridge && bridge.toggleTheme) {
        bridge.toggleTheme().then(applyTheme);
      }
    });
  }

  // --- window actions ---

  if (hideBtn) {
    hideBtn.addEventListener('click', function () {
      if (bridge && bridge.hide) bridge.hide();
    });
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      if (bridge && bridge.openMenu) bridge.openMenu();
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', function () {
      showHome();
    });
  }

  // --- rendering home screen ---

  function renderHome(summaries) {
    cachedModules = summaries || [];
    moduleList.textContent = ''; // safe clear

    let overallSeverity = 'ok';
    const severities = ['critical', 'high', 'warn', 'unknown', 'ok'];

    cachedModules.forEach(function (m) {
      const row = document.createElement('div');
      row.className = 'module-row';
      row.dataset.id = m.id;
      row.dataset.order = m.order;

      const badge = document.createElement('span');
      badge.className = 'order-badge';
      badge.textContent = m.order;

      const title = document.createElement('span');
      title.className = 'module-title';
      title.textContent = m.title;

      const summary = document.createElement('span');
      summary.className = 'module-summary ' + (m.severity || 'unknown');
      summary.textContent = m.text || 'unavailable';

      row.appendChild(badge);
      row.appendChild(title);
      row.appendChild(summary);

      row.addEventListener('click', function () {
        openModule(m.id);
      });

      moduleList.appendChild(row);

      // Track highest severity for the status dot
      const sev = m.severity || 'unknown';
      if (severities.indexOf(sev) < severities.indexOf(overallSeverity)) {
        overallSeverity = sev;
      }
    });

    statusDot.className = 'dot ' + overallSeverity;
  }

  // --- navigation: home / panel ---

  function showHome() {
    currentView = 'home';
    currentModuleId = null;

    homeView.classList.remove('hidden');
    panelView.classList.add('hidden');
    backBtn.classList.add('hidden');

    titleText.textContent = 'Dev Dashboard';
    keyHint.textContent = 'press 1\u20134 to open \u00b7 Esc to hide';

    if (bridge && bridge.setWindowHeight) {
      bridge.setWindowHeight(230);
    }
  }

  async function openModule(moduleId) {
    currentView = 'panel';
    currentModuleId = moduleId;

    homeView.classList.add('hidden');
    panelView.classList.remove('hidden');
    backBtn.classList.remove('hidden');

    const mod = cachedModules.find(function (m) { return m.id === moduleId; });
    const name = mod ? mod.title : moduleId;
    titleText.textContent = name;
    keyHint.textContent = 'Esc to go back';

    panelHead.textContent = name;
    panelBody.textContent = 'Loading...';

    if (bridge && bridge.setWindowHeight) {
      bridge.setWindowHeight(320);
    }

    if (bridge && bridge.getPanel) {
      try {
        const data = await bridge.getPanel(moduleId);
        renderPanel(data);
      } catch (err) {
        panelBody.textContent = 'Error loading panel: ' + err.message;
      }
    }
  }

  function renderPanel(data) {
    panelBody.textContent = '';
    if (!data) {
      panelBody.textContent = 'No panel data available.';
      return;
    }

    if (data.error) {
      const errEl = document.createElement('div');
      errEl.className = 'module-summary critical';
      errEl.textContent = 'Error: ' + data.error;
      panelBody.appendChild(errEl);
      return;
    }

    const statusEl = document.createElement('div');
    statusEl.textContent = data.statusText || 'Module active.';
    panelBody.appendChild(statusEl);

    if (Array.isArray(data.items) && data.items.length > 0) {
      const list = document.createElement('ul');
      data.items.forEach(function (item) {
        const li = document.createElement('li');
        li.textContent = typeof item === 'string' ? item : JSON.stringify(item);
        list.appendChild(li);
      });
      panelBody.appendChild(list);
    }
  }

  // --- keyboard handling ---

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (currentView === 'panel') {
        showHome();
      } else {
        if (bridge && bridge.hide) bridge.hide();
      }
      return;
    }

    // Number keys 1-9
    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1 && num <= 9) {
      const target = cachedModules.find(function (m) { return m.order === num; });
      if (target) {
        openModule(target.id);
      }
    }
  });

  // --- initialization ---

  if (bridge) {
    bridge.getSummaries().then(function (summaries) {
      renderHome(summaries);
    });

    bridge.onSummaryUpdate(function (summaries) {
      renderHome(summaries);
    });

    if (bridge.onOpenModule) {
      bridge.onOpenModule(function (moduleId) {
        openModule(moduleId);
      });
    }
  }

  showHome();
})();
