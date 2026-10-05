"""BI pipeline entrypoint: extract -> transform -> load.

Usage:  python etl/pipeline.py     (from the repo root, venv active)
"""
from extract import obtain_raw_csv
from load import load
from transform import build_aggregates, clean, load_raw, validate


def main() -> None:
    raw_path = obtain_raw_csv()

    df = clean(load_raw(raw_path))
    print(f"[transform] cleaned {len(df)} rows "
          f"({df['Open_Time'].notna().sum()} with valid Open_Time)")

    aggregates = build_aggregates(df)
    validate(aggregates)
    print("[transform] aggregates built and validated")

    written = load(aggregates, total_rows=len(df))
    for path in written:
        print(f"[load] wrote {path.relative_to(raw_path.parents[2])}")


if __name__ == "__main__":
    main()
