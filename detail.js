const params = new URLSearchParams(window.location.search);
const els = {
  title: document.querySelector("#detail-title"),
  status: document.querySelector("#detail-status"),
  summary: document.querySelector("#detail-summary"),
  statements: document.querySelector("#detail-statements"),
  template: document.querySelector("#detail-statement-template"),
  backLink: document.querySelector("#back-link")
};

const formatNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const formatDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const isGitHubPages = location.hostname.endsWith("github.io");

init();

async function init() {
  const cik = params.get("cik");
  const year = params.get("year");
  const period = params.get("period");

  if (!cik || !year || !period) {
    showError(new Error("缺少财报参数，请从工作台进入详情页。"));
    return;
  }

  els.backLink.href = `/?cik=${encodeURIComponent(cik)}`;
  try {
    const report = await fetchJson(
      `/api/report?cik=${encodeURIComponent(cik)}&year=${encodeURIComponent(year)}&period=${encodeURIComponent(period)}`
    );
    renderReport(report);
    setStatus("已加载", "ready");
  } catch (error) {
    showError(error);
    setStatus("失败", "error");
  }
}

function renderReport(report) {
  els.title.textContent = `${report.company.ticker} · ${report.company.nameZh} ${report.requested.year} ${report.requested.period}`;
  els.summary.innerHTML = `
    <div>
      <p class="eyebrow">Source</p>
      <h3>详细财报字段</h3>
    </div>
    <p class="muted">${escapeHtml(report.source.note)}</p>
    <div class="detail-meta">
      <div><span>公司</span><strong>${escapeHtml(report.company.name)}</strong></div>
      <div><span>CIK</span><strong>${escapeHtml(report.company.cik)}</strong></div>
      <div><span>数据源</span><strong>${escapeHtml(report.source.provider)}</strong></div>
      <div><span>期间</span><strong>${report.requested.year} ${escapeHtml(report.requested.period)}</strong></div>
    </div>
    <div>
      <strong>智能解读</strong>
      <ul class="analysis-list">
        ${report.analysis.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;

  els.statements.innerHTML = "";
  for (const statement of report.statements) {
    const node = els.template.content.cloneNode(true);
    node.querySelector("h3").textContent = statement.title;
    node.querySelector(".statement-heading span").textContent = statement.titleEn;
    node.querySelector("tbody").innerHTML = statement.rows.map(renderRow).join("");
    els.statements.appendChild(node);
  }
}

function renderRow(row) {
  return `
    <tr>
      <td>${escapeHtml(row.zh)}</td>
      <td>
        <div class="xbrl">
          <span>${escapeHtml(row.en)}</span>
          <code>${escapeHtml(row.tag || "")}</code>
          <span class="muted">${escapeHtml(row.xbrlLabel || "")}</span>
        </div>
      </td>
      <td class="value ${row.status === "ok" ? "" : "empty"}">${row.status === "ok" ? money(row.value, row.unit) : "暂无匹配数据"}</td>
      <td>${escapeHtml(row.unit || "-")}</td>
      <td>${escapeHtml(row.end || "-")}</td>
      <td>${escapeHtml(row.filed || "-")}</td>
      <td>${escapeHtml(row.form || "-")}</td>
      <td><code>${escapeHtml(row.accn || "-")}</code></td>
    </tr>
  `;
}

function showError(error) {
  els.summary.innerHTML = `
    <div>
      <p class="eyebrow">错误</p>
      <h3>无法加载详情</h3>
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
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
