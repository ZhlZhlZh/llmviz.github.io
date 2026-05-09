import argparse
import csv
from pathlib import Path

from build_processed_from_arxiv_ai import csv_path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "raw" / "openalex_cli_dois.txt"


def normalize_doi(value: str) -> str:
    value = (value or "").strip()
    value = value.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="Export arxiv_ai.csv DOI identifiers for openalex download --stdin.")
    parser.add_argument("-o", "--output", default=str(DEFAULT_OUTPUT), help="Output text file, one DOI per line.")
    args = parser.parse_args()

    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)

    seen = set()
    dois = []
    with csv_path().open("r", encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            doi = normalize_doi(row.get("doi", ""))
            if doi and doi not in seen:
                seen.add(doi)
                dois.append(doi)

    output.write_text("\n".join(dois) + ("\n" if dois else ""), encoding="utf-8")
    print(f"wrote={output}")
    print(f"doi_count={len(dois)}")


if __name__ == "__main__":
    main()
