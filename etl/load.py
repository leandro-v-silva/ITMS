"""Load stage: write the aggregates as JSON files consumed by the D3 report."""
import json
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "report" / "data"
DATASET_URL = "https://www.kaggle.com/datasets/ahanwadi/itsm-data"


def _write_json(name: str, payload) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"{name}.json"
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    return path


def load(aggregates: dict, total_rows: int) -> list[Path]:
    written = []
    for name, payload in aggregates.items():
        if hasattr(payload, "to_dict"):  # DataFrame -> records
            payload = payload.to_dict(orient="records")
        written.append(_write_json(name, payload))

    meta = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"name": "ITSM data (Kaggle)", "url": DATASET_URL, "file": "ITSM_data.csv"},
        "rows_processed": total_rows,
    }
    written.append(_write_json("meta", meta))
    return written
