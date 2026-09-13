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

      if (m.id === 'cost') {
        row.title = 'API-equivalent value based on published rates';
      }

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

    // Panels can grow up to 420px (Req 5)
    if (bridge && bridge.setWindowHeight) {
      bridge.setWindowHeight(moduleId === 'cost' ? 420 : 380);
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

    if (currentModuleId === 'repos' && data.repos) {
      renderReposPanel(data);
      return;
    }

    if (currentModuleId === 'cost' && data.topProjects) {
      renderCostPanel(data);
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

  function renderReposPanel(data) {
    panelHead.textContent = data.statusText || 'Repositories';
    panelBody.textContent = '';

    if (!data.repos || data.repos.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'repo-remaining';
      empty.textContent = 'No repositories found.';
      panelBody.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'repo-list';

    data.repos.forEach(function (r) {
      const item = document.createElement('div');
      item.className = 'repo-item';
      item.title = r.path + ' (click to open in Explorer)';

      const top = document.createElement('div');
      top.className = 'repo-row-top';

      const name = document.createElement('span');
      name.className = 'repo-name';
      name.textContent = r.name;

      const branch = document.createElement('span');
      branch.className = 'branch-pill';
      branch.textContent = r.branch || 'unknown';

      const folderIcon = document.createElement('span');
      folderIcon.className = 'folder-icon';
      folderIcon.textContent = '\uD83D\uDCC1'; // 📁

      top.appendChild(name);
      top.appendChild(branch);
      top.appendChild(folderIcon);

      const bottom = document.createElement('div');
      bottom.className = 'repo-row-bottom';

      if (r.unpushed != null && r.unpushed > 0) {
        const chip = document.createElement('span');
        chip.className = 'chip unpushed';
        chip.textContent = '\u2191 ' + r.unpushed + ' unpushed';
        bottom.appendChild(chip);
      } else if (r.unpushed === null) {
        const chip = document.createElement('span');
        chip.className = 'chip no-upstream';
        chip.textContent = 'no upstream';
        bottom.appendChild(chip);
      }

      if (r.changed > 0) {
        const chip = document.createElement('span');
        chip.className = 'chip dirty';
        chip.textContent = '\u00B1 ' + r.changed + ' dirty';
        bottom.appendChild(chip);
      }

      if (r.behind != null && r.behind > 0) {
        const chip = document.createElement('span');
        chip.className = 'chip behind';
        chip.textContent = '\u2193 ' + r.behind + ' behind';
        bottom.appendChild(chip);
      }

      if (!r.needsAttention) {
        const chip = document.createElement('span');
        chip.className = 'chip clean';
        chip.textContent = 'clean';
        bottom.appendChild(chip);
      }

      item.appendChild(top);
      item.appendChild(bottom);

      item.addEventListener('click', function () {
        if (bridge && bridge.invokeAction) {
          bridge.invokeAction('repos', 'openFolder', { path: r.path });
        }
      });

      list.appendChild(item);
    });

    panelBody.appendChild(list);

    if (data.remainingCount > 0) {
      const rem = document.createElement('div');
      rem.className = 'repo-remaining';
      rem.textContent = '+ ' + data.remainingCount + ' more repositories';
      panelBody.appendChild(rem);
    }
  }

  function renderCostPanel(data) {
    panelHead.textContent = data.statusText || 'Cost / Project';
    panelBody.textContent = '';

    if (!data.topProjects || data.topProjects.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'repo-remaining';
      empty.textContent = 'No project activity recorded in the last 7 days.';
      panelBody.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'cost-list';

    // Maximum cost for relative bar scaling across top projects
    const maxCost = data.topProjects[0] ? data.topProjects[0].weekCost : data.totalWeekCost;

    data.topProjects.forEach(function (p) {
      const item = document.createElement('div');
      item.className = 'cost-item';
      item.title = p.path + ' (click to open in Explorer)';

      const top = document.createElement('div');
      top.className = 'cost-row-top';

      const name = document.createElement('span');
      name.className = 'cost-name';
      name.textContent = p.name;

      const pathEl = document.createElement('span');
      pathEl.className = 'cost-path';
      pathEl.textContent = p.path;

      const amount = document.createElement('span');
      amount.className = 'cost-amount';
      amount.textContent = p.weekCostFormatted;

      const pct = document.createElement('span');
      pct.className = 'cost-pct';
      pct.textContent = p.percentFormatted;

      top.appendChild(name);
      top.appendChild(pathEl);
      top.appendChild(amount);
      top.appendChild(pct);

      const bar = document.createElement('div');
      bar.className = 'cost-bar';

      const fill = document.createElement('div');
      fill.className = 'cost-bar-fill';
      // CSSOM set width per Trap T5
      const barPct = maxCost > 0 ? (p.weekCost / maxCost) * 100 : 0;
      fill.style.width = Math.max(barPct, 1).toFixed(1) + '%';
      bar.appendChild(fill);

      item.appendChild(top);
      item.appendChild(bar);

      item.addEventListener('click', function () {
        if (bridge && bridge.invokeAction) {
          bridge.invokeAction('cost', 'openFolder', { path: p.path });
        }
      });

      list.appendChild(item);
    });

    // Other row if more than 10 projects
    if (data.other) {
      const otherItem = document.createElement('div');
      otherItem.className = 'cost-item no-pointer';

      const top = document.createElement('div');
      top.className = 'cost-row-top';

      const name = document.createElement('span');
      name.className = 'cost-name';
      name.textContent = data.other.name;

      const emptyPath = document.createElement('span');
      emptyPath.className = 'cost-path';

      const amount = document.createElement('span');
      amount.className = 'cost-amount';
      amount.textContent = data.other.weekCostFormatted;

      const pct = document.createElement('span');
      pct.className = 'cost-pct';
      pct.textContent = data.other.percentFormatted;

      top.appendChild(name);
      top.appendChild(emptyPath);
      top.appendChild(amount);
      top.appendChild(pct);

      const bar = document.createElement('div');
      bar.className = 'cost-bar';

      const fill = document.createElement('div');
      fill.className = 'cost-bar-fill other';
      const otherBarPct = maxCost > 0 ? (data.other.weekCost / maxCost) * 100 : 0;
      fill.style.width = Math.max(otherBarPct, 1).toFixed(1) + '%';
      bar.appendChild(fill);

      otherItem.appendChild(top);
      otherItem.appendChild(bar);

      list.appendChild(otherItem);
    }

    panelBody.appendChild(list);

    // Total card at bottom: 7-day Grand Total ($) | Daily average ($) | Active projects count (N)
    const card = document.createElement('div');
    card.className = 'cost-total-card';

    // Col 1: 7-day Grand Total
    const col1 = document.createElement('div');
    col1.className = 'cost-total-col';
    const lbl1 = document.createElement('span');
    lbl1.className = 'cost-total-label';
    lbl1.textContent = '7-Day Total (API-equiv)';
    const val1 = document.createElement('span');
    val1.className = 'cost-total-val';
    val1.textContent = data.totalWeekCostFormatted || '$0.00';
    col1.appendChild(lbl1);
    col1.appendChild(val1);

    // Col 2: Daily average
    const col2 = document.createElement('div');
    col2.className = 'cost-total-col';
    const lbl2 = document.createElement('span');
    lbl2.className = 'cost-total-label';
    lbl2.textContent = 'Daily Avg (API-equiv)';
    const val2 = document.createElement('span');
    val2.className = 'cost-total-val';
    val2.textContent = data.dailyAverageFormatted || '$0.00';
    col2.appendChild(lbl2);
    col2.appendChild(val2);

    // Col 3: Active projects
    const col3 = document.createElement('div');
    col3.className = 'cost-total-col';
    const lbl3 = document.createElement('span');
    lbl3.className = 'cost-total-label';
    lbl3.textContent = 'Active Projects';
    const val3 = document.createElement('span');
    val3.className = 'cost-total-val';
    val3.textContent = String(data.totalProjectsCount || 0);
    col3.appendChild(lbl3);
    col3.appendChild(val3);

    card.appendChild(col1);
    card.appendChild(col2);
    card.appendChild(col3);

    panelBody.appendChild(card);

    // Disclaimer note at the bottom
    const disclaimer = document.createElement('div');
    disclaimer.className = 'cost-disclaimer';
    disclaimer.textContent = data.disclaimer || 'API-equivalent value based on published rates; not actual Anthropic billing.';
    panelBody.appendChild(disclaimer);
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
