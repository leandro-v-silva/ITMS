"""Extract stage: make sure the raw ITSM dataset is available locally.

The raw CSV is committed to the repo (data/raw/ITSM_data.csv), so normally
this stage is a no-op. If the file is missing and Kaggle API credentials are
available (KAGGLE_USERNAME / KAGGLE_KEY environment variables), it downloads
the dataset from Kaggle as a fallback.

Source: https://www.kaggle.com/datasets/ahanwadi/itsm-data
"""
import os
import shutil
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = REPO_ROOT / "data" / "raw" / "ITSM_data.csv"
DATASET_SLUG = "ahanwadi/itsm-data"
TARGET_FILE = "ITSM_data.csv"


def obtain_raw_csv() -> Path:
    """Return the path to the raw CSV, downloading from Kaggle if needed."""
    if RAW_PATH.exists():
        print(f"[extract] using local file: {RAW_PATH}")
        return RAW_PATH

    username = os.environ.get("KAGGLE_USERNAME")
    key = os.environ.get("KAGGLE_KEY")
    if not (username and key):
        raise FileNotFoundError(
            f"Raw data not found at {RAW_PATH} and no Kaggle credentials in "
            "KAGGLE_USERNAME/KAGGLE_KEY. Restore the file from git or set credentials."
        )

    print(f"[extract] downloading dataset '{DATASET_SLUG}' from Kaggle API...")
    url = f"https://www.kaggle.com/api/v1/datasets/download/{DATASET_SLUG}"
    request = urllib.request.Request(url)
    import base64

    credentials = base64.b64encode(f"{username}:{key}".encode()).decode()
    request.add_header("Authorization", f"Basic {credentials}")

    tmp_zip = REPO_ROOT / "data" / "raw" / "dataset.zip"
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(request, timeout=300) as response, open(tmp_zip, "wb") as out:
            shutil.copyfileobj(response, out)
        with zipfile.ZipFile(tmp_zip) as zf:
            zf.extract(TARGET_FILE, RAW_PATH.parent)
    finally:
        tmp_zip.unlink(missing_ok=True)

    if not RAW_PATH.exists():
        raise RuntimeError(f"Download finished but {TARGET_FILE} was not in the archive.")
    print(f"[extract] downloaded -> {RAW_PATH}")
    return RAW_PATH
