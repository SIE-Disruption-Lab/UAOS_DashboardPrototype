'use strict';

const API = '';   // same origin

const TABS = [
  // Mission Engineering
  { id: 'kill_chain',               label: 'Kill Chain Coverage',         description: 'Which performers can execute which kill chain steps?' },
  { id: 'met_architecture',         label: 'MET Architecture',            description: 'Mission Engineering Thread comparison — capability allocations per MET.' },
  { id: 'mop_tradeoff',             label: 'MOP Trade-Space',             description: 'Baseline vs alternative MOP comparison with constraints.' },
  { id: 'capability',               label: 'Capability Traceability',     description: 'Capability requirements → satisfied capabilities → bearing systems.' },
  { id: 'requirements',             label: 'Requirements & Tests',        description: 'Requirement allocation and test verification — gap detection.' },
  { id: 'test_milestones',          label: 'Test & Milestone Traceability', description: 'Test-to-milestone traceability with assessment findings and confidence scores.' },
  // System Architecture
  { id: 'interface_mismatch',       label: 'Interface Type Mismatches',   description: 'ConnectsTo links where ports are prescribed by incompatible interface types.' },
  { id: 'dead_functions',           label: 'Dead Functions',              description: 'Functions with no mode availability — can never execute in any system state.' },
  { id: 'unverified_requirements',  label: 'Unverified Requirements',     description: 'Requirements with no assigned verification activity — coverage gaps.' },
  { id: 'mode_function_matrix',     label: 'Mode–Function Matrix',        description: 'Which functions are available in which operational modes.' },
  { id: 'requirements_traceability',label: 'Requirements Traceability',   description: 'Full RTM: requirement allocation to systems and verification activities.' },
  { id: 'state_machine',            label: 'State Machine Completeness',  description: 'Modes with no entry transition — potential reachability errors.' },
  // Bayesian Network
  { id: 'bayesian_network',         label: 'Bayesian Network',            description: 'Interactive Bayesian network — click observable nodes to toggle Pass / Fail and propagate beliefs across the network.' },
  // MOE Calculations
  { id: 'moe_calculations',         label: 'MOE Calculations',            description: 'MOE values calculated as the product of input parameter measurements, with historical timeline.' },
  // Risk Matrices
  { id: 'risk_matrix',              label: 'Risk Matrices',               description: 'DoD 5×5 risk matrices — system performance risks (DT) and operational risks (OT). Likelihood from Bayesian network posteriors.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Don't set Content-Type for FormData — browser sets it with boundary
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    if (typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || JSON.stringify(err));
  }
  return res.status === 204 ? null : res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// App controller
// ─────────────────────────────────────────────────────────────────────────────
const App = {
  currentProjectId: null,
  statusPoller: null,

  async init() {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const user = await apiFetch('/auth/me');
        this._setUser(user);
        this.showScreen('projects');
        await Projects.load();
      } catch {
        localStorage.removeItem('token');
        this.showScreen('auth');
      }
    } else {
      this.showScreen('auth');
    }
  },

  _setUser(user) {
    document.getElementById('nav-username').textContent = user.username;
    document.getElementById('navbar').style.display = '';
  },

  showScreen(name) {
    ['auth','projects','dashboard'].forEach(s => {
      document.getElementById(`screen-${s}`).style.display = 'none';
    });
    document.getElementById(`screen-${name}`).style.display = '';
    if (name === 'projects') Projects.load();
  },

  logout() {
    localStorage.removeItem('token');
    clearInterval(this.statusPoller);
    document.getElementById('navbar').style.display = 'none';
    this.showScreen('auth');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────
const Auth = {
  showTab(tab) {
    document.getElementById('form-login').classList.toggle('d-none', tab !== 'login');
    document.getElementById('form-register').classList.toggle('d-none', tab !== 'register');
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    document.getElementById('auth-error').classList.add('d-none');
  },

  _err(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('d-none');
  },

  async login(e) {
    e.preventDefault();
    try {
      const fd = new FormData();
      fd.append('username', document.getElementById('login-username').value);
      fd.append('password', document.getElementById('login-password').value);
      const data = await apiFetch('/auth/login', { method: 'POST', body: fd });
      localStorage.setItem('token', data.access_token);
      const user = await apiFetch('/auth/me');
      App._setUser(user);
      App.showScreen('projects');
      await Projects.load();
    } catch (err) {
      this._err(err.message);
    }
  },

  async register(e) {
    e.preventDefault();
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: {
          username: document.getElementById('reg-username').value,
          email:    document.getElementById('reg-email').value,
          password: document.getElementById('reg-password').value,
        },
      });
      // Auto-login after register
      document.getElementById('login-username').value = document.getElementById('reg-username').value;
      document.getElementById('login-password').value = document.getElementById('reg-password').value;
      this.showTab('login');
      document.getElementById('form-login').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } catch (err) {
      this._err(err.message);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Projects list
// ─────────────────────────────────────────────────────────────────────────────
const Projects = {
  async load() {
    const projects = await apiFetch('/projects/');
    const container = document.getElementById('project-list');
    container.innerHTML = '';
    if (!projects.length) {
      container.innerHTML = '<div class="text-muted">No projects yet. Create one to get started.</div>';
      return;
    }
    projects.forEach(p => {
      const col = document.createElement('div');
      col.className = 'col-md-4 col-sm-6';
      col.innerHTML = `
        <div class="card project-card h-100" onclick="Dashboard.open(${p.id})">
          <div class="card-body">
            <h6 class="card-title">${p.name}</h6>
            <p class="card-text text-muted small">${p.description || '<em>No description</em>'}</p>
            <span class="badge badge-${p.status}">${p.status}</span>
          </div>
          <div class="card-footer text-muted small d-flex justify-content-between">
            <span>${p.namespace.split('/').pop() || ''}</span>
            <span>${p.active_tabs.length} active tab(s)</span>
          </div>
        </div>`;
      container.appendChild(col);
    });
  },

  showNewModal() {
    document.getElementById('modal-error').classList.add('d-none');
    document.getElementById('form-new-project').reset();
    new bootstrap.Modal(document.getElementById('modal-new-project')).show();
  },

  async create(e) {
    e.preventDefault();
    const errEl = document.getElementById('modal-error');
    errEl.classList.add('d-none');
    try {
      const fd = new FormData();
      fd.append('name', document.getElementById('new-proj-name').value);
      fd.append('description', document.getElementById('new-proj-desc').value);
      const files = document.getElementById('new-proj-files').files;
      for (const f of files) fd.append('files', f);

      await apiFetch('/projects/', { method: 'POST', body: fd });
      bootstrap.Modal.getInstance(document.getElementById('modal-new-project')).hide();
      await Projects.load();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────
const Dashboard = {
  project: null,
  tabs: [],
  charts: {},

  async open(projectId) {
    try {
      App.currentProjectId = projectId;
      this.project = await apiFetch(`/projects/${projectId}`);
      this.tabs = TABS;

      document.getElementById('dash-project-name').textContent = this.project.name;
      this._updateStatusBadge(this.project.status);
      this._renderTabs();

      App.showScreen('dashboard');

      if (this.project.status === 'ready') {
        await this._loadAllResults();
      } else if (this.project.status === 'building') {
        this._startPolling();
      }
    } catch (err) {
      alert('Error opening project: ' + err.message + '\n\n' + err.stack);
    }
  },

  _updateStatusBadge(status) {
    const badge = document.getElementById('dash-status-badge');
    badge.className = `badge badge-${status}`;
    badge.textContent = status.toUpperCase();
    document.getElementById('btn-build').disabled = status === 'building';
  },

  _showAllTabs: false,

  toggleAllTabs() {
    this._showAllTabs = !this._showAllTabs;
    const btn = document.getElementById('btn-show-all-tabs');
    btn.innerHTML = this._showAllTabs
      ? '<i class="bi bi-check-circle me-1"></i>Active only'
      : '<i class="bi bi-list-ul me-1"></i>Show all tabs';
    this._renderTabs();
    // Re-populate results for any newly visible tabs
    this._loadAllResults();
  },

  _renderTabs() {
    const active = new Set(this.project.active_tabs || []);
    const tabBar = document.getElementById('dashboard-tabs');
    const tabContent = document.getElementById('dashboard-tab-content');
    tabBar.innerHTML = '';
    tabContent.innerHTML = '';

    // Destroy all existing charts and BN graphs
    Object.values(this.charts).forEach(c => c.destroy());
    this.charts = {};
    Object.values(this._bnGraphs || {}).forEach(cy => cy.destroy());
    this._bnGraphs = {};

    // Show recommendation banner
    if (active.size > 0) {
      const names = this.tabs
        .filter(t => active.has(t.id))
        .map(t => t.label)
        .join(', ');
      document.getElementById('recommended-tab-names').textContent = names;
      document.getElementById('tab-recommendation').classList.remove('d-none');
    } else {
      document.getElementById('tab-recommendation').classList.add('d-none');
    }

    // Decide which tabs to render and in what order
    let visibleTabs;
    if (this._showAllTabs) {
      // All tabs A–Z, active ones first within same letter so checkmarks cluster naturally
      visibleTabs = [...this.tabs].sort((a, b) => a.label.localeCompare(b.label));
    } else {
      visibleTabs = this.tabs.filter(t => active.has(t.id));
    }

    visibleTabs.forEach((tab, i) => {
      const isActive = active.has(tab.id);
      const isFirst = i === 0;

      const li = document.createElement('li');
      li.className = `nav-item${isActive ? ' tab-recommended' : ''}`;
      li.innerHTML = `
        <button class="nav-link${isFirst ? ' show active' : ''}${!isActive ? ' tab-inactive' : ''}"
                data-bs-toggle="tab"
                data-bs-target="#tab-pane-${tab.id}"
                type="button">
          ${isActive
            ? '<i class="bi bi-check-circle-fill text-success me-1"></i>'
            : '<i class="bi bi-circle text-secondary me-1"></i>'}
          ${tab.label}
        </button>`;
      tabBar.appendChild(li);

      const pane = document.createElement('div');
      pane.className = `tab-pane fade${isFirst ? ' show active' : ''}`;
      pane.id = `tab-pane-${tab.id}`;
      pane.innerHTML = `
        <div class="mb-2 text-muted small">${tab.description}</div>
        <div id="tab-body-${tab.id}">
          ${isActive
            ? '<div class="tab-empty"><i class="bi bi-hourglass"></i> Loading…</div>'
            : '<div class="tab-empty text-secondary"><i class="bi bi-slash-circle me-1"></i>No results for this project.</div>'}
        </div>`;
      tabContent.appendChild(pane);
    });
  },

  async triggerBuild() {
    try {
      await apiFetch(`/projects/${App.currentProjectId}/build`, { method: 'POST' });
      this._updateStatusBadge('building');
      this._startPolling();
    } catch (err) {
      alert('Build error: ' + err.message);
    }
  },

  async requery() {
    const btn = document.getElementById('btn-requery');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Querying…';
    try {
      await apiFetch(`/projects/${App.currentProjectId}/requery`, { method: 'POST' });
      // Runs in background — poll for READY exactly like after a build
      this._startPolling();
      // Re-enable button once polling completes
      const restoreBtn = setInterval(() => {
        if (!App.statusPoller) {
          clearInterval(restoreBtn);
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Re-query';
        }
      }, 1000);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Re-query';
      alert('Re-query failed: ' + err.message + '\n\nFuseki must be running (do a full Build first).');
    }
  },

  showEditModal() {
    document.getElementById('edit-proj-name').value = this.project.name;
    document.getElementById('edit-proj-desc').value = this.project.description;
    document.getElementById('edit-error').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('modal-edit-project')).show();
  },

  async saveEdit(e) {
    e.preventDefault();
    const errEl = document.getElementById('edit-error');
    errEl.classList.add('d-none');
    try {
      const fd = new FormData();
      fd.append('name', document.getElementById('edit-proj-name').value);
      fd.append('description', document.getElementById('edit-proj-desc').value);
      const updated = await apiFetch(`/projects/${App.currentProjectId}`, { method: 'PATCH', body: fd });
      this.project = updated;
      document.getElementById('dash-project-name').textContent = updated.name;
      bootstrap.Modal.getInstance(document.getElementById('modal-edit-project')).hide();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    }
  },

  async deleteProject() {
    if (!confirm(`Delete project "${this.project.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/projects/${App.currentProjectId}`, { method: 'DELETE' });
      bootstrap.Modal.getInstance(document.getElementById('modal-edit-project')).hide();
      App.showScreen('projects');
      await Projects.load();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  },

  showUploadModal() {
    document.getElementById('reupload-error').classList.add('d-none');
    document.getElementById('form-reupload').reset();
    new bootstrap.Modal(document.getElementById('modal-reupload')).show();
  },

  async reupload(e) {
    e.preventDefault();
    const errEl = document.getElementById('reupload-error');
    errEl.classList.add('d-none');
    try {
      const fd = new FormData();
      for (const f of document.getElementById('reupload-files').files) fd.append('files', f);
      const updated = await apiFetch(`/projects/${App.currentProjectId}/upload`, { method: 'POST', body: fd });
      this.project = updated;
      this._updateStatusBadge(updated.status);
      this._renderTabs();
      bootstrap.Modal.getInstance(document.getElementById('modal-reupload')).hide();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    }
  },

  _startPolling() {
    clearInterval(App.statusPoller);
    App.statusPoller = setInterval(async () => {
      const data = await apiFetch(`/projects/${App.currentProjectId}/status`).catch(() => null);
      if (!data) return;
      this._updateStatusBadge(data.status);
      if (data.status === 'ready') {
        clearInterval(App.statusPoller);
        App.statusPoller = null;
        this.project.active_tabs = data.active_tabs;
        this._renderTabs();
        await this._loadAllResults();
      } else if (data.status === 'failed') {
        clearInterval(App.statusPoller);
        App.statusPoller = null;
      }
    }, 3000);
  },

  async _loadAllResults() {
    try {
      const allResults = await apiFetch(`/projects/${App.currentProjectId}/results`);
      this._allResults = allResults;
      this.tabs.forEach(tab => {
        const data = allResults[tab.id];
        if (data) this._renderTabContent(tab, data);
      });
    } catch (err) {
      console.error('Failed to load results:', err);
    }
  },

  _renderTabContent(tab, data) {
    const container = document.getElementById(`tab-body-${tab.id}`);
    if (!container) return;

    // Bayesian Network has its own renderer (handles empty state internally)
    if (tab.id === 'bayesian_network') {
      this._renderBayesianNetwork(container, data);
      return;
    }

    // MOE Calculations has its own renderer
    if (tab.id === 'moe_calculations') {
      this._renderMoeCalculations(container, data);
      return;
    }

    // Risk Matrices has its own renderer
    if (tab.id === 'risk_matrix') {
      this._renderRiskMatrix(container, data);
      return;
    }

    if (!data.bindings || data.bindings.length === 0) {
      container.innerHTML = '<div class="tab-empty"><i class="bi bi-inbox"></i> No results for this query.</div>';
      return;
    }

    // Destroy existing charts for this tab
    Object.keys(this.charts).forEach(key => {
      if (key === tab.id || key.startsWith(tab.id + '-')) {
        this.charts[key].destroy();
        delete this.charts[key];
      }
    });

    // Tabs where every result row represents a problem/issue
    const DIAGNOSTIC_TABS = new Set([
      'interface_mismatch', 'dead_functions', 'unverified_requirements', 'state_machine',
    ]);

    // Choose renderer based on tab
    if (tab.id === 'mop_tradeoff') {
      container.innerHTML = this._buildMopChart(data);
      this._initMopChart(tab.id, data);
    } else {
      container.innerHTML = this._buildTable(data, tab.id, DIAGNOSTIC_TABS.has(tab.id));
    }
  },

  _buildTable(data, tabId, warnAll = false) {
    const vars = data.vars;
    const bindings = data.bindings;

    let thead = vars.map(v => `<th>${_humanize(v)}</th>`).join('');
    let tbody = bindings.map(row => {
      const isGap = warnAll || _isGapRow(row, vars);
      const cells = vars.map(v => {
        const val = row[v] ? row[v].value : '—';
        return `<td>${_formatValue(val)}</td>`;
      }).join('');
      return `<tr class="${isGap ? 'gap-row' : ''}">${cells}</tr>`;
    }).join('');

    const note = warnAll
      ? `<div class="alert alert-warning py-1 small mb-2"><i class="bi bi-exclamation-triangle-fill me-1"></i>${bindings.length} issue(s) found in model.</div>`
      : `<div class="text-muted small mt-1">${bindings.length} row(s)</div>`;

    return `
      ${warnAll ? note : ''}
      <div class="table-responsive">
        <table class="table table-sm table-hover result-table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
      ${!warnAll ? note : ''}`;
  },

  // Derive system label from row — uses ?system if present, else infers from mopLabel
  _mopSystem(row) {
    if (row.system?.value) return row.system.value;
    const lbl = (row.mopLabel?.value || '').toLowerCase();
    return (lbl.includes('mq-99') || lbl.includes('berserker')) ? 'Berserker (MQ-99)' : 'Baseline (AH-64A)';
  },

  // Derive metric group from row — 'Probability' or 'Time'
  _mopMetric(row) {
    const lbl = (row.mopLabel?.value || '').toLowerCase();
    if (lbl.includes('probability') || lbl.includes('detection')) return 'Detection Probability';
    return 'Time to Neutralize';
  },

  _buildMopChart(data) {
    const chartsHtml = `
      <div class="col-md-6">
        <h6 class="text-center fw-semibold mb-2">Time to Neutralize</h6>
        <div style="position:relative;height:300px">
          <canvas id="chart-mop-0"></canvas>
        </div>
      </div>
      <div class="col-md-6">
        <h6 class="text-center fw-semibold mb-2">Detection Probability</h6>
        <div style="position:relative;height:300px">
          <canvas id="chart-mop-1"></canvas>
        </div>
      </div>`;

    const summaryRows = data.bindings.map(row => {
      const system = this._mopSystem(row);
      const label  = row.mopLabel?.value || '—';
      const val    = parseFloat(row.measuredValue?.value ?? 'NaN');
      const thresh = parseFloat(row.thresholdValue?.value ?? 'NaN');
      const op     = row.thresholdOperator?.value || '≤';
      const unit   = row.unitLabel?.value || '';
      const moe    = row.moeLabel?.value || '—';
      const pass   = (!isNaN(val) && !isNaN(thresh)) && (op === '<' ? val < thresh : val <= thresh);
      const badge  = pass
        ? '<span class="badge bg-success">PASS</span>'
        : '<span class="badge bg-danger">FAIL</span>';
      const sysColor = system.includes('Berserker') ? 'text-success fw-semibold' : 'text-primary fw-semibold';
      return `<tr>
        <td class="${sysColor}">${system}</td>
        <td>${label}</td>
        <td class="text-end">${isNaN(val) ? '—' : val}${unit ? ' ' + unit : ''}</td>
        <td class="text-center">${op} ${isNaN(thresh) ? '—' : thresh}${unit ? ' ' + unit : ''}</td>
        <td>${moe}</td>
        <td class="text-center">${badge}</td>
      </tr>`;
    }).join('');

    return `
      <div class="row g-3 mb-4">${chartsHtml}</div>
      <h6 class="fw-semibold mt-2 mb-2">MOP Summary</h6>
      <div class="table-responsive">
        <table class="table table-sm table-hover result-table">
          <thead><tr>
            <th>System</th><th>MOP</th><th class="text-end">Measured</th>
            <th class="text-center">Threshold</th><th>MOE</th><th class="text-center">Status</th>
          </tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>
      </div>`;
  },

  _initMopChart(tabId, data) {
    const METRICS = [
      { key: 'Time to Neutralize',    canvasId: 'chart-mop-0', yLabel: 'Minutes' },
      { key: 'Detection Probability', canvasId: 'chart-mop-1', yLabel: 'Probability' },
    ];
    const SYSTEMS = ['Baseline (AH-64A)', 'Berserker (MQ-99)'];
    const SYS_STYLES = {
      'Baseline (AH-64A)': { pass: '#0d6efd', fail: '#dc3545' },
      'Berserker (MQ-99)': { pass: '#198754', fail: '#fd7e14' },
    };

    METRICS.forEach(({ key, canvasId, yLabel }, mi) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      // Find the two rows for this metric (one per system)
      const rows = data.bindings.filter(r => this._mopMetric(r) === key);

      const datasets = SYSTEMS.map(sys => {
        const row = rows.find(r => this._mopSystem(r) === sys);
        if (!row) return null;
        const val    = parseFloat(row.measuredValue?.value ?? 'NaN');
        const thresh = parseFloat(row.thresholdValue?.value ?? 'NaN');
        const op     = row.thresholdOperator?.value || '≤';
        const pass   = (!isNaN(val) && !isNaN(thresh)) && (op === '<' ? val < thresh : val <= thresh);
        const colors = SYS_STYLES[sys] || { pass: '#0d6efd', fail: '#dc3545' };
        return {
          label: sys,
          data:  [val],
          backgroundColor: (pass ? colors.pass : colors.fail) + 'bb',
          borderColor:     pass ? colors.pass : colors.fail,
          borderWidth: 2,
          _row: row,
        };
      }).filter(Boolean);

      // Threshold (use first row's value — both systems share same threshold per metric)
      const threshRow = rows[0];
      const threshVal = threshRow ? parseFloat(threshRow.thresholdValue?.value ?? 'NaN') : NaN;
      const threshOp  = threshRow?.thresholdOperator?.value || '≤';

      const chart = new Chart(canvas, {
        type: 'bar',
        data: { labels: [''], datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const row = ctx.dataset._row;
                  const thresh = row ? parseFloat(row.thresholdValue?.value ?? 'NaN') : NaN;
                  const op     = row?.thresholdOperator?.value || '≤';
                  return `${ctx.dataset.label}: ${ctx.parsed.y}  (threshold ${op} ${isNaN(thresh) ? '?' : thresh})`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              title: { display: true, text: yLabel },
            },
          },
        },
        plugins: [{
          id: 'threshLine',
          afterDraw(ch) {
            if (isNaN(threshVal)) return;
            const { ctx, scales: { y }, chartArea: { left, right } } = ch;
            const yPx = y.getPixelForValue(threshVal);
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#6c757d';
            ctx.lineWidth = 2;
            ctx.moveTo(left, yPx);
            ctx.lineTo(right, yPx);
            ctx.stroke();
            ctx.fillStyle = '#495057';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(`Threshold ${threshOp} ${threshVal}`, left + 6, yPx - 5);
            ctx.restore();
          },
        }],
      });

      this.charts[`${tabId}-${mi}`] = chart;
    });
  },

  // ── Bayesian Network tab ───────────────────────────────────────────────────

  _renderBayesianNetwork(container, data) {
    // Parse nodes and edges from SPARQL UNION result
    const nodes = [], edges = [];
    for (const row of (data.bindings || [])) {
      const type = row.rowType?.value;
      if (type === 'node') {
        const id      = row.id?.value || '';
        const localId = id.split('#').pop() || id.split('/').pop();
        const name    = row.name?.value || localId;
        const visible = row.visible?.value === 'true';
        const trueVal = parseFloat(row.trueVal?.value  ?? '0.5');
        const falseVal= parseFloat(row.falseVal?.value ?? '0.5');
        const testDate = row.testDate?.value || null;
        nodes.push({ id, localId, name, visible, prior: trueVal, trueVal, falseVal, testDate });
      } else if (type === 'edge') {
        edges.push({
          parent: row.parent?.value || '',
          child:  row.child?.value  || '',
          weight: parseFloat(row.weight?.value ?? '1.0'),
        });
      }
    }

    if (nodes.length === 0) {
      container.innerHTML = '<div class="tab-empty"><i class="bi bi-inbox"></i> No Bayesian network found in this dataset.</div>';
      return;
    }

    // Initial user states from dataset values
    const initStates = {};
    for (const n of nodes) {
      if (!n.visible) continue;
      initStates[n.id] = n.trueVal >= 1.0 ? 'pass' : n.trueVal <= 0.0 ? 'fail' : 'unknown';
    }

    const beliefs = this._computeBNBeliefs(nodes, edges, initStates);

    // Build Cytoscape elements
    const cyNodes = nodes.map(n => ({
      data: {
        id:          n.id,
        label:       this._bnLabel(n, beliefs[n.id] ?? n.prior),
        bgColor:     this._bnColor(n, beliefs[n.id] ?? n.prior, initStates[n.id]),
        visible:     n.visible,
      },
    }));
    const cyEdges = edges.map((e, i) => ({
      data: { id: `e${i}`, source: e.parent, target: e.child, weight: `w=${e.weight.toFixed(2)}` },
    }));

    const uid = 'bn-' + Math.random().toString(36).slice(2);
    container.innerHTML = `
      <div id="${uid}" style="width:100%;height:460px;border:1px solid #dee2e6;border-radius:4px;background:#fafafa;"></div>
      <div class="mt-2 d-flex gap-3 flex-wrap align-items-center small">
        <span class="text-muted">Belief:</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:#86efac;border:1px solid #333;border-radius:2px;vertical-align:middle"></span> &gt;70%</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:#fde68a;border:1px solid #333;border-radius:2px;vertical-align:middle"></span> 40–70%</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:#fca5a5;border:1px solid #333;border-radius:2px;vertical-align:middle"></span> &lt;40%</span>
        <span class="ms-2 text-muted">Border: solid = observable · dashed = latent</span>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onclick="Dashboard._bnReset('${uid}')">
          <i class="bi bi-arrow-counterclockwise"></i> Reset
        </button>
      </div>
      <div class="mt-1 small text-muted"><i class="bi bi-hand-index me-1"></i>Click observable nodes (solid border) to cycle: <strong>Unknown → Pass → Fail</strong></div>`;

    setTimeout(() => {
      const el = document.getElementById(uid);
      if (!el) return;

      const cy = cytoscape({
        container: el,
        elements: [...cyNodes, ...cyEdges],
        style: [
          {
            selector: 'node',
            style: {
              shape:               'round-rectangle',
              label:               'data(label)',
              'text-wrap':         'wrap',
              'text-max-width':    130,
              'font-size':         12,
              width:               145,
              height:              56,
              'text-valign':       'center',
              'text-halign':       'center',
              'background-color':  'data(bgColor)',
              'border-width':      2,
              'border-color':      '#444',
              'border-style':      'solid',
              color:               '#111',
            },
          },
          {
            selector: 'node[!visible]',
            style: { 'border-style': 'dashed', opacity: 0.85 },
          },
          {
            selector: 'node[?visible]',
            style: { cursor: 'pointer' },
          },
          {
            selector: 'edge',
            style: {
              width:                    2,
              'line-color':             '#888',
              'target-arrow-color':     '#888',
              'target-arrow-shape':     'triangle',
              'curve-style':            'bezier',
              label:                    'data(weight)',
              'font-size':              10,
              color:                    '#555',
              'text-background-color':  '#fff',
              'text-background-opacity':0.8,
              'text-background-padding':'2px',
            },
          },
        ],
        layout: { name: 'dagre', rankDir: 'TB', nodeSep: 70, rankSep: 90, padding: 40 },
      });

      cy._bnNodes        = nodes;
      cy._bnEdges        = edges;
      cy._userStates     = { ...initStates };
      cy._initialStates  = { ...initStates };

      cy.on('tap', 'node', evt => {
        const n = nodes.find(n => n.id === evt.target.id());
        if (!n?.visible) return;
        const cur = cy._userStates[n.id] || 'unknown';
        cy._userStates[n.id] = cur === 'unknown' ? 'pass' : cur === 'pass' ? 'fail' : 'unknown';
        this._bnRefresh(cy);
      });

      this._bnGraphs = this._bnGraphs || {};
      this._bnGraphs[uid] = cy;
    }, 60);
  },

  _bnRefresh(cy) {
    const beliefs = this._computeBNBeliefs(cy._bnNodes, cy._bnEdges, cy._userStates);
    cy.nodes().forEach(cyNode => {
      const n = cy._bnNodes.find(n => n.id === cyNode.id());
      if (!n) return;
      const b = beliefs[n.id] ?? n.prior;
      cyNode.data('label',   this._bnLabel(n, b));
      cyNode.data('bgColor', this._bnColor(n, b, cy._userStates[n.id]));
    });
  },

  _bnReset(uid) {
    const cy = (this._bnGraphs || {})[uid];
    if (!cy) return;
    cy._userStates = { ...cy._initialStates };
    this._bnRefresh(cy);
  },

  _bnLabel(node, belief) {
    const pct   = (belief * 100).toFixed(1) + '%';
    const short = node.name.length > 22 ? node.name.slice(0, 20) + '…' : node.name;
    return `${short}\n${pct}`;
  },

  _bnColor(node, belief, userState) {
    if (userState === 'pass') return '#4ade80';   // bright green — confirmed pass
    if (userState === 'fail') return '#f87171';   // bright red   — confirmed fail
    if (belief > 0.70)        return '#86efac';   // green-300
    if (belief >= 0.40)       return '#fde68a';   // amber-200
    return '#fca5a5';                              // red-300
  },

  // Exact inference by full enumeration over non-evidence nodes.
  // CPT formula (from paper): P(child=T | parents) = Σ(wᵢ × P(parentᵢ=T))
  _computeBNBeliefs(nodes, edges, userStates) {
    // Build parent map: childId → [{parentId, weight}]
    const parentMap = {};
    for (const e of edges) {
      if (!parentMap[e.child]) parentMap[e.child] = [];
      parentMap[e.child].push({ id: e.parent, weight: e.weight });
    }

    // Evidence: observable nodes with known Pass/Fail state
    const evidence = {};
    for (const [id, state] of Object.entries(userStates || {})) {
      if (state === 'pass') evidence[id] = 1;
      else if (state === 'fail') evidence[id] = 0;
      // 'unknown' → not in evidence; participates in inference
    }

    // Nodes to enumerate (everything not clamped by evidence)
    const inferNodes = nodes.filter(n => !(n.id in evidence));
    const nInfer     = inferNodes.length;

    const beliefTrue = {};
    for (const n of nodes) beliefTrue[n.id] = 0;
    let totalW = 0;

    for (let mask = 0; mask < (1 << nInfer); mask++) {
      // Assign states: evidence nodes fixed, infer nodes from bitmask
      const state = { ...evidence };
      for (let i = 0; i < nInfer; i++) state[inferNodes[i].id] = (mask >> i) & 1;

      // Joint probability = product of each node's conditional probability
      let joint = 1.0;
      for (const node of nodes) {
        const s       = state[node.id] ?? 0;
        const parents = parentMap[node.id] || [];
        let pTrue = parents.length === 0
          ? node.prior
          : parents.reduce((sum, p) => sum + p.weight * (state[p.id] ?? 0), 0);
        pTrue = Math.max(0.001, Math.min(0.999, pTrue));
        joint *= s ? pTrue : (1 - pTrue);
      }

      totalW += joint;
      for (const node of nodes) {
        if (state[node.id]) beliefTrue[node.id] += joint;
      }
    }

    const beliefs = {};
    for (const node of nodes) {
      beliefs[node.id] = (node.id in evidence)
        ? evidence[node.id]
        : (totalW > 0 ? (beliefTrue[node.id] || 0) / totalW : node.prior);
    }
    return beliefs;
  },

  // ── End Bayesian Network ───────────────────────────────────────────────────

  // ── MOE Calculations tab ──────────────────────────────────────────────────

  _renderMoeCalculations(container, data) {
    if (!data.bindings || data.bindings.length === 0) {
      container.innerHTML = '<div class="tab-empty"><i class="bi bi-inbox"></i> No MOE calculation data found in this dataset.</div>';
      return;
    }

    // Destroy any existing charts for this tab
    Object.keys(this.charts).forEach(key => {
      if (key.startsWith('moe-calc-')) { this.charts[key].destroy(); delete this.charts[key]; }
    });

    // Group rows by MOE IRI → { name, params: { paramName → [{value, datetime, bnDerived?}] } }
    // Also track paramIri → paramName per MOE for BN matching
    const moeMap = {};
    const paramIriMap = {}; // moeIri → { paramIri → paramName }
    for (const row of data.bindings) {
      const moeIri    = row.moeIri?.value   || '';
      const moeName   = row.moeName?.value  || moeIri.split('#').pop() || moeIri.split('/').pop();
      const paramIri  = row.paramIri?.value || '';
      const paramName = row.paramName?.value || paramIri.split('#').pop() || '?';
      const paramVal  = parseFloat(row.paramValue?.value  ?? 'NaN');
      const datetime  = row.measuredAt?.value || '';
      if (!moeIri || isNaN(paramVal) || !datetime) continue;
      if (!moeMap[moeIri]) { moeMap[moeIri] = { name: moeName, params: {} }; paramIriMap[moeIri] = {}; }
      if (paramIri) paramIriMap[moeIri][paramIri] = paramName;
      if (!moeMap[moeIri].params[paramName]) moeMap[moeIri].params[paramName] = [];
      moeMap[moeIri].params[paramName].push({ value: paramVal, datetime });
    }

    // ── BN-derived measurement injection ─────────────────────────────────────
    // If Bayesian network results are available, compute beliefs for initial
    // (dataset-defined) states and inject a virtual measurement for any BN
    // latent node whose IRI matches an MOE input parameter.
    // The effective date is the latest completion date among passed observable tests.
    const bnData = (this._allResults || {}).bayesian_network;
    if (bnData?.bindings?.length) {
      const bnNodes = [], bnEdges = [];
      for (const row of bnData.bindings) {
        const type = row.rowType?.value;
        if (type === 'node') {
          bnNodes.push({
            id:       row.id?.value || '',
            visible:  row.visible?.value === 'true',
            prior:    parseFloat(row.trueVal?.value ?? '0.5'),
            trueVal:  parseFloat(row.trueVal?.value ?? '0.5'),
            falseVal: parseFloat(row.falseVal?.value ?? '0.5'),
            testDate: row.testDate?.value || null,
          });
        } else if (type === 'edge') {
          bnEdges.push({
            parent: row.parent?.value || '',
            child:  row.child?.value  || '',
            weight: parseFloat(row.weight?.value ?? '1.0'),
          });
        }
      }

      if (bnNodes.length > 0) {
        // Initial evidence states from dataset values
        const initStates = {};
        for (const n of bnNodes) {
          if (!n.visible) continue;
          initStates[n.id] = n.trueVal >= 1.0 ? 'pass' : n.trueVal <= 0.0 ? 'fail' : 'unknown';
        }

        const beliefs = this._computeBNBeliefs(bnNodes, bnEdges, initStates);

        // Effective date = latest completion date of a passed observable test
        const bnDate = bnNodes
          .filter(n => n.visible && initStates[n.id] === 'pass' && n.testDate)
          .map(n => n.testDate)
          .sort().at(-1);

        if (bnDate) {
          for (const [moeIri, moe] of Object.entries(moeMap)) {
            for (const [paramIri, paramName] of Object.entries(paramIriMap[moeIri] || {})) {
              const bnNode = bnNodes.find(n => n.id === paramIri && !n.visible);
              if (!bnNode) continue;
              const belief = beliefs[bnNode.id];
              if (belief === undefined || !moe.params[paramName]) continue;
              // Only inject if this date is newer than the latest existing measurement
              const latestExisting = [...moe.params[paramName]]
                .sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
              if (latestExisting && bnDate <= latestExisting.datetime) continue;
              moe.params[paramName].push({ value: belief * 100, datetime: bnDate, bnDerived: true });
            }
          }
        }
      }
    }
    // ── end BN injection ──────────────────────────────────────────────────────

    const moeKeys = Object.keys(moeMap);
    if (moeKeys.length === 0) {
      container.innerHTML = '<div class="tab-empty"><i class="bi bi-inbox"></i> No MOE calculation data found in this dataset.</div>';
      return;
    }

    const pendingCharts = [];
    let html = '';

    for (let mi = 0; mi < moeKeys.length; mi++) {
      const moe        = moeMap[moeKeys[mi]];
      const paramNames = Object.keys(moe.params);

      // Build event timeline: unique datetimes across all params, sorted
      const allDates = [...new Set(Object.values(moe.params).flat().map(m => m.datetime))].sort();

      // At each event date compute MOE using most-recent measurement per param up to that date
      const timeline = [];
      for (const dt of allDates) {
        const vals = {};
        for (const pn of paramNames) {
          const latest = moe.params[pn]
            .filter(m => m.datetime <= dt)
            .sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
          if (latest) vals[pn] = latest; // store full entry {value, datetime, bnDerived?}
        }
        // Only plot if every param has a measurement by this date
        if (Object.keys(vals).length === paramNames.length) {
          const product   = Object.values(vals).reduce((acc, v) => acc * (v.value / 100), 1) * 100;
          const bnDerived = Object.values(vals).some(v => v.bnDerived);
          timeline.push({ dt, product, vals, bnDerived });
        }
      }

      const current   = timeline[timeline.length - 1] || null;
      const currentPct = current ? current.product.toFixed(1) : '—';
      const pctNum     = current ? current.product : NaN;
      const valColor   = isNaN(pctNum) ? 'text-secondary'
                       : pctNum >= 50  ? 'text-success'
                       : pctNum >= 25  ? 'text-warning fw-semibold'
                       : 'text-danger fw-semibold';

      const canvasId = `moe-calc-${mi}`;
      pendingCharts.push({ canvasId, timeline, moeName: moe.name });

      // Input parameters table — latest value + last-updated date
      const paramRows = paramNames.map(pn => {
        const sorted = [...moe.params[pn]].sort((a, b) => b.datetime.localeCompare(a.datetime));
        const latest = sorted[0];
        const bnBadge = latest?.bnDerived
          ? ' <span class="badge" style="background:#f97316;font-size:10px">BN</span>' : '';
        return `<tr>
          <td>${pn}${bnBadge}</td>
          <td class="text-end fw-semibold">${latest ? latest.value.toFixed(1) + '%' : '—'}</td>
          <td class="text-muted small">${latest ? _formatDatetime(latest.datetime) : '—'}</td>
        </tr>`;
      }).join('');

      const divider = (mi < moeKeys.length - 1) ? '<hr class="my-4">' : '';
      html += `
        <div class="mb-3">
          <div class="d-flex align-items-baseline gap-3 mb-3">
            <h6 class="mb-0 fw-semibold">${moe.name}</h6>
            <span class="fs-3 fw-bold ${valColor}">${currentPct}%</span>
            <span class="text-muted small">current value (${_formatDatetime(current?.dt || '')})</span>
          </div>
          <div class="row g-3">
            <div class="col-md-7">
              <div style="position:relative;height:240px">
                <canvas id="${canvasId}"></canvas>
              </div>
              <div class="mt-1 small text-muted">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#0d6efd;vertical-align:middle"></span> Measured &nbsp;
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f97316;vertical-align:middle"></span> BN estimate
              </div>
            </div>
            <div class="col-md-5">
              <h6 class="small fw-semibold text-muted mb-1 text-uppercase">Input Parameters</h6>
              <table class="table table-sm result-table">
                <thead><tr><th>Parameter</th><th class="text-end">Latest</th><th>Updated</th></tr></thead>
                <tbody>${paramRows}</tbody>
              </table>
            </div>
          </div>
        </div>${divider}`;
    }

    container.innerHTML = html;

    // Initialise Chart.js line charts after DOM is painted
    for (const { canvasId, timeline, moeName } of pendingCharts) {
      const canvas = document.getElementById(canvasId);
      if (!canvas || timeline.length === 0) continue;
      const pointColors  = timeline.map(t => t.bnDerived ? '#f97316' : '#0d6efd');
      const pointRadii   = timeline.map(t => t.bnDerived ? 7 : 5);
      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: timeline.map(t => _formatDatetime(t.dt)),
          datasets: [{
            label: moeName,
            data:  timeline.map(t => parseFloat(t.product.toFixed(2))),
            borderColor:            '#0d6efd',
            backgroundColor:        'rgba(13,110,253,0.07)',
            fill:                   true,
            tension:                0.3,
            pointRadius:            pointRadii,
            pointHoverRadius:       pointRadii.map(r => r + 2),
            pointBackgroundColor:   pointColors,
            pointBorderColor:       pointColors,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => {
              const pt = timeline[ctx.dataIndex];
              return (pt?.bnDerived ? '⬤ BN estimate: ' : '') + ctx.parsed.y.toFixed(1) + '%';
            }}},
          },
          scales: {
            x: { title: { display: true, text: 'Date' } },
            y: {
              min: 0,
              max: 100,
              title: { display: true, text: 'MOE Value (%)' },
              ticks: { callback: v => v + '%' },
            },
          },
        },
      });
      this.charts[canvasId] = chart;
    }
  },

  // ── End MOE Calculations ───────────────────────────────────────────────────

  // ── Risk Matrices tab ─────────────────────────────────────────────────────

  _renderRiskMatrix(container, data) {
    if (!data.bindings || data.bindings.length === 0) {
      container.innerHTML = '<div class="tab-empty"><i class="bi bi-inbox"></i> No risk data found in this dataset.</div>';
      return;
    }

    // ── Build BN belief map from BN tab results (mirrors MOE tab pattern) ──
    const bnBeliefs = {};
    const bnData = (this._allResults || {}).bayesian_network;
    if (bnData?.bindings?.length) {
      const bnNodes = [], bnEdges = [];
      for (const row of bnData.bindings) {
        const type = row.rowType?.value;
        if (type === 'node') {
          bnNodes.push({
            id:      row.id?.value || '',
            visible: row.visible?.value === 'true',
            prior:   parseFloat(row.trueVal?.value  ?? '0.5'),
            trueVal: parseFloat(row.trueVal?.value  ?? '0.5'),
          });
        } else if (type === 'edge') {
          bnEdges.push({
            parent: row.parent?.value || '',
            child:  row.child?.value  || '',
            weight: parseFloat(row.weight?.value ?? '1.0'),
          });
        }
      }
      if (bnNodes.length) {
        const initStates = {};
        for (const n of bnNodes) {
          if (!n.visible) continue;
          initStates[n.id] = n.trueVal >= 1.0 ? 'pass' : n.trueVal <= 0.0 ? 'fail' : 'unknown';
        }
        const computed = this._computeBNBeliefs(bnNodes, bnEdges, initStates);
        for (const [id, b] of Object.entries(computed)) bnBeliefs[id] = b;
      }
    }

    // ── Group SPARQL rows by riskIri ───────────────────────────────────────
    // Each risk may appear multiple times (one row per linked test).
    const riskMap = {};   // iriStr → riskObj
    for (const row of data.bindings) {
      const iri  = row.riskIri?.value  || '';
      const type = row.riskType?.value || '';
      if (!iri || !type) continue;

      if (!riskMap[iri]) {
        const bnQtyIri  = row.bnQtyIri?.value || '';
        // Lookup BN posterior if available, else fall back to stored prior
        const storedPrior = parseFloat(row.bnTrueStateValue?.value ?? 'NaN');
        const bnBelief    = bnQtyIri && (bnQtyIri in bnBeliefs) ? bnBeliefs[bnQtyIri] : null;
        const adequacyP   = bnBelief !== null ? bnBelief : (isNaN(storedPrior) ? 0.5 : storedPrior);
        const likelihood  = 1 - adequacyP;   // P(risk materialises) = 1 - P(adequate performance)

        riskMap[iri] = {
          iri,
          type,
          name:          row.riskName?.value        || iri.split('#').pop(),
          description:   row.riskDescription?.value || '',
          severityScore: parseInt(row.severityScore?.value ?? '1', 10),
          severityLabel: row.severityLabel?.value   || '',
          subjectName:   row.subjectName?.value     || '',
          likelihood,
          bnQtyIri,
          tests: [],
        };
      }

      if (row.testID?.value) {
        const existing = riskMap[iri].tests.find(t => t.id === row.testID.value);
        if (!existing) {
          riskMap[iri].tests.push({
            id:     row.testID?.value   || '',
            name:   row.testName?.value || '',
            status: row.testStatus?.value || '',
          });
        }
      }
    }

    const allRisks = Object.values(riskMap);
    const dtRisks  = allRisks.filter(r => r.type === 'DT');
    const otRisks  = allRisks.filter(r => r.type === 'OT');

    // ── Parse influence links from supplementary risk_influence query ──────
    const influenceLinks = [];
    const infData = (this._allResults || {}).risk_influence;
    if (infData?.bindings?.length) {
      for (const row of infData.bindings) {
        const s = row.sysRiskIri?.value;
        const o = row.opRiskIri?.value;
        if (s && o && !influenceLinks.find(l => l.sysRiskIri === s && l.opRiskIri === o)) {
          influenceLinks.push({ sysRiskIri: s, opRiskIri: o });
        }
      }
    }

    // ── Influence diagram section ──────────────────────────────────────────
    const BOX_H = 52, BOX_GAP = 8, ROW_H = BOX_H + BOX_GAP;
    const containerH = Math.max(dtRisks.length, 1) * ROW_H - BOX_GAP;

    const dtBoxHtml = dtRisks.map((r, i) => {
      const col = this._riskCellColor(r.severityScore, this._likelihoodBand(r.likelihood));
      const highlight = influenceLinks.some(l => l.sysRiskIri === r.iri)
        ? 'border-right:3px solid rgba(255,255,255,0.7);' : '';
      return `<div id="risk-inf-dt-${i}" style="height:${BOX_H}px;margin-bottom:${BOX_GAP}px;background:${col};color:#fff;border-radius:4px;padding:5px 9px;display:flex;flex-direction:column;justify-content:center;${highlight}">
        <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.name}</div>
        <div style="font-size:10px;opacity:0.85;">${r.severityLabel} · ${(r.likelihood*100).toFixed(0)}% likely</div>
      </div>`;
    }).join('');

    const otBoxHtml = otRisks.map((r, j) => {
      const col = this._riskCellColor(r.severityScore, this._likelihoodBand(r.likelihood));
      const spacing = otRisks.length > 1 ? containerH / otRisks.length : containerH;
      const top = otRisks.length > 1 ? j * spacing + (spacing - BOX_H) / 2 : (containerH - BOX_H) / 2;
      const highlight = influenceLinks.some(l => l.opRiskIri === r.iri)
        ? 'border-left:3px solid rgba(255,255,255,0.7);' : '';
      return `<div id="risk-inf-ot-${j}" style="position:absolute;top:${top}px;left:0;right:0;height:${BOX_H}px;background:${col};color:#fff;border-radius:4px;padding:5px 9px;display:flex;flex-direction:column;justify-content:center;${highlight}">
        <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.name}</div>
        <div style="font-size:10px;opacity:0.85;">${r.severityLabel} · ${(r.likelihood*100).toFixed(0)}% likely</div>
      </div>`;
    }).join('');

    const influenceSectionHtml = `
      <div class="mt-4 pt-3" style="border-top:1px solid #dee2e6;">
        <h6 class="fw-semibold mb-1">Risk Influence Pathways</h6>
        <p class="text-muted small mb-3">System risks (DT) propagating to operational impact — derived from measurand dependencies</p>
        <div style="display:flex;align-items:flex-start;gap:0;">
          <div style="flex:0 0 260px;">
            <div class="text-muted small fw-semibold mb-2" style="text-align:center;">System Risks (DT)</div>
            ${dtBoxHtml}
          </div>
          <div style="flex:1;min-width:60px;max-width:120px;position:relative;align-self:stretch;">
            <svg id="risk-inf-svg" width="100%" height="100%" style="position:absolute;inset:0;overflow:visible;"></svg>
          </div>
          <div style="flex:0 0 260px;">
            <div class="text-muted small fw-semibold mb-2" style="text-align:center;">Operational Risks (OT)</div>
            <div style="position:relative;height:${containerH}px;">${otBoxHtml}</div>
          </div>
        </div>
        ${influenceLinks.length === 0 ? '<p class="text-muted small mt-2"><em>No measurand-derived influence links found. Run Re-query if Fuseki is running.</em></p>' : ''}
      </div>`;

    container.innerHTML = `
      <div class="row g-4">
        <div class="col-lg-6">
          <h6 class="fw-semibold mb-1">System Performance Risk Matrix</h6>
          <p class="text-muted small mb-2">Risks informed by Developmental Testing (DT)</p>
          ${this._buildRiskMatrixGrid('dt', dtRisks)}
          ${this._buildRiskTable(dtRisks)}
        </div>
        <div class="col-lg-6">
          <h6 class="fw-semibold mb-1">Operational Risk Matrix</h6>
          <p class="text-muted small mb-2">Risks informed by Operational Testing (OT)</p>
          ${this._buildRiskMatrixGrid('ot', otRisks)}
          ${this._buildRiskTable(otRisks)}
        </div>
      </div>
      <div class="mt-3 d-flex gap-4 flex-wrap align-items-center small text-muted">
        <span class="fw-semibold">Consequence →</span>
        ${['Low','Medium','High','Extreme'].map((l,i) => {
          const c = ['#16a34a','#ca8a04','#dc2626','#991b1b'][i];
          return `<span><span style="display:inline-block;width:12px;height:12px;background:${c};border-radius:2px;vertical-align:middle;margin-right:3px"></span>${l}</span>`;
        }).join('')}
        <span class="ms-2">Likelihood bands: 1 Rare &lt;10% · 2 Unlikely 10–30% · 3 Possible 30–50% · 4 Likely 50–70% · 5 Near Certain &gt;70%</span>
      </div>
      ${influenceSectionHtml}`;

    if (influenceLinks.length) {
      requestAnimationFrame(() => this._drawInfluenceLines(container, influenceLinks, dtRisks, otRisks, riskMap));
      // If the tab is hidden (display:none) the RAF fires with zero dimensions — also
      // draw on next show so lines appear whenever the user switches to this tab.
      const tabBtn = document.querySelector('[data-bs-target="#tab-pane-risk_matrix"]');
      if (tabBtn) {
        const onShown = () => {
          this._drawInfluenceLines(container, influenceLinks, dtRisks, otRisks, riskMap);
          tabBtn.removeEventListener('shown.bs.tab', onShown);
        };
        tabBtn.addEventListener('shown.bs.tab', onShown);
      }
    }
  },

  // DoD 5×5 consequence × likelihood colour table
  // rows = consequence 1..5 (bottom→top), cols = likelihood 1..5
  _riskCellColor(cons, like) {
    // Standard DoD risk colour matrix
    const table = [
    //  L1       L2       L3       L4       L5
      ['#16a34a','#16a34a','#16a34a','#16a34a','#16a34a'],  // C1 Negligible
      ['#16a34a','#16a34a','#16a34a','#ca8a04','#ca8a04'],  // C2 Marginal
      ['#16a34a','#16a34a','#ca8a04','#dc2626','#dc2626'],  // C3 Moderate
      ['#16a34a','#ca8a04','#dc2626','#dc2626','#991b1b'],  // C4 Critical
      ['#ca8a04','#dc2626','#dc2626','#991b1b','#991b1b'],  // C5 Catastrophic
    ];
    const c = Math.max(0, Math.min(4, cons - 1));
    const l = Math.max(0, Math.min(4, like - 1));
    return table[c][l];
  },

  _likelihoodBand(p) {
    if (p < 0.10) return 1;
    if (p < 0.30) return 2;
    if (p < 0.50) return 3;
    if (p < 0.70) return 4;
    return 5;
  },

  _likelihoodLabel(band) {
    return ['','Rare','Unlikely','Possible','Likely','Near Certain'][band] || '';
  },

  _buildRiskMatrixGrid(prefix, risks) {
    const SEVERITY_LABELS = ['','Negligible','Marginal','Moderate','Critical','Catastrophic'];
    const LIKELIHOOD_LABELS = ['','Rare\n<10%','Unlikely\n10–30%','Possible\n30–50%','Likely\n50–70%','Near Certain\n>70%'];

    // Place risks into grid cells: [cons][like] → [riskNames]
    const cells = {};
    for (const r of risks) {
      const like = this._likelihoodBand(r.likelihood);
      const key  = `${r.severityScore}_${like}`;
      if (!cells[key]) cells[key] = [];
      cells[key].push(r);
    }

    const axisStyle = 'font-size:10px;font-weight:600;color:#555;text-align:center;line-height:1.2;padding:2px;';
    const cellSize  = 'width:72px;height:60px;';

    // Build table: consequence rows 5→1 (top=catastrophic), likelihood cols 1→5
    let rows = '';
    for (let c = 5; c >= 1; c--) {
      let tds = `<td style="writing-mode:vertical-rl;transform:rotate(180deg);${axisStyle}width:20px;">${SEVERITY_LABELS[c]}</td>`;
      for (let l = 1; l <= 5; l++) {
        const color  = this._riskCellColor(c, l);
        const key    = `${c}_${l}`;
        const cell   = cells[key] || [];
        const badges = cell.map(r => {
          const testTip = r.tests.map(t => `${t.id} [${t.status}]`).join(', ');
          const abbrev  = r.name.length > 18 ? r.name.slice(0, 16) + '…' : r.name;
          return `<span title="${r.name}&#10;${r.description ? r.description.slice(0,100)+'…' : ''}&#10;Tests: ${testTip || 'none'}"
                       style="display:block;background:rgba(0,0,0,0.18);color:#fff;border-radius:3px;
                              font-size:9px;padding:1px 3px;margin:1px 0;white-space:nowrap;
                              overflow:hidden;text-overflow:ellipsis;cursor:default;">${abbrev}</span>`;
        }).join('');
        tds += `<td style="background:${color};${cellSize}vertical-align:top;padding:2px;">${badges}</td>`;
      }
      rows += `<tr>${tds}</tr>`;
    }

    // Likelihood axis row
    let axisRow = '<td></td>';
    for (let l = 1; l <= 5; l++) {
      const lbl = LIKELIHOOD_LABELS[l].replace('\n','<br>');
      axisRow += `<td style="${axisStyle}padding-top:4px;">${lbl}</td>`;
    }

    return `
      <div style="overflow-x:auto;margin-bottom:10px;">
        <table style="border-collapse:collapse;font-size:11px;">
          <tbody>
            ${rows}
            <tr>${axisRow}</tr>
          </tbody>
        </table>
        <div style="font-size:10px;color:#777;margin-top:2px;">← Likelihood</div>
      </div>`;
  },

  _drawInfluenceLines(container, links, dtRisks, otRisks, riskMap) {
    const svg = container.querySelector('#risk-inf-svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();
    if (!svgRect.width) return;

    const defs = [];
    const paths = [];

    for (const link of links) {
      const dtIdx = dtRisks.findIndex(r => r.iri === link.sysRiskIri);
      const otIdx = otRisks.findIndex(r => r.iri === link.opRiskIri);
      if (dtIdx < 0 || otIdx < 0) continue;

      const dtEl = container.querySelector(`#risk-inf-dt-${dtIdx}`);
      const otEl = container.querySelector(`#risk-inf-ot-${otIdx}`);
      if (!dtEl || !otEl) continue;

      const dtRect = dtEl.getBoundingClientRect();
      const otRect = otEl.getBoundingClientRect();

      const x1  = dtRect.right  - svgRect.left;
      const y1  = dtRect.top    + dtRect.height / 2 - svgRect.top;
      const x2  = otRect.left   - svgRect.left;
      const y2  = otRect.top    + otRect.height / 2 - svgRect.top;
      const cp  = Math.abs(x2 - x1) * 0.45;

      const risk  = riskMap[link.sysRiskIri];
      const color = this._riskCellColor(
        risk?.severityScore ?? 3,
        this._likelihoodBand(risk?.likelihood ?? 0.5)
      );
      const mid = `${dtIdx}-${otIdx}`;
      defs.push(`<marker id="arr-${mid}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="${color}" opacity="0.9"/>
      </marker>`);
      paths.push(`<path d="M${x1},${y1} C${x1+cp},${y1} ${x2-cp},${y2} ${x2},${y2}"
        fill="none" stroke="${color}" stroke-width="2.5" stroke-opacity="0.85"
        marker-end="url(#arr-${mid})"/>`);
    }

    svg.innerHTML = `<defs>${defs.join('')}</defs>${paths.join('')}`;
  },

  _buildRiskTable(risks) {
    if (risks.length === 0) return '<div class="text-muted small">No risks found.</div>';

    const rows = [...risks]
      .sort((a, b) => (b.severityScore - a.severityScore) || (b.likelihood - a.likelihood))
      .map(r => {
        const like   = this._likelihoodBand(r.likelihood);
        const likeL  = this._likelihoodLabel(like);
        const pct    = (r.likelihood * 100).toFixed(0) + '%';
        const color  = this._riskCellColor(r.severityScore, like);
        const dot    = `<span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:50%;vertical-align:middle;margin-right:4px"></span>`;
        const testBadges = r.tests.map(t => {
          const bc = t.status === 'Completed' ? '#16a34a' : '#6c757d';
          return `<span style="font-size:10px;background:${bc};color:#fff;border-radius:3px;padding:1px 4px;margin-right:2px;">${t.id}</span>`;
        }).join('') || '<span class="text-muted small">—</span>';
        return `<tr>
          <td>${dot}${r.name}</td>
          <td class="text-center">${r.severityLabel}</td>
          <td class="text-center">${likeL} (${pct})</td>
          <td>${testBadges}</td>
        </tr>`;
      }).join('');

    return `
      <div class="table-responsive">
        <table class="table table-sm result-table" style="font-size:12px;">
          <thead><tr><th>Risk</th><th class="text-center">Consequence</th><th class="text-center">Likelihood</th><th>Informing Tests</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  // ── End Risk Matrices ─────────────────────────────────────────────────────

  async showLog() {
    const data = await apiFetch(`/projects/${App.currentProjectId}/build/log`).catch(() => ({ log: 'Could not retrieve log.' }));
    document.getElementById('build-log-content').textContent = data.log || 'No log available.';
    new bootstrap.Modal(document.getElementById('modal-build-log')).show();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function _humanize(varName) {
  return varName
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\s/, '')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function _formatValue(val) {
  if (!val || val === '—') return '—';
  // Shorten long URIs to local name
  const hash = val.lastIndexOf('#');
  const slash = val.lastIndexOf('/');
  const cut = Math.max(hash, slash);
  if (cut > 0 && val.startsWith('http')) return `<span title="${val}">${val.slice(cut+1)}</span>`;
  return val;
}

function _formatDatetime(dt) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return dt; }
}

function _isGapRow(row, vars) {
  // A row is a "gap" if a key variable is unbound (test, requirement, etc.)
  const gapKeys = ['testName', 'test', 'requirementText', 'reqText', 'verifies'];
  return gapKeys.some(k => vars.includes(k) && !row[k]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
