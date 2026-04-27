import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT || "FinancialStatementsViewer/0.1 contact@example.com";

const companies = [
  { ticker: "NVDA", cik: "0001045810", name: "NVIDIA Corporation", nameZh: "英伟达" },
  { ticker: "TSLA", cik: "0001318605", name: "Tesla, Inc.", nameZh: "特斯拉" },
  { ticker: "AAPL", cik: "0000320193", name: "Apple Inc.", nameZh: "苹果" },
  { ticker: "MSFT", cik: "0000789019", name: "Microsoft Corporation", nameZh: "微软" },
  { ticker: "AMZN", cik: "0001018724", name: "Amazon.com, Inc.", nameZh: "亚马逊" },
  { ticker: "GOOGL", cik: "0001652044", name: "Alphabet Inc.", nameZh: "Alphabet" },
  { ticker: "META", cik: "0001326801", name: "Meta Platforms, Inc.", nameZh: "Meta" }
];

const statementConfig = [
  {
    key: "income",
    title: "利润表",
    titleEn: "Income Statement",
    items: [
      metric("revenue", "营业收入", "Revenue", "USD", [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet"
      ]),
      metric("costOfRevenue", "营业成本", "Cost of revenue", "USD", [
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold"
      ]),
      metric("grossProfit", "毛利润", "Gross profit", "USD", ["GrossProfit"]),
      metric("researchDevelopment", "研发费用", "Research and development", "USD", [
        "ResearchAndDevelopmentExpense"
      ]),
      metric("sellingGeneralAdministrative", "销售及管理费用", "Selling, general and administrative", "USD", [
        "SellingGeneralAndAdministrativeExpense"
      ]),
      metric("operatingIncome", "营业利润", "Operating income", "USD", ["OperatingIncomeLoss"]),
      metric("incomeTax", "所得税费用", "Income tax expense", "USD", ["IncomeTaxExpenseBenefit"]),
      metric("netIncome", "净利润", "Net income", "USD", ["NetIncomeLoss"]),
      metric("epsDiluted", "稀释每股收益", "Diluted earnings per share", "USD/shares", [
        "EarningsPerShareDiluted"
      ])
    ]
  },
  {
    key: "balance",
    title: "资产负债表",
    titleEn: "Balance Sheet",
    items: [
      metric("cash", "现金及现金等价物", "Cash and cash equivalents", "USD", [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
      ]),
      metric("shortTermInvestments", "短期投资", "Short-term investments", "USD", [
        "ShortTermInvestments"
      ]),
      metric("accountsReceivable", "应收账款", "Accounts receivable", "USD", [
        "AccountsReceivableNetCurrent"
      ]),
      metric("inventory", "存货", "Inventory", "USD", ["InventoryNet"]),
      metric("assetsCurrent", "流动资产", "Current assets", "USD", ["AssetsCurrent"]),
      metric("assets", "总资产", "Total assets", "USD", ["Assets"]),
      metric("liabilitiesCurrent", "流动负债", "Current liabilities", "USD", ["LiabilitiesCurrent"]),
      metric("liabilities", "总负债", "Total liabilities", "USD", ["Liabilities"]),
      metric("longTermDebt", "长期债务", "Long-term debt", "USD", [
        "LongTermDebtNoncurrent",
        "LongTermDebtAndFinanceLeaseObligationsNoncurrent"
      ]),
      metric("equity", "股东权益", "Stockholders' equity", "USD", [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
      ])
    ]
  },
  {
    key: "cashflow",
    title: "现金流量表",
    titleEn: "Cash Flow Statement",
    items: [
      metric("operatingCashFlow", "经营活动现金流", "Net cash from operating activities", "USD", [
        "NetCashProvidedByUsedInOperatingActivities"
      ]),
      metric("capex", "资本开支", "Capital expenditures", "USD", [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
        "PaymentsToAcquirePropertyAndEquipment"
      ]),
      metric("investingCashFlow", "投资活动现金流", "Net cash from investing activities", "USD", [
        "NetCashProvidedByUsedInInvestingActivities"
      ]),
      metric("financingCashFlow", "融资活动现金流", "Net cash from financing activities", "USD", [
        "NetCashProvidedByUsedInFinancingActivities"
      ]),
      metric("cashEnd", "期末现金", "Cash at end of period", "USD", [
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        "CashAndCashEquivalentsAtCarryingValue"
      ])
    ]
  }
];

const companyFactsCache = new Map();
const submissionsCache = new Map();
const resolvedCompanies = new Map(companies.map((company) => [company.cik, company]));
let tickerMapCache = null;
const CACHE_TTL_MS = 15 * 60 * 1000;
const TICKER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const compareMetricConfig = {
  revenue: { label: "营业收入", unit: "USD", source: "row" },
  netIncome: { label: "净利润", unit: "USD", source: "row" },
  freeCashFlow: { label: "自由现金流", unit: "USD", source: "derived" },
  grossMargin: { label: "毛利率", unit: "percent", source: "derived" },
  debtRatio: { label: "负债率", unit: "percent", source: "derived" },
  assets: { label: "总资产", unit: "USD", source: "row" },
  liabilities: { label: "总负债", unit: "USD", source: "row" }
};

function metric(key, zh, en, unit, tags) {
  return { key, zh, en, unit, tags };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

async function getCompanyFacts(cik) {
  const cached = companyFactsCache.get(cik);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br"
    }
  });

  if (!response.ok) {
    throw new Error(`SEC returned ${response.status} for CIK ${cik}`);
  }

  const data = await response.json();
  companyFactsCache.set(cik, { createdAt: Date.now(), data });
  return data;
}

async function getCompanySubmissions(cik) {
  const cacheKey = `main:${cik}`;
  const cached = submissionsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br"
    }
  });

  if (!response.ok) {
    throw new Error(`SEC submissions returned ${response.status} for CIK ${cik}`);
  }

  const data = await response.json();
  submissionsCache.set(cacheKey, { createdAt: Date.now(), data });
  return data;
}

async function getSubmissionFile(fileName) {
  const cacheKey = `file:${fileName}`;
  const cached = submissionsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const response = await fetch(`https://data.sec.gov/submissions/${fileName}`, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br"
    }
  });

  if (!response.ok) {
    throw new Error(`SEC submissions file returned ${response.status} for ${fileName}`);
  }

  const data = await response.json();
  submissionsCache.set(cacheKey, { createdAt: Date.now(), data });
  return data;
}

async function getTickerMap() {
  if (tickerMapCache && Date.now() - tickerMapCache.createdAt < TICKER_CACHE_TTL_MS) {
    return tickerMapCache.map;
  }

  const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`SEC ticker lookup returned ${response.status}`);
  }

  const payload = await response.json();
  const map = new Map();
  for (const row of Object.values(payload)) {
    const ticker = normalizeTicker(row.ticker);
    if (!ticker) continue;
    const cik = String(row.cik_str).padStart(10, "0");
    const builtIn = companies.find((company) => company.cik === cik || company.ticker === ticker);
    const company = {
      ticker,
      cik,
      name: row.title,
      nameZh: builtIn?.nameZh || row.title
    };
    map.set(ticker, company);
    resolvedCompanies.set(cik, company);
  }

  tickerMapCache = { createdAt: Date.now(), map };
  return map;
}

async function resolveCompanyByTicker(rawTicker) {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) {
    throw new Error("请输入有效的美股 ticker");
  }
  const builtIn = companies.find((company) => company.ticker === ticker);
  if (builtIn) return builtIn;

  const tickerMap = await getTickerMap();
  const company = tickerMap.get(ticker);
  if (!company) {
    throw new Error(`没有在 SEC ticker 列表中找到 ${ticker}`);
  }
  resolvedCompanies.set(company.cik, company);
  return company;
}

async function resolveCompanyByCik(cik) {
  if (!/^\d{10}$/.test(String(cik || ""))) return null;
  const cached = resolvedCompanies.get(cik);
  if (cached && !String(cached.ticker || "").startsWith("CIK")) return cached;

  try {
    const tickerMap = await getTickerMap();
    const mapped = [...tickerMap.values()].find((company) => company.cik === cik);
    if (mapped) {
      resolvedCompanies.set(cik, mapped);
      return mapped;
    }
  } catch {
    if (cached) return cached;
  }

  const facts = await getCompanyFacts(cik);
  const company = {
    ticker: facts?.tickers?.[0] || `CIK${cik}`,
    cik,
    name: facts?.entityName || `CIK ${cik}`,
    nameZh: facts?.entityName || `CIK ${cik}`
  };
  resolvedCompanies.set(cik, company);
  return company;
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
}

function getUsGaapFacts(companyFacts, tag, preferredUnit) {
  const fact = companyFacts?.facts?.["us-gaap"]?.[tag];
  if (!fact?.units) return [];
  const preferred = fact.units[preferredUnit];
  if (preferred) return preferred.map((item) => ({ ...item, unit: preferredUnit, tag, label: fact.label }));
  const firstUnit = Object.keys(fact.units)[0];
  if (!firstUnit) return [];
  return fact.units[firstUnit].map((item) => ({ ...item, unit: firstUnit, tag, label: fact.label }));
}

function pickFact(companyFacts, item, year, period) {
  const forms = period === "FY" ? ["10-K", "10-K/A"] : ["10-Q", "10-Q/A"];
  const candidates = item.tags.flatMap((tag) => getUsGaapFacts(companyFacts, tag, item.unit));
  const matching = candidates
    .filter((fact) => Number(fact.fy) === Number(year))
    .filter((fact) => String(fact.fp || "").toUpperCase() === period)
    .filter((fact) => forms.includes(fact.form))
    .filter((fact) => typeof fact.val === "number")
    .sort((a, b) => {
      const endDiff = String(b.end || "").localeCompare(String(a.end || ""));
      if (endDiff !== 0) return endDiff;
      const durationDiff = durationDistance(a, period) - durationDistance(b, period);
      if (durationDiff !== 0) return durationDiff;
      const filedDiff = String(b.filed || "").localeCompare(String(a.filed || ""));
      if (filedDiff !== 0) return filedDiff;
      return String(b.accn || "").localeCompare(String(a.accn || ""));
    });

  const selected = matching[0];
  if (!selected) {
    return {
      key: item.key,
      zh: item.zh,
      en: item.en,
      value: null,
      unit: item.unit,
      tag: item.tags[0],
      status: "missing"
    };
  }

  return {
    key: item.key,
    zh: item.zh,
    en: item.en,
    value: selected.val,
    unit: selected.unit,
    tag: selected.tag,
    xbrlLabel: selected.label,
    start: selected.start,
    end: selected.end,
    filed: selected.filed,
    form: selected.form,
    frame: selected.frame,
    accn: selected.accn,
    status: "ok"
  };
}

function listPeriods(companyFacts) {
  const periodSourceTags = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "NetIncomeLoss",
    "GrossProfit",
    "OperatingIncomeLoss"
  ];
  const periods = new Map();

  for (const tag of periodSourceTags) {
    for (const fact of getUsGaapFacts(companyFacts, tag, "USD")) {
      const fp = String(fact.fp || "").toUpperCase();
      if (!fact.fy || !["FY", "Q1", "Q2", "Q3"].includes(fp)) continue;
      if (!["10-K", "10-K/A", "10-Q", "10-Q/A"].includes(fact.form)) continue;
      if (!fact.start || !fact.end) continue;
      const key = `${fact.fy}-${fp}`;
      const existing = periods.get(key);
      if (
        !existing ||
        String(fact.end || "") > String(existing.end || "") ||
        (String(fact.end || "") === String(existing.end || "") &&
          durationDistance(fact, fp) < durationDistance(existing, fp)) ||
        (String(fact.end || "") === String(existing.end || "") &&
          durationDistance(fact, fp) === durationDistance(existing, fp) &&
          String(fact.filed || "") > String(existing.filed || ""))
      ) {
        periods.set(key, {
          year: Number(fact.fy),
          period: fp,
          filed: fact.filed,
          start: fact.start,
          end: fact.end
        });
      }
    }
  }

  const result = addImplicitQ4Ranges([...periods.values()]);
  return result.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    const rank = { FY: 4, Q3: 3, Q2: 2, Q1: 1 };
    return rank[b.period] - rank[a.period];
  });
}

function addImplicitQ4Ranges(periods) {
  for (const fiscalYear of periods.filter((item) => item.period === "FY")) {
    const q3 = periods.find((item) => item.year === fiscalYear.year && item.period === "Q3");
    const q4Start = addDays(q3?.end, 1);
    if (!q4Start || !fiscalYear.end || q4Start > fiscalYear.end) continue;
    fiscalYear.q4Start = q4Start;
    fiscalYear.q4End = fiscalYear.end;
  }
  return periods;
}

function buildReport(company, companyFacts, year, period) {
  const statements = statementConfig.map((statement) => ({
    key: statement.key,
    title: statement.title,
    titleEn: statement.titleEn,
    rows: statement.items.map((item) => pickFact(companyFacts, item, year, period))
  }));

  const metrics = Object.fromEntries(
    statements.flatMap((statement) => statement.rows.map((row) => [row.key, row.value]))
  );

  const derived = {
    grossMargin: ratio(metrics.grossProfit, metrics.revenue),
    operatingMargin: ratio(metrics.operatingIncome, metrics.revenue),
    netMargin: ratio(metrics.netIncome, metrics.revenue),
    debtRatio: ratio(metrics.liabilities, metrics.assets),
    freeCashFlow:
      typeof metrics.operatingCashFlow === "number" && typeof metrics.capex === "number"
        ? metrics.operatingCashFlow - Math.abs(metrics.capex)
        : null
  };

  const analysis = buildAnalysis(metrics, derived, company, year, period);
  const periodRange = getReportPeriodRange(statements, period);
  const q4Range =
    period === "FY"
      ? listPeriods(companyFacts).find((item) => item.year === Number(year) && item.period === "FY")
      : null;

  return {
    company,
    requested: {
      year: Number(year),
      period,
      start: periodRange.start,
      end: periodRange.end,
      q4Start: q4Range?.q4Start || null,
      q4End: q4Range?.q4End || null
    },
    source: {
      provider: "SEC EDGAR Company Facts API",
      cik: company.cik,
      note: "数据来自 SEC XBRL facts。不同公司披露口径可能导致部分项目缺失。"
    },
    statements,
    derived,
    analysis
  };
}

function getReportPeriodRange(statements, period) {
  const rows = statements.flatMap((statement) => statement.rows);
  const preferredKeys = ["revenue", "netIncome", "grossProfit", "operatingIncome", "operatingCashFlow"];
  for (const key of preferredKeys) {
    const row = rows.find((item) => item.key === key && item.start && item.end);
    if (row && durationDistance(row, period) <= (period === "FY" ? 45 : 35)) {
      return { start: row.start, end: row.end };
    }
  }
  const fallback = rows.find((item) => item.start && item.end);
  return { start: fallback?.start || null, end: fallback?.end || null };
}

async function attachFilingLink(report) {
  const accn = getDominantAccession(report);
  if (!accn) return report;

  const filing = await findFilingMetadata(report.company.cik, accn);
  const cikNoLeadingZeros = String(Number(report.company.cik));
  const accessionPath = accn.replaceAll("-", "");
  const archiveDirectory = `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionPath}`;
  const primaryDocumentUrl = filing?.primaryDocument
    ? `${archiveDirectory}/${filing.primaryDocument}`
    : `${archiveDirectory}/`;

  report.source.filing = {
    accessionNumber: accn,
    form: filing?.form || (report.requested.period === "FY" ? "10-K" : "10-Q"),
    filingDate: filing?.filingDate || null,
    reportDate: filing?.reportDate || null,
    primaryDocument: filing?.primaryDocument || null,
    url: primaryDocumentUrl,
    archiveDirectory
  };
  return report;
}

function getDominantAccession(report) {
  const counts = new Map();
  for (const row of report.statements.flatMap((statement) => statement.rows)) {
    if (!row.accn) continue;
    counts.set(row.accn, (counts.get(row.accn) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

async function findFilingMetadata(cik, accn) {
  const submissions = await getCompanySubmissions(cik);
  const recent = findFilingInRecent(submissions?.filings?.recent, accn);
  if (recent) return recent;

  for (const file of submissions?.filings?.files || []) {
    const data = await getSubmissionFile(file.name);
    const match = findFilingInRecent(data, accn);
    if (match) return match;
  }
  return null;
}

function findFilingInRecent(recent, accn) {
  if (!recent?.accessionNumber) return null;
  const index = recent.accessionNumber.findIndex((item) => item === accn);
  if (index < 0) return null;
  return {
    accessionNumber: recent.accessionNumber[index],
    form: recent.form?.[index] || null,
    filingDate: recent.filingDate?.[index] || null,
    reportDate: recent.reportDate?.[index] || null,
    primaryDocument: recent.primaryDocument?.[index] || null,
    primaryDocDescription: recent.primaryDocDescription?.[index] || null
  };
}

function buildComparison(company, companyFacts, options) {
  const metric = compareMetricConfig[options.metric] ? options.metric : "revenue";
  const mode = options.mode === "quarterly" ? "quarterly" : "annual";
  const limit = Math.min(Math.max(Number(options.limit) || 8, 2), 12);
  const periods = listPeriods(companyFacts)
    .filter((item) => (mode === "annual" ? item.period === "FY" : item.period !== "FY"))
    .slice(0, limit)
    .reverse();

  const points = periods.map((item) => {
    const report = buildReport(company, companyFacts, item.year, item.period);
    const value = getReportMetric(report, metric);
    return {
      year: item.year,
      period: item.period,
      label: `${item.year} ${item.period}`,
      start: item.start,
      end: item.end,
      filed: item.filed,
      value
    };
  });

  return {
    company,
    metric,
    metricLabel: compareMetricConfig[metric].label,
    unit: compareMetricConfig[metric].unit,
    mode,
    points
  };
}

function getReportMetric(report, metric) {
  if (compareMetricConfig[metric]?.source === "derived") {
    return report.derived[metric] ?? null;
  }
  const rows = report.statements.flatMap((statement) => statement.rows);
  return rows.find((row) => row.key === metric)?.value ?? null;
}

function ratio(numerator, denominator) {
  if (typeof numerator !== "number" || typeof denominator !== "number" || denominator === 0) return null;
  return numerator / denominator;
}

function durationDistance(fact, period) {
  if (!fact.start || !fact.end) return Number.MAX_SAFE_INTEGER;
  const start = Date.parse(fact.start);
  const end = Date.parse(fact.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.MAX_SAFE_INTEGER;
  const days = Math.round((end - start) / 86400000) + 1;
  const expected = period === "FY" ? 365 : 91;
  return Math.abs(days - expected);
}

function addDays(value, days) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildAnalysis(metrics, derived, company, year, period) {
  const highlights = [];
  const warnings = [];

  if (typeof metrics.revenue === "number") {
    highlights.push(`${company.nameZh} ${year} ${period} 营业收入为 ${formatMoney(metrics.revenue)}。`);
  }
  if (typeof metrics.netIncome === "number") {
    highlights.push(`净利润为 ${formatMoney(metrics.netIncome)}，净利率约 ${formatPercent(derived.netMargin)}。`);
    if (metrics.netIncome < 0) warnings.push("该期间净利润为负，需要进一步查看亏损原因和一次性项目。");
  }
  if (typeof derived.grossMargin === "number") {
    highlights.push(`毛利率约 ${formatPercent(derived.grossMargin)}，可作为观察产品/服务盈利能力的核心指标。`);
  }
  if (typeof derived.freeCashFlow === "number") {
    highlights.push(`估算自由现金流为 ${formatMoney(derived.freeCashFlow)}。`);
    if (derived.freeCashFlow < 0) warnings.push("自由现金流为负，说明经营现金流不足以覆盖资本开支或扩张投入较大。");
  }
  if (typeof derived.debtRatio === "number") {
    highlights.push(`总负债/总资产约 ${formatPercent(derived.debtRatio)}。`);
    if (derived.debtRatio > 0.7) warnings.push("负债率偏高，建议继续查看债务期限、利息费用和现金覆盖能力。");
  }

  const missing = Object.entries(metrics)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (missing.length > 6) {
    warnings.push("本期有较多关键项目未能从标准 XBRL tag 中匹配，建议对照 SEC 原始 filing。");
  }

  if (!highlights.length) {
    warnings.push("没有找到足够的结构化财务数据，可能是该公司该期间未披露或披露标签不在第一版映射范围内。");
  }

  return {
    summary:
      highlights.length > 0
        ? "这是一份基于 SEC 标准化 XBRL 数据生成的快速解读，适合做财报初筛，不替代完整研读 10-K/10-Q。"
        : "当前数据不足，无法生成完整解读。",
    highlights,
    warnings
  };
}

function formatMoney(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} 万亿美元`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} 十亿美元`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} 百万美元`;
  return `${sign}${abs.toLocaleString("en-US")} 美元`;
}

function formatPercent(value) {
  if (typeof value !== "number") return "暂无数据";
  return `${(value * 100).toFixed(1)}%`;
}

async function handleApi(req, res, pathname, searchParams) {
  if (pathname === "/api/companies") {
    sendJson(res, 200, { companies });
    return;
  }

  if (pathname === "/api/company") {
    try {
      const company = await resolveCompanyByTicker(searchParams.get("ticker"));
      sendJson(res, 200, { company });
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/periods") {
    const cik = searchParams.get("cik");
    try {
      const company = await resolveCompanyByCik(cik);
      if (!company) {
        sendJson(res, 400, { error: "Unsupported company CIK" });
        return;
      }
      const facts = await getCompanyFacts(cik);
      sendJson(res, 200, { company, periods: listPeriods(facts) });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/report") {
    const cik = searchParams.get("cik");
    const year = Number(searchParams.get("year"));
    const period = String(searchParams.get("period") || "").toUpperCase();

    try {
      const company = await resolveCompanyByCik(cik);
      if (!company || !Number.isInteger(year) || !["FY", "Q1", "Q2", "Q3"].includes(period)) {
        sendJson(res, 400, { error: "Invalid report query" });
        return;
      }
      const facts = await getCompanyFacts(cik);
      const report = await attachFilingLink(buildReport(company, facts, year, period));
      sendJson(res, 200, report);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/compare") {
    const cik = searchParams.get("cik");
    const metric = searchParams.get("metric") || "revenue";
    const mode = searchParams.get("mode") || "annual";
    const limit = Number(searchParams.get("limit") || 8);

    try {
      const company = await resolveCompanyByCik(cik);
      if (!company) {
        sendJson(res, 400, { error: "Invalid comparison query" });
        return;
      }
      const facts = await getCompanyFacts(cik);
      sendJson(res, 200, buildComparison(company, facts, { metric, mode, limit }));
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  notFound(res);
}

async function serveStatic(req, res, pathname) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = contentType(extname(filePath));
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    notFound(res);
  }
}

function contentType(ext) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream"
  );
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname, url.searchParams);
    return;
  }
  await serveStatic(req, res, url.pathname);
}

export default requestHandler;

if (!process.env.VERCEL) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(`Financial statements viewer running at http://localhost:${PORT}`);
  });
}
