const state = {
  companies: [],
  periods: [],
  selectedCompany: null,
  currentReport: null
};

const els = {
  form: document.querySelector("#report-form"),
  companySelect: document.querySelector("#company-select"),
  tickerInput: document.querySelector("#ticker-input"),
  tickerButton: document.querySelector("#ticker-button"),
  yearSelect: document.querySelector("#year-select"),
  periods: document.querySelector("#periods"),
  title: document.querySelector("#report-title"),
  periodRange: document.querySelector("#period-range"),
  status: document.querySelector("#status-pill"),
  detailLink: document.querySelector("#detail-link"),
  analysis: document.querySelector("#analysis-panel"),
  metrics: document.querySelector("#metrics-strip"),
  compareMetric: document.querySelector("#compare-metric"),
  compareMode: document.querySelector("#compare-mode"),
  compareLimit: document.querySelector("#compare-limit"),
  compareChart: document.querySelector("#compare-chart"),
  compareTableBody: document.querySelector("#compare-table-body"),
  statements: document.querySelector("#statements"),
  statementTemplate: document.querySelector("#statement-template")
};

const formatNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

const formatDecimal = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});

const isGitHubPages = location.hostname.endsWith("github.io");

init();

async function init() {
  setStatus("加载公司", "loading");
  try {
    const { companies } = await fetchJson("/api/companies");
    state.companies = companies;
    renderCompanies();
    await refreshPeriods();
    await loadReport();
  } catch (error) {
    showError(error);
  }
}

els.companySelect.addEventListener("change", async () => {
  await refreshPeriods();
  await loadReport();
});

els.tickerButton.addEventListener("click", async () => {
  await searchTicker();
});

els.tickerInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await searchTicker();
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadReport();
});

for (const control of [els.compareMetric, els.compareMode, els.compareLimit]) {
  control.addEventListener("change", async () => {
    await loadComparison();
  });
}

async function searchTicker() {
  const rawTicker = els.tickerInput.value.trim();
  if (!rawTicker) return;

  els.tickerButton.disabled = true;
  setStatus("查询公司", "loading");

  try {
    const { company } = await fetchJson(`/api/company?ticker=${encodeURIComponent(rawTicker)}`);
    upsertCompany(company);
    renderCompanies();
    els.companySelect.value = company.cik;
    els.tickerInput.value = company.ticker;
    await refreshPeriods();
    await loadReport();
  } catch (error) {
    showError(error);
    setStatus("查询失败", "error");
  } finally {
    els.tickerButton.disabled = false;
  }
}

async function refreshPeriods() {
  const cik = els.companySelect.value;
  state.selectedCompany = state.companies.find((company) => company.cik === cik);
  setStatus("读取期间", "loading");
  try {
    const { periods } = await fetchJson(`/api/periods?cik=${encodeURIComponent(cik)}`);
    state.periods = periods;
    renderYearsAndPeriods();
    setStatus("可加载", "ready");
  } catch (error) {
    state.periods = fallbackPeriods();
    renderYearsAndPeriods();
    setStatus("期间失败", "error");
    showError(error);
  }
}

async function loadReport() {
  const cik = els.companySelect.value;
  const year = els.yearSelect.value;
  const period = document.querySelector("input[name='period']:checked")?.value || "FY";
  const button = els.form.querySelector("button");

  button.disabled = true;
  setStatus("加载中", "loading");
  clearReport();

  try {
    const report = await fetchJson(
      `/api/report?cik=${encodeURIComponent(cik)}&year=${encodeURIComponent(year)}&period=${encodeURIComponent(period)}`
    );
    state.currentReport = report;
    renderReport(report);
    await loadComparison();
    setStatus("已加载", "ready");
  } catch (error) {
    state.currentReport = null;
    showError(error);
    setStatus("失败", "error");
  } finally {
    button.disabled = false;
  }
}

function renderCompanies() {
  els.companySelect.innerHTML = state.companies
    .map(
      (company) =>
        `<option value="${company.cik}">${company.ticker} · ${company.nameZh} / ${company.name}</option>`
    )
    .join("");
}

function upsertCompany(company) {
  const existingIndex = state.companies.findIndex((item) => item.cik === company.cik);
  if (existingIndex >= 0) {
    state.companies[existingIndex] = company;
    return;
  }
  state.companies = [...state.companies, company].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function renderYearsAndPeriods() {
  const years = [...new Set(state.periods.map((period) => period.year))].sort((a, b) => b - a);
  els.yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");

  const currentYear = Number(els.yearSelect.value || years[0]);
  const available = new Set(
    state.periods.filter((period) => period.year === currentYear).map((period) => period.period)
  );
  const periodMap = new Map(
    state.periods.filter((period) => period.year === currentYear).map((period) => [period.period, period])
  );

  updatePeriodAvailability(available, periodMap);
  els.yearSelect.onchange = () => {
    const year = Number(els.yearSelect.value);
    const nextAvailable = new Set(
      state.periods.filter((period) => period.year === year).map((period) => period.period)
    );
    const nextPeriodMap = new Map(
      state.periods.filter((period) => period.year === year).map((period) => [period.period, period])
    );
    updatePeriodAvailability(nextAvailable, nextPeriodMap);
  };
}

function updatePeriodAvailability(available, periodMap = new Map()) {
  for (const input of els.periods.querySelectorAll("input")) {
    const enabled = available.size === 0 || available.has(input.value);
    const period = periodMap.get(input.value);
    const label = input.closest("label");
    const labelText = label.querySelector("[data-period-label]");
    const dateText = label.querySelector("small");

    input.disabled = !enabled;
    label.classList.toggle("empty", !enabled);
    labelText.textContent = input.value === "FY" ? "年度 FY" : input.value;
    dateText.textContent = formatPeriodRange(period);
  }
  const checked = els.periods.querySelector("input:checked");
  if (checked?.disabled) {
    const firstEnabled = els.periods.querySelector("input:not(:disabled)");
    if (firstEnabled) firstEnabled.checked = true;
  }
}

function renderReport(report) {
  els.title.textContent = `${report.company.ticker} · ${report.company.nameZh} ${report.requested.year} ${report.requested.period}`;
  els.periodRange.textContent =
    report.requested.start && report.requested.end
      ? formatReportPeriodRange(report.requested)
      : "财报覆盖期间：暂无起止日期";
  renderDetailLink(report);
  renderAnalysis(report.analysis);
  renderMetricStrip(report);
  renderStatements(report.statements);
}

function renderDetailLink(report) {
  const filingUrl = report.source?.filing?.url;
  if (!filingUrl) {
    els.detailLink.href = "#";
    els.detailLink.setAttribute("aria-disabled", "true");
    return;
  }
  els.detailLink.href = filingUrl;
  els.detailLink.setAttribute("aria-disabled", "false");
  els.detailLink.title = `${report.source.filing.form || "SEC filing"} ${report.source.filing.accessionNumber}`;
}

function renderAnalysis(analysis) {
  const warnings = analysis.warnings.length
    ? `<div class="warning-box"><strong>需要注意</strong><ul class="analysis-list">${analysis.warnings
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul></div>`
    : `<div class="warning-box"><strong>需要注意</strong><p>当前没有触发明显风险提醒。</p></div>`;

  els.analysis.innerHTML = `
    <div>
      <p class="eyebrow">智能解读</p>
      <h3>快速财报摘要</h3>
    </div>
    <p class="muted">${escapeHtml(analysis.summary)}</p>
    <div class="analysis-grid">
      <div>
        <strong>核心观察</strong>
        <ul class="analysis-list">
          ${analysis.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
      ${warnings}
    </div>
  `;
}

function renderMetricStrip(report) {
  const derived = report.derived;
  const rowLookup = Object.fromEntries(
    report.statements.flatMap((statement) => statement.rows.map((row) => [row.key, row]))
  );
  const cards = [
    ["营业收入", money(rowLookup.revenue?.value)],
    ["净利润", money(rowLookup.netIncome?.value)],
    ["毛利率", percent(derived.grossMargin)],
    ["自由现金流", money(derived.freeCashFlow)],
    ["负债率", percent(derived.debtRatio)]
  ];

  els.metrics.innerHTML = cards
    .map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function renderStatements(statements) {
  els.statements.innerHTML = "";
  for (const statement of statements) {
    const node = els.statementTemplate.content.cloneNode(true);
    node.querySelector("h3").textContent = statement.title;
    node.querySelector(".statement-heading span").textContent = statement.titleEn;
    const tbody = node.querySelector("tbody");
    tbody.innerHTML = statement.rows.map(renderRow).join("");
    els.statements.appendChild(node);
  }
}

async function loadComparison() {
  const cik = els.companySelect.value;
  if (!cik) return;

  els.compareChart.innerHTML = `<div class="empty-state">正在生成对比图...</div>`;
  els.compareTableBody.innerHTML = "";

  try {
    const params = new URLSearchParams({
      cik,
      metric: els.compareMetric.value,
      mode: els.compareMode.value,
      limit: els.compareLimit.value
    });
    const comparison = await fetchJson(`/api/compare?${params.toString()}`);
    renderComparison(comparison);
  } catch (error) {
    els.compareChart.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderComparison(comparison) {
  const points = comparison.points.filter((point) => typeof point.value === "number");
  if (!points.length) {
    els.compareChart.innerHTML = `<div class="empty-state">这个指标暂无可对比数据。</div>`;
    els.compareTableBody.innerHTML = comparison.points.map((point) => renderCompareRow(point, comparison.unit)).join("");
    return;
  }

  els.compareChart.innerHTML = buildBarChart(points, comparison);
  els.compareTableBody.innerHTML = comparison.points.map((point) => renderCompareRow(point, comparison.unit)).join("");
}

function buildBarChart(points, comparison) {
  const width = Math.max(680, points.length * 86);
  const height = 280;
  const top = 34;
  const right = 24;
  const bottom = 52;
  const left = 64;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const values = points.map((point) => point.value);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const span = maxValue - minValue || 1;
  const y = (value) => top + ((maxValue - value) / span) * plotHeight;
  const zeroY = y(0);
  const step = plotWidth / points.length;
  const barWidth = Math.min(46, step * 0.58);

  const bars = points
    .map((point, index) => {
      const x = left + index * step + (step - barWidth) / 2;
      const valueY = y(point.value);
      const barY = Math.min(valueY, zeroY);
      const barHeight = Math.max(2, Math.abs(zeroY - valueY));
      const labelY = point.value >= 0 ? barY - 8 : barY + barHeight + 16;
      return `
        <rect class="chart-bar ${point.value < 0 ? "negative" : ""}" x="${x.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4"></rect>
        <text class="chart-value" x="${(x + barWidth / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${formatCompareValue(point.value, comparison.unit)}</text>
        <text class="chart-label" x="${(x + barWidth / 2).toFixed(1)}" y="${height - 24}" text-anchor="middle">${escapeHtml(point.label)}</text>
      `;
    })
    .join("");

  return `
    <svg class="compare-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(comparison.metricLabel)}对比图">
      <text class="chart-value" x="${left}" y="22">${escapeHtml(comparison.metricLabel)} · ${comparison.mode === "annual" ? "年度" : "季度"}对比</text>
      <line class="chart-grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
      <line class="chart-grid" x1="${left}" y1="${zeroY.toFixed(1)}" x2="${width - right}" y2="${zeroY.toFixed(1)}"></line>
      <line class="chart-grid" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
      <line class="chart-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"></line>
      <text class="chart-label" x="12" y="${top + 4}">${formatCompareValue(maxValue, comparison.unit)}</text>
      <text class="chart-label" x="12" y="${zeroY + 4}">0</text>
      <text class="chart-label" x="12" y="${height - bottom + 4}">${formatCompareValue(minValue, comparison.unit)}</text>
      ${bars}
    </svg>
  `;
}

function renderCompareRow(point, unit) {
  return `
    <tr>
      <td>${escapeHtml(point.label)}</td>
      <td class="value">${formatCompareValue(point.value, unit)}</td>
      <td>${point.start && point.end ? `${escapeHtml(formatDateShort(point.start))} - ${escapeHtml(formatDateShort(point.end))}` : escapeHtml(point.end || "-")}</td>
      <td>${escapeHtml(point.filed || "-")}</td>
    </tr>
  `;
}

function renderRow(row) {
  const value = row.status === "ok" ? money(row.value, row.unit) : "暂无匹配数据";
  const date = row.end || row.filed || "-";
  return `
    <tr>
      <td>${escapeHtml(row.zh)}</td>
      <td>
        <div class="xbrl">
          <span>${escapeHtml(row.en)}</span>
          <code>${escapeHtml(row.tag || "")}</code>
        </div>
      </td>
      <td class="value ${row.status === "ok" ? "" : "empty"}">${value}</td>
      <td>${escapeHtml(row.unit || "-")}</td>
      <td>${escapeHtml(date)}</td>
    </tr>
  `;
}

function clearReport() {
  els.metrics.innerHTML = "";
  els.statements.innerHTML = "";
  els.periodRange.textContent = "财报覆盖期间：加载中";
  els.detailLink.setAttribute("aria-disabled", "true");
  els.analysis.innerHTML = `
    <div>
      <p class="eyebrow">智能解读</p>
      <h3>正在整理财报</h3>
    </div>
    <p class="muted">正在从 SEC 公开数据中抽取标准财报项目。</p>
  `;
}

function showError(error) {
  els.analysis.innerHTML = `
    <div>
      <p class="eyebrow">错误</p>
      <h3>暂时无法加载财报</h3>
    </div>
    <p class="muted">${escapeHtml(error.message || "Unknown error")}</p>
  `;
}

function setStatus(text, mode) {
  els.status.textContent = text;
  els.status.dataset.mode = mode;
}

async function fetchJson(url) {
  if (isGitHubPages) {
    throw new Error("GitHub Pages 只能托管静态页面，不能运行本项目的 SEC 代理后端。请在本地用 npm start 访问完整功能。");
  }
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function money(value, unit = "USD") {
  if (typeof value !== "number") return "暂无";
  if (unit === "USD/shares") return `$${formatDecimal.format(value)}`;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${formatDecimal.format(abs / 1e12)}T`;
  if (abs >= 1e9) return `${sign}$${formatDecimal.format(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${formatDecimal.format(abs / 1e6)}M`;
  return `${sign}$${formatNumber.format(abs)}`;
}

function formatCompareValue(value, unit) {
  if (typeof value !== "number") return "暂无";
  if (unit === "percent") return percent(value);
  return money(value, unit);
}

function percent(value) {
  if (typeof value !== "number") return "暂无";
  return `${(value * 100).toFixed(1)}%`;
}

function formatPeriodRange(period) {
  if (!period?.start || !period?.end) return "暂无日期";
  const fullRange = `${formatDateShort(period.start)} - ${formatDateShort(period.end)}`;
  if (period.period === "FY" && period.q4Start && period.q4End) {
    return `FY ${fullRange} · Q4 ${formatDateShort(period.q4Start)} - ${formatDateShort(period.q4End)}`;
  }
  return fullRange;
}

function formatReportPeriodRange(requested) {
  const fullRange = `财报覆盖期间：${formatDateLong(requested.start)} 至 ${formatDateLong(requested.end)}`;
  if (requested.period === "FY" && requested.q4Start && requested.q4End) {
    return `${fullRange}，其中 Q4：${formatDateLong(requested.q4Start)} 至 ${formatDateLong(requested.q4End)}`;
  }
  return fullRange;
}

function formatDateShort(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function formatDateLong(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

function fallbackPeriods() {
  const currentYear = new Date().getFullYear() - 1;
  return [
    { year: currentYear, period: "FY" },
    { year: currentYear, period: "Q3" },
    { year: currentYear, period: "Q2" },
    { year: currentYear, period: "Q1" }
  ];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
