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

    return {
        "kpi": kpi,
        "monthly": monthly,
        "priority": priority,
        "category": category,
        "ci_cat": ci_cat,
        "ci_subcat": ci_subcat,
        "closure": closure,
        "resolution_by_priority": res_by_pri,
        "status": status,
    }


def validate(aggregates: dict) -> None:
    """Fail the pipeline loudly if outputs look broken (CI quality gate)."""
    kpi = aggregates["kpi"]
    assert kpi["total_incidents"] > 0, "no incidents parsed"
    assert sum(aggregates["monthly"]["opened"]) == kpi["total_incidents"], "monthly totals mismatch"
    assert aggregates["priority"]["count"].sum() == kpi["total_incidents"], "priority totals mismatch"
    assert (aggregates["monthly"]["opened"] >= 0).all(), "negative monthly counts"
    assert kpi["median_resolution_days"] >= 0, "impossible median resolution"
