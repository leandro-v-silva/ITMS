/* ITSM BI report — D3.js visualizations.
   Loads the JSON aggregates produced by etl/pipeline.py and renders the report.
   Bilingual (EN/PT): strings come from i18n.js via t(); charts re-render on toggle. */
(async function () {
  "use strict";

  const LS_KEY = "report-lang";
  const state = { lang: localStorage.getItem(LS_KEY) === "pt" ? "pt" : "en" };
  const t = (key) => (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;

  const COLORS = {
    opened: "#2563eb",
    resolved: "#16a34a",
    median: "#2563eb",
    p90: "#f59e0b",
    donut: ["#2563eb", "#7c3aed", "#0891b2", "#f59e0b", "#dc2626", "#64748b", "#16a34a", "#db2777"],
    bar: "#2563eb",
    barAlt: "#93c5fd",
  };

  const fmtInt = (n) => Number(n).toLocaleString(state.lang === "pt" ? "pt-BR" : "en-US");
  const fmt1 = d3.format(".1f");
  const tooltip = d3.select("#tooltip");

  function showTooltip(event, html) {
    tooltip.html(html).style("opacity", 1)
      .style("left", event.pageX + 14 + "px")
      .style("top", event.pageY - 10 + "px");
  }
  function hideTooltip() { tooltip.style("opacity", 0); }

  function showError(err) {
    console.error(err);
    const banner = document.getElementById("error-banner");
    banner.textContent = t("ui.error_prefix") + err;
    banner.style.display = "block";
    document.getElementById("loading").style.display = "none";
  }

  function applyStaticText() {
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.documentElement.lang = state.lang === "pt" ? "pt-BR" : "en";
    document.querySelectorAll("#lang-switch button").forEach((b) =>
      b.classList.toggle("active", b.dataset.lang === state.lang));
  }

  // ---------- Load all datasets ----------
  let data;
  try {
    const names = ["kpi", "monthly", "priority", "category", "ci_cat", "ci_subcat", "closure", "resolution_by_priority", "itil", "meta"];
    const files = await Promise.all(names.map((n) => d3.json(`data/${n}.json`)));
    data = Object.fromEntries(names.map((n, i) => [n, files[i]]));
  } catch (err) { showError(err); return; }

  document.getElementById("loading").style.display = "none";

  function renderGenerated() {
    const generated = new Date(data.meta.generated_at_utc);
    const locale = state.lang === "pt" ? "pt-BR" : "en-US";
    document.getElementById("generated-at").textContent =
      t("header.generated") + " " + generated.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  }

  // ---------- KPI strip ----------
  function renderKpis() {
    const k = data.kpi;
    const closedPct = (k.closed / k.total_incidents) * 100;
    const cards = [
      { label: t("kpi.total.label"), value: fmtInt(k.total_incidents),
        note: t("kpi.total.note").replace("{min}", k.date_range.min).replace("{max}", k.date_range.max) },
      { label: t("kpi.closed.label"), value: fmt1(closedPct) + "%",
        note: t("kpi.closed.note").replace("{x}", fmtInt(k.work_in_progress)) },
      { label: t("kpi.reopen.label"), value: fmt1(k.reopen_rate_pct) + "%",
        note: t("kpi.reopen.note").replace("{x}", fmtInt(k.reopened)) },
      { label: t("kpi.median.label"), value: fmt1(k.median_resolution_days) + " d",
        note: t("kpi.median.note").replace("{x}", fmt1(k.p90_resolution_days)) },
      { label: t("kpi.reassign.label"), value: fmt1(k.avg_reassignments), note: t("kpi.reassign.note") },
      { label: t("kpi.sla.label"), value: fmt1(k.within_sla_pct) + "%", note: t("kpi.sla.note"), cls: "good" },
    ];
    d3.select("#kpis").selectAll(".kpi").data(cards).join("div").attr("class", "kpi").html((d) =>
      `<div class="label">${d.label}</div>
       <div class="value ${d.cls || ""}">${d.value}</div>
       <div class="note">${d.note}</div>`);
  }

  // ---------- Monthly volume: multi-line chart ----------
  function renderMonthly() {
    const el = "#chart-monthly";
    const W = 1080, H = 340, m = { top: 16, right: 30, bottom: 40, left: 56 };
    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", t("charts.volume.title"));

    const rows = data.monthly;
    const x = d3.scalePoint().domain(rows.map((d) => d.month)).range([m.left, W - m.right]).padding(0.4);
    const y = d3.scaleLinear()
      .domain([0, d3.max(rows, (d) => Math.max(d.opened, d.resolved)) * 1.08])
      .nice().range([H - m.bottom, m.top]);

    svg.append("g").attr("class", "grid-lines")
      .selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", m.left).attr("x2", W - m.right)
      .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % 3 === 0)));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(fmtInt));

    const area = d3.area().x((d) => x(d.month)).y0(y(0)).y1((d) => y(d.opened)).curve(d3.curveMonotoneX);
    svg.append("path").datum(rows).attr("d", area)
      .attr("fill", COLORS.opened).attr("opacity", 0.10);

    const lineOpened = d3.line().x((d) => x(d.month)).y((d) => y(d.opened)).curve(d3.curveMonotoneX);
    const lineResolved = d3.line().x((d) => x(d.month)).y((d) => y(d.resolved)).curve(d3.curveMonotoneX);
    svg.append("path").datum(rows).attr("d", lineOpened).attr("fill", "none")
      .attr("stroke", COLORS.opened).attr("stroke-width", 2.5);
    svg.append("path").datum(rows).attr("d", lineResolved).attr("fill", "none")
      .attr("stroke", COLORS.resolved).attr("stroke-width", 2.5);

    const focus = svg.append("g").style("display", "none");
    focus.append("circle").attr("r", 5).attr("fill", COLORS.opened);
    focus.append("circle").attr("r", 5).attr("fill", COLORS.resolved);

    svg.append("rect").attr("x", m.left).attr("width", W - m.left - m.right)
      .attr("y", m.top).attr("height", H - m.top - m.bottom)
      .attr("fill", "transparent")
      .on("mousemove", function (event) {
        const [mx] = d3.pointer(event, svg.node());
        const step = x.step();
        const i = Math.max(0, Math.min(rows.length - 1, Math.round((mx - x.range()[0]) / step)));
        const d = rows[i];
        focus.style("display", null)
          .selectAll("circle")
          .data([y(d.opened), y(d.resolved)])
          .join("circle")
          .attr("cx", x(d.month)).attr("cy", (dd) => dd);
        showTooltip(event,
          `<strong>${d.month}${d.partial ? " " + t("tooltip.partial") : ""}</strong><br>` +
          `${t("tooltip.opened")} ${fmtInt(d.opened)}<br>${t("tooltip.resolved")} ${fmtInt(d.resolved)}`);
      })
      .on("mouseleave", () => { focus.style("display", "none"); hideTooltip(); });

    const legend = svg.append("g").attr("class", "legend")
      .attr("transform", `translate(${W - m.right - 190}, ${m.top})`);
    [[t("legend.opened"), COLORS.opened], [t("legend.resolved"), COLORS.resolved]].forEach(([label, color], i) => {
      const g = legend.append("g").attr("transform", `translate(${i * 96},0)`);
      g.append("rect").attr("width", 14).attr("height", 4).attr("y", -3).attr("fill", color).attr("rx", 2);
      g.append("text").attr("x", 20).text(label);
    });
  }

  // ---------- Donut charts ----------
  function renderDonut(el, rows, labelFn, heading) {
    const W = 720, H = 330, R = Math.min(W, H) / 2 - 40;
    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", heading);
    const g = svg.append("g").attr("transform", `translate(${W / 2 - 90}, ${H / 2})`);

    const total = d3.sum(rows, (d) => d.count);
    const pie = d3.pie().value((d) => d.count).sort(null).padAngle(0.02);
    const arc = d3.arc().innerRadius(R * 0.55).outerRadius(R).cornerRadius(3);
    const color = d3.scaleOrdinal().domain(rows.map(labelFn)).range(COLORS.donut);

    g.selectAll("path").data(pie(rows)).join("path")
      .attr("d", arc).attr("fill", (d) => color(labelFn(d.data)))
      .attr("stroke", "#fff").attr("stroke-width", 1.5)
      .on("mousemove", (event, d) => showTooltip(event,
        `<strong>${labelFn(d.data)}</strong><br>${fmtInt(d.data.count)} · ${fmt1((d.data.count / total) * 100)}%`))
      .on("mouseleave", hideTooltip);

    g.append("text").attr("text-anchor", "middle").attr("dy", "-0.1em")
      .attr("font-size", "26px").attr("font-weight", 700).attr("fill", "#0f172a")
      .text(fmtInt(total));
    g.append("text").attr("text-anchor", "middle").attr("dy", "1.3em")
      .attr("font-size", "12px").attr("fill", "#64748b").text(t("tooltip.tickets"));

    const legend = svg.append("g").attr("class", "legend")
      .attr("transform", `translate(${W - 240}, ${H / 2 - rows.length * 11})`);
    rows.forEach((d, i) => {
      const item = legend.append("g").attr("transform", `translate(0, ${i * 22})`);
      item.append("rect").attr("width", 12).attr("height", 12).attr("rx", 3).attr("fill", color(labelFn(d)));
      item.append("text").attr("x", 18).attr("y", 10)
        .text(`${labelFn(d)} — ${fmt1((d.count / total) * 100)}%`);
    });
  }

  // ---------- Vertical bar chart (CI category) ----------
  function renderCiCat() {
    const el = "#chart-ci-cat";
    const W = 720, H = 330, m = { top: 16, right: 16, bottom: 66, left: 52 };
    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", t("charts.ci_cat.title"));
    const rows = data.ci_cat;

    const x = d3.scaleBand().domain(rows.map((d) => d.ci_cat)).range([m.left, W - m.right]).padding(0.25);
    const y = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.count)]).nice().range([H - m.bottom, m.top]);

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).tickSize(0))
      .selectAll("text").attr("transform", "rotate(-28)").style("text-anchor", "end").attr("dy", "0.35em");
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(fmtInt));

    svg.selectAll("rect.bar").data(rows).join("rect").attr("class", "bar")
      .attr("x", (d) => x(d.ci_cat)).attr("width", x.bandwidth())
      .attr("y", (d) => y(d.count)).attr("height", (d) => y(0) - y(d.count))
      .attr("fill", COLORS.bar).attr("rx", 4)
      .on("mousemove", (event, d) => showTooltip(event,
        `<strong>${d.ci_cat}</strong><br>${fmtInt(d.count)} ${t("tooltip.tickets")}`))
      .on("mouseleave", hideTooltip);
  }

  // ---------- Horizontal bar chart (shared) ----------
  function renderHBar(el, rows, labelKey, heading) {
    const W = 720, H = 330, m = { top: 10, right: 60, bottom: 24, left: 190 };
    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", heading);

    const y = d3.scaleBand().domain(rows.map((d) => d[labelKey])).range([m.top, H - m.bottom]).padding(0.2);
    const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.count)]).nice().range([m.left, W - m.right]);

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(fmtInt));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).tickSize(0));

    svg.selectAll("rect").data(rows).join("rect")
      .attr("y", (d) => y(d[labelKey])).attr("height", y.bandwidth())
      .attr("x", m.left).attr("width", (d) => x(d.count) - m.left)
      .attr("fill", COLORS.bar).attr("rx", 4)
      .on("mousemove", (event, d) => showTooltip(event,
        `<strong>${d[labelKey]}</strong><br>${fmtInt(d.count)} ${t("tooltip.tickets")}`))
      .on("mouseleave", hideTooltip);

    svg.selectAll("text.value").data(rows).join("text").attr("class", "value")
      .attr("x", (d) => x(d.count) + 6).attr("y", (d) => y(d[labelKey]) + y.bandwidth() / 2 + 4)
      .attr("font-size", 11).attr("fill", "#64748b").text((d) => fmtInt(d.count));
  }

  // ---------- Grouped bars: resolution time by priority ----------
  function renderResolution() {
    const el = "#chart-resolution";
    const W = 1080, H = 340, m = { top: 16, right: 30, bottom: 46, left: 52 };
    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", t("charts.resolution.title"));
    const rows = data.resolution_by_priority;

    const x0 = d3.scaleBand().domain(rows.map((d) => d.Priority_Label)).range([m.left, W - m.right]).padding(0.25);
    const x1 = d3.scaleBand().domain(["median", "p90"]).range([0, x0.bandwidth()]).padding(0.15);
    const y = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.p90) * 1.1]).nice().range([H - m.bottom, m.top]);

    svg.append("g").attr("class", "grid-lines")
      .selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", m.left).attr("x2", W - m.right).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x0).tickSize(0));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => d + " " + t("axis.days")));

    const groups = svg.selectAll("g.group").data(rows).join("g").attr("class", "group")
      .attr("transform", (d) => `translate(${x0(d.Priority_Label)},0)`);

    [["median", t("legend.median"), COLORS.median], ["p90", t("legend.p90"), COLORS.p90]].forEach(([key, name, color]) => {
      groups.append("rect")
        .attr("x", x1(key)).attr("width", x1.bandwidth())
        .attr("y", (d) => y(d[key])).attr("height", (d) => y(0) - y(d[key]))
        .attr("fill", color).attr("rx", 4)
        .on("mousemove", (event, d) => showTooltip(event,
          `<strong>${d.Priority_Label}</strong> · ${name}<br>${fmt1(d[key])} ${t("tooltip.days")} (n=${fmtInt(d.n)})`))
        .on("mouseleave", hideTooltip);
    });

    const legend = svg.append("g").attr("class", "legend")
      .attr("transform", `translate(${W - m.right - 210}, ${m.top})`);
    [[t("legend.median"), COLORS.median], [t("legend.p90"), COLORS.p90]].forEach(([label, color], i) => {
      const g = legend.append("g").attr("transform", `translate(${i * 118},0)`);
      g.append("rect").attr("width", 14).attr("height", 10).attr("y", -8).attr("fill", color).attr("rx", 2);
      g.append("text").attr("x", 20).text(label);
    });
  }

  // ---------- ITIL metric cards ----------
  function renderItilCards() {
    const it = data.itil;
    const cards = [
      { label: t("itil.mttr.label"), value: fmt1(it.mttr_hours_avg) + " h",
        note: t("itil.mttr.note").replace("{x}", fmt1(it.mttr_hours_median)) },
      { label: t("itil.mtbf.label"), value: fmt1(it.mtbf_days_avg) + " d",
        note: t("itil.mtbf.note").replace("{x}", fmtInt(it.mtbf_ci_count)) },
      { label: t("itil.fcr.label"), value: fmt1(it.fcr_pct) + "%", note: t("itil.fcr.note") },
      { label: t("itil.escalation.label"), value: fmt1(it.escalation_pct) + "%", note: t("itil.escalation.note") },
      { label: t("itil.sla.label"), value: fmt1(it.sla_compliance_pct) + "%",
        note: t("itil.sla.note"), cls: "good" },
      { label: t("itil.reopen.label"), value: fmt1(it.reopen_rate_pct) + "%", note: t("itil.reopen.note") },
      { label: t("itil.major.label"), value: fmtInt(it.major_incidents.count),
        note: t("itil.major.note").replace("{x}", fmt1(it.major_incidents.pct)) },
      { label: t("itil.backlog.label"), value: fmtInt(it.backlog_open), note: t("itil.backlog.note") },
    ];
    d3.select("#itil-cards").selectAll(".kpi").data(cards).join("div").attr("class", "kpi").html((d) =>
      `<div class="label">${d.label}</div>
       <div class="value ${d.cls || ""}">${d.value}</div>
       <div class="note">${d.note}</div>`);
  }

  // ---------- MTTR trend ----------
  function renderMttrTrend() {
    const el = "#chart-mttr-trend";
    const W = 1080, H = 300, m = { top: 16, right: 30, bottom: 40, left: 52 };
    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", t("charts.mttr.title"));
    const rows = data.itil.monthly_mttr;

    const x = d3.scalePoint().domain(rows.map((d) => d.month)).range([m.left, W - m.right]).padding(0.4);
    const y = d3.scaleLinear()
      .domain([0, d3.max(rows, (d) => Math.max(d.median_days, d.mean_days)) * 1.15])
      .nice().range([H - m.bottom, m.top]);

    svg.append("g").attr("class", "grid-lines")
      .selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", m.left).attr("x2", W - m.right)
      .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => d + " " + t("axis.days")));

    const line = (key) => d3.line().x((d) => x(d.month)).y((d) => y(d[key])).curve(d3.curveMonotoneX);
    svg.append("path").datum(rows).attr("d", line("median")).attr("fill", "none")
      .attr("stroke", COLORS.median).attr("stroke-width", 2.5);
    svg.append("path").datum(rows).attr("d", line("mean_days")).attr("fill", "none")
      .attr("stroke", COLORS.p90).attr("stroke-width", 2).attr("stroke-dasharray", "6 4");

    svg.selectAll("circle.median").data(rows).join("circle").attr("class", "median")
      .attr("cx", (d) => x(d.month)).attr("cy", (d) => y(d.median_days))
      .attr("r", 4).attr("fill", COLORS.median)
      .on("mousemove", (event, d) => showTooltip(event,
        `<strong>${d.month}</strong><br>${t("tooltip.median")} ${fmt1(d.median_days)} ${t("axis.days")}<br>` +
        `${t("tooltip.mean")} ${fmt1(d.mean_days)} ${t("axis.days")}<br>${t("tooltip.resolved")} ${fmtInt(d.resolved)}`))
      .on("mouseleave", hideTooltip);

    const legend = svg.append("g").attr("class", "legend")
      .attr("transform", `translate(${W - m.right - 200}, ${m.top})`);
    [[t("legend.median"), COLORS.median, null], [t("legend.mean"), COLORS.p90, "6 4"]].forEach(([label, color, dash], i) => {
      const g = legend.append("g").attr("transform", `translate(${i * 88},0)`);
      g.append("line").attr("x1", 0).attr("x2", 16).attr("stroke", color)
        .attr("stroke-width", 2.5).attr("stroke-dasharray", dash || "none");
      g.append("text").attr("x", 22).text(label);
    });
  }

  // ---------- Render orchestration ----------
  const CHART_SLOTS = [
    "#chart-monthly", "#chart-priority", "#chart-category", "#chart-ci-cat",
    "#chart-ci-subcat", "#chart-closure", "#chart-resolution", "#chart-mttr-trend",
  ];

  function renderAll() {
    applyStaticText();
    renderGenerated();
    d3.select("#kpis").selectAll("*").remove();
    d3.select("#itil-cards").selectAll("*").remove();
    CHART_SLOTS.forEach((id) => d3.select(id).selectAll("*").remove());
    hideTooltip();
    renderKpis();
    renderItilCards();
    renderMonthly();
    renderDonut("#chart-priority", data.priority, (d) => d.priority, t("charts.priority.title"));
    renderDonut("#chart-category", data.category, (d) => d.category, t("charts.category.title"));
    renderCiCat();
    renderHBar("#chart-ci-subcat", data.ci_subcat, "ci_subcat", t("charts.subcat.title"));
    renderHBar("#chart-closure", data.closure, "closure_code", t("charts.closure.title"));
    renderResolution();
    renderMttrTrend();
  }

  document.querySelectorAll("#lang-switch button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.lang === state.lang) return;
      state.lang = btn.dataset.lang;
      localStorage.setItem(LS_KEY, state.lang);
      renderAll();
    });
  });

  renderAll();
})();
