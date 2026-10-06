"""Transform stage: clean the raw ITSM extract and build report aggregates.

Data quirks handled here (verified by exploration):
- Timestamps come in TWO day-first formats: "D/M/YYYY H:MM" and "DD-MM-YYYY H:MM"
  -> parsed with format="mixed", dayfirst=True (gives 0 negative durations).
- Priority/Impact/Urgency run 1-5 (5 = very low); "NS" marks unknown impact.
- "Handle_Time_hrs" uses an unreliably formatted digit-grouping scheme, so
  resolution time is recomputed from Open_Time / Resolved_Time instead.
- SLA targets are a documented assumption: P1<=1d, P2<=3d, P3<=7d, P4/P5<=14d.
"""
from pathlib import Path

import pandas as pd

DATE_COLUMNS = ["Open_Time", "Reopen_Time", "Resolved_Time", "Close_Time"]

PRIORITY_LABELS = {
    1: "P1 · Critical",
    2: "P2 · High",
    3: "P3 · Medium",
    4: "P4 · Low",
    5: "P5 · Very low",
}

# Documented assumption — targets in calendar days per priority.
SLA_TARGETS_DAYS = {1: 1, 2: 3, 3: 7, 4: 14, 5: 14}

TOP_N_SUBCAT = 10


def load_raw(raw_path: Path) -> pd.DataFrame:
    return pd.read_csv(raw_path, dtype=str)


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    for col in DATE_COLUMNS:
        df[col] = pd.to_datetime(df[col], format="mixed", dayfirst=True, errors="coerce")

    priority = pd.to_numeric(df["Priority"], errors="coerce")
    df["Priority_Level"] = priority
    df["Priority_Label"] = priority.map(PRIORITY_LABELS).fillna("Unknown")

    df["No_of_Reassignments"] = pd.to_numeric(df["No_of_Reassignments"], errors="coerce")

    for col in ["Status", "Category", "CI_Cat", "CI_Subcat", "Closure_Code"]:
        df[col] = df[col].astype("string").str.strip().fillna("Unknown")

    df["Resolution_Days"] = (df["Resolved_Time"] - df["Open_Time"]).dt.total_seconds() / 86400
    df["Was_Reopened"] = df["Reopen_Time"].notna()
    df["Within_SLA"] = df.apply(
        lambda r: (
            r["Resolution_Days"] <= SLA_TARGETS_DAYS[int(r["Priority_Level"])]
            if pd.notna(r["Priority_Level"]) and pd.notna(r["Resolution_Days"])
            else pd.NA
        ),
        axis=1,
    )

    df["Open_Month"] = df["Open_Time"].dt.strftime("%Y-%m")
    df["Resolved_Month"] = df["Resolved_Time"].dt.strftime("%Y-%m")
    return df


def build_aggregates(df: pd.DataFrame) -> dict:
    resolved = df[df["Resolution_Days"].notna()]

    kpi = {
        "total_incidents": int(len(df)),
        "closed": int((df["Status"] == "Closed").sum()),
        "work_in_progress": int((df["Status"] != "Closed").sum()),
        "reopened": int(df["Was_Reopened"].sum()),
        "reopen_rate_pct": round(df["Was_Reopened"].mean() * 100, 2),
        "median_resolution_days": round(float(resolved["Resolution_Days"].median()), 2),
        "avg_resolution_days": round(float(resolved["Resolution_Days"].mean()), 2),
        "p90_resolution_days": round(float(resolved["Resolution_Days"].quantile(0.9)), 2),
        "avg_reassignments": round(float(df["No_of_Reassignments"].mean()), 2),
        "within_sla_pct": round(
            float(resolved["Within_SLA"].astype("boolean").mean() * 100), 2
        ),
        "date_range": {
            "min": df["Open_Time"].min().strftime("%Y-%m-%d"),
            "max": df["Open_Time"].max().strftime("%Y-%m-%d"),
        },
    }

    opened = df["Open_Month"].value_counts().sort_index().rename_axis("month").rename("opened")
    closed_m = (
        resolved["Resolved_Month"].value_counts().sort_index().rename_axis("month").rename("resolved")
    )
    monthly = pd.concat([opened, closed_m], axis=1).fillna(0).reset_index()
    monthly["opened"] = monthly["opened"].astype(int)
    monthly["resolved"] = monthly["resolved"].astype(int)

    # Flag the trailing month when it does not cover the full calendar month.
    max_date = df["Open_Time"].max()
    monthly["partial"] = monthly["month"] == max_date.strftime("%Y-%m")
    monthly["partial"] = monthly["partial"] & (max_date.day < 28)

    priority = (
        df["Priority_Label"].value_counts().rename_axis("priority").rename("count").reset_index()
    )
    priority["order"] = priority["priority"].map({v: k for k, v in PRIORITY_LABELS.items()}).fillna(99)
    priority = priority.sort_values("order").drop(columns="order")

    category = df["Category"].value_counts().rename_axis("category").rename("count").reset_index()
    ci_cat = df["CI_Cat"].value_counts().rename_axis("ci_cat").rename("count").reset_index()
    ci_subcat = (
        df["CI_Subcat"].value_counts().head(TOP_N_SUBCAT).rename_axis("ci_subcat").rename("count").reset_index()
    )
    closure = (
        df["Closure_Code"].value_counts().rename_axis("closure_code").rename("count").reset_index()
    )
    status = df["Status"].value_counts().rename_axis("status").rename("count").reset_index()

    res_by_pri = (
        resolved.groupby("Priority_Label", observed=True)["Resolution_Days"]
        .agg(median="median", avg="mean", p90=lambda s: s.quantile(0.9), n="count")
        .round(2)
        .reset_index()
    )
    res_by_pri["order"] = res_by_pri["Priority_Label"].map(
        {v: k for k, v in PRIORITY_LABELS.items()}
    ).fillna(99)
    res_by_pri = res_by_pri.sort_values("order").drop(columns="order")

    itil = build_itil_metrics(df, resolved)

    return {
        "kpi": kpi,
        "monthly": monthly,
        "priority": priority,
        "category": category,
        "ci_cat": ci_cat,
        "ci_subcat": ci_subcat,
        "closure": closure,
        "resolution_by_priority": res_by_pri,
        "itil": itil,
        "status": status,
    }


def build_itil_metrics(df: pd.DataFrame, resolved: pd.DataFrame) -> dict:
    """Standard ITIL service-operation measures computed from the extract.

    Definitions/proxies (documented in the report footer):
    - MTTR: mean/median hours Open_Time -> Resolved_Time (resolved tickets).
    - MTBF: mean days between consecutive incidents on the same CI
      (CIs with >= 2 incidents within this extract; biased by the volume
      ramp in the source data).
    - FCR (first contact resolution): % of resolved tickets never reassigned.
    - Escalation rate: % of tickets reassigned 2+ times.
    """
    mttr_hours = resolved["Resolution_Days"] * 24

    mttr_by_priority = (
        resolved.groupby("Priority_Label", observed=True)["Resolution_Days"]
        .agg(mean_days="mean", median_days="median", n="count")
        .round(2)
        .reset_index()
    )
    mttr_by_priority["order"] = mttr_by_priority["Priority_Label"].map(
        {v: k for k, v in PRIORITY_LABELS.items()}
    ).fillna(99)
    mttr_by_priority = mttr_by_priority.sort_values("order").drop(columns="order")

    # MTBF: gaps between consecutive incidents per CI
    ci_gaps = []
    for _, group in df.dropna(subset=["Open_Time"]).groupby("CI_Name", observed=True):
        times = group["Open_Time"].sort_values()
        gaps = times.diff().dropna().dt.total_seconds() / 86400
        ci_gaps.append(gaps)
    all_gaps = pd.concat(ci_gaps) if ci_gaps else pd.Series(dtype=float)

    reassign = resolved["No_of_Reassignments"].fillna(0)
    fcr_base = int(reassign.notna().sum())
    fcr_pct = round(float((reassign == 0).mean() * 100), 2) if fcr_base else None
    escalation_pct = round(float((reassign >= 2).mean() * 100), 2) if fcr_base else None

    major = df["Priority_Level"].isin([1, 2])
    monthly_mttr = (
        resolved.groupby("Resolved_Month", observed=True)["Resolution_Days"]
        .agg(median_days="median", mean_days="mean", resolved="count")
        .round(2)
        .reset_index()
        .rename(columns={"Resolved_Month": "month"})
    )

    return {
        "mttr_hours_avg": round(float(mttr_hours.mean()), 1),
        "mttr_hours_median": round(float(mttr_hours.median()), 1),
        "mttr_by_priority": mttr_by_priority,
        "mtbf_days_avg": round(float(all_gaps.mean()), 1) if len(all_gaps) else None,
        "mtbf_ci_count": int((df.groupby("CI_Name", observed=True).size() >= 2).sum()),
        "fcr_pct": fcr_pct,
        "fcr_base": fcr_base,
        "escalation_pct": escalation_pct,
        "sla_compliance_pct": round(
            float(resolved["Within_SLA"].astype("boolean").mean() * 100), 2
        ),
        "reopen_rate_pct": round(float(df["Was_Reopened"].mean() * 100), 2),
        "backlog_open": int((df["Status"] != "Closed").sum()),
        "major_incidents": {"count": int(major.sum()), "pct": round(float(major.mean() * 100), 2)},
        "monthly_mttr": monthly_mttr,
    }


def validate(aggregates: dict) -> None:
    """Fail the pipeline loudly if outputs look broken (CI quality gate)."""
    kpi = aggregates["kpi"]
    assert kpi["total_incidents"] > 0, "no incidents parsed"
    assert sum(aggregates["monthly"]["opened"]) == kpi["total_incidents"], "monthly totals mismatch"
    assert aggregates["priority"]["count"].sum() == kpi["total_incidents"], "priority totals mismatch"
    assert (aggregates["monthly"]["opened"] >= 0).all(), "negative monthly counts"
    assert kpi["median_resolution_days"] >= 0, "impossible median resolution"
    itil = aggregates["itil"]
    assert itil["mttr_hours_avg"] > 0, "impossible MTTR"
    assert 0 <= itil["fcr_pct"] <= 100, "FCR out of range"
    assert itil["fcr_base"] > 0, "empty FCR base"
    assert itil["backlog_open"] == kpi["work_in_progress"], "backlog mismatch"
