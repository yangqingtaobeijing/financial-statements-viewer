# 美股财报工作台

一个本地运行的美股财报查看网站。前端用于选择公司、财年和季度，后端代理 SEC EDGAR Company Facts API 并整理常用财报项目。

## 启动

```bash
npm start
```

然后打开：

```text
http://localhost:3000
```

建议配置 SEC 访问标识：

```bash
SEC_USER_AGENT="YourApp/0.1 your-email@example.com" npm start
```

## 功能

- 内置 NVDA、TSLA、AAPL、MSFT、AMZN、GOOGL、META。
- 支持输入美股 ticker 查询 SEC ticker-CIK 映射并加载公司。
- 支持 FY、Q1、Q2、Q3。
- 标注每家公司 FY/Q1/Q2/Q3 的实际财报覆盖日期。
- FY 年报会额外标注隐含 Q4 覆盖期，因为 Q4 通常包含在 10-K 中。
- 展示利润表、资产负债表、现金流量表常用科目。
- 中英对照展示财务科目和 XBRL tag。
- 支持从当前报表直接跳转到 SEC 原始 10-K/10-Q filing。
- 支持年度/季度数据对比，并用柱状图展示趋势。
- 基于规则生成财报摘要、利润率、现金流和负债提醒。

## 数据说明

数据来自 SEC EDGAR Company Facts API。第一版抽取标准 US-GAAP XBRL facts，不等同于完整原始 10-K/10-Q。不同公司披露口径不同，部分项目可能显示缺失。
