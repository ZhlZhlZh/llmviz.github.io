import argparse
import csv
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from build_processed_from_arxiv_ai import csv_path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "raw" / "openalex_cli_work_ids.txt"
DEFAULT_MAP = ROOT / "data" / "raw" / "openalex_cli_work_id_map.json"


def normalize_doi(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value, flags=re.I)
    return value


def read_dois() -> list[str]:
    seen = set()
    dois = []
    with csv_path().open("r", encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            doi = normalize_doi(row.get("doi", ""))
            if not doi or not doi.startswith("10.") or doi in seen:
                continue
            seen.add(doi)
            dois.append(doi)
    return dois


def request_work_id(doi: str, api_key: str, retries: int = 3) -> str:
    quoted = urllib.parse.quote(doi, safe="")
    url = f"https://api.openalex.org/works/doi:{quoted}?select=id&api_key={urllib.parse.quote(api_key)}"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
                return str(data.get("id", "")).replace("https://openalex.org/", "")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return ""
            if error.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return ""
        except Exception:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return ""
    return ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Resolve arxiv_ai.csv DOIs to OpenAlex Work IDs for openalex download --stdin.")
    parser.add_argument("-o", "--output", default=str(DEFAULT_OUTPUT), help="Output text file, one OpenAlex Work ID per line.")
    parser.add_argument("--map-output", default=str(DEFAULT_MAP), help="JSON map of DOI to Work ID.")
    parser.add_argument("--sleep", type=float, default=0.02, help="Delay between DOI lookup requests.")
    parser.add_argument("--api-key", default=os.environ.get("OPENALEX_API_KEY", ""), help="OpenAlex API key or OPENALEX_API_KEY env var.")
    args = parser.parse_args()
    if not args.api_key:
        raise SystemExit("OPENALEX_API_KEY is required")

    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    map_output = Path(args.map_output)
    if not map_output.is_absolute():
        map_output = ROOT / map_output
    output.parent.mkdir(parents=True, exist_ok=True)

    dois = read_dois()
    mapping = {}
    ids = []
    for index, doi in enumerate(dois, start=1):
        work_id = request_work_id(doi, args.api_key)
        mapping[doi] = work_id
        if work_id:
            ids.append(work_id)
        if index % 25 == 0 or index == len(dois):
            output.write_text("\n".join(ids) + ("\n" if ids else ""), encoding="utf-8")
            map_output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{index}/{len(dois)} resolved={len(ids)}")
        time.sleep(args.sleep)

    print(f"wrote={output}")
    print(f"resolved={len(ids)}")
    print(f"missing={len(dois) - len(ids)}")


if __name__ == "__main__":
    main()
