import argparse
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from build_processed_from_arxiv_ai import csv_path, parse_authors, parse_year, stable_id


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_PATH = ROOT / "data" / "raw" / "openalex_arxiv_cache.json"
OPENALEX_BASE = "https://api.openalex.org"


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def arxiv_id_from_entry(entry_id: str) -> str:
    value = (entry_id or "").strip()
    if not value:
        return ""
    value = value.rstrip("/").split("/")[-1]
    return re.sub(r"v\d+$", "", value)


def load_cache(path: Path) -> dict:
    if not path.exists():
        return {
            "schema": 1,
            "source": "OpenAlex works API",
            "updated_at": None,
            "works": {},
        }
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(cache: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_known_ids(cache_path: Path) -> set[str]:
    known = set()
    paths = [DEFAULT_CACHE_PATH, *sorted((ROOT / "data" / "raw").glob("openalex_arxiv_cache.shard*.json"))]
    for path in paths:
        if path == cache_path or not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            known.update(data.get("works", {}).keys())
        except Exception:
            continue
    return known


def request_json(path: str, params: dict | None = None, retries: int = 2, timeout: int = 12) -> dict:
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")})
    url = f"{OPENALEX_BASE}{path}"
    if query:
        url = f"{url}?{query}"
    headers = {
        "User-Agent": "llmviz-openalex-enricher/1.0 (mailto:example@example.com)",
    }
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in (400, 404):
                return {}
            if error.code in (429, 500, 502, 503, 504):
                if attempt >= retries - 1:
                    return {}
                retry_after = error.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else 2 ** attempt
                time.sleep(delay)
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    return {}


def slim_work(work: dict, matched_by: str, match_score: float | None = None) -> dict:
    if not work:
        return {"status": "not_found"}
    return {
        "status": "matched",
        "matched_by": matched_by,
        "match_score": match_score,
        "openalex_id": work.get("id", ""),
        "display_name": work.get("display_name", ""),
        "doi": work.get("doi", ""),
        "publication_year": work.get("publication_year"),
        "cited_by_count": work.get("cited_by_count", 0),
        "referenced_works": work.get("referenced_works") or [],
        "ids": work.get("ids") or {},
    }


def fetch_by_doi(doi: str) -> dict:
    clean = (doi or "").strip()
    if not clean:
        return {}
    clean = re.sub(r"^https?://(dx\.)?doi\.org/", "", clean, flags=re.I)
    clean = urllib.parse.quote(clean, safe="")
    # OpenAlex accepts DOI identifiers in entity paths.
    return request_json(f"/works/doi:{clean}", {
        "select": "id,display_name,doi,publication_year,cited_by_count,referenced_works,ids",
    })


def fetch_by_title(title: str, year: int | None) -> tuple[dict, float | None]:
    title_norm = normalize_title(title)
    if not title_norm:
        return {}, None
    params = {
        "search": title,
        "per-page": 5,
        "select": "id,display_name,doi,publication_year,cited_by_count,referenced_works,ids",
    }
    data = request_json("/works", params)
    candidates = data.get("results") or []
    best = {}
    best_score = 0.0
    for work in candidates:
        work_title = normalize_title(work.get("display_name", ""))
        if not work_title:
            continue
        title_tokens = set(title_norm.split())
        work_tokens = set(work_title.split())
        overlap = len(title_tokens & work_tokens) / max(len(title_tokens | work_tokens), 1)
        year_penalty = 0.0
        if year and work.get("publication_year"):
            year_penalty = min(abs(int(work["publication_year"]) - year), 5) * 0.03
        score = overlap - year_penalty
        if score > best_score:
            best = work
            best_score = score
    if best_score >= 0.72:
        return best, round(best_score, 4)
    return {}, round(best_score, 4) if candidates else None


def rows_with_ids() -> list[dict]:
    with csv_path().open("r", encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    items = []
    for row in rows:
        title = (row.get("title") or "").strip()
        year = parse_year(row.get("published", ""))
        authors = parse_authors(row.get("authors", ""))
        entry_id = (row.get("entry_id") or "").strip()
        node_id = stable_id(entry_id or f"{title}|{year}|{','.join(authors)}")
        items.append({
            "node_id": node_id,
            "title": title,
            "year": year,
            "doi": (row.get("doi") or "").strip(),
            "entry_id": entry_id,
            "arxiv_id": arxiv_id_from_entry(entry_id),
        })
    return items


def enrich_item(item: dict) -> dict:
    if item["doi"]:
        work = fetch_by_doi(item["doi"])
        if work:
            result = slim_work(work, "doi", 1.0)
        else:
            result = {"status": "not_found", "matched_by": "doi", "match_score": 0.0}
    else:
        work, score = fetch_by_title(item["title"], item["year"])
        result = slim_work(work, "title", score) if work else {
            "status": "not_found",
            "matched_by": "title",
            "match_score": score,
        }

    result["query"] = {
        "title": item["title"],
        "year": item["year"],
        "doi": item["doi"],
        "entry_id": item["entry_id"],
        "arxiv_id": item["arxiv_id"],
    }
    return result


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Cache OpenAlex citation counts and references for arXiv AI CSV rows.")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of missing rows to enrich.")
    parser.add_argument("--offset", type=int, default=0, help="Start offset in CSV row order.")
    parser.add_argument("--sleep", type=float, default=0.12, help="Delay between OpenAlex requests.")
    parser.add_argument("--force", action="store_true", help="Refresh rows even if they are already cached.")
    parser.add_argument("--save-every", type=int, default=25, help="Save cache every N enriched rows.")
    parser.add_argument("--cache-path", default=None, help="Cache JSON path. Defaults to the main cache or a shard cache.")
    parser.add_argument("--shard-count", type=int, default=1, help="Split CSV rows across N independent workers.")
    parser.add_argument("--shard-index", type=int, default=0, help="This worker's zero-based shard index.")
    args = parser.parse_args()

    if args.shard_count < 1:
        raise ValueError("--shard-count must be >= 1")
    if args.shard_index < 0 or args.shard_index >= args.shard_count:
        raise ValueError("--shard-index must be between 0 and shard-count - 1")

    cache_path = Path(args.cache_path) if args.cache_path else (
        ROOT / "data" / "raw" / f"openalex_arxiv_cache.shard{args.shard_index:02d}-of-{args.shard_count:02d}.json"
        if args.shard_count > 1 else DEFAULT_CACHE_PATH
    )
    if not cache_path.is_absolute():
        cache_path = ROOT / cache_path

    cache = load_cache(cache_path)
    works = cache.setdefault("works", {})
    known_ids = set() if args.force else load_known_ids(cache_path)
    items = [
        item for absolute_index, item in enumerate(rows_with_ids())
        if absolute_index >= args.offset and absolute_index % args.shard_count == args.shard_index
    ]
    total = len(items)
    enriched = 0
    matched = 0

    try:
      for index, item in enumerate(items, start=1):
          node_id = item["node_id"]
          if not args.force and (node_id in works or node_id in known_ids):
              continue
          if args.limit is not None and enriched >= args.limit:
              break

          result = enrich_item(item)
          works[node_id] = result
          enriched += 1
          if result.get("status") == "matched":
              matched += 1

          print(
              f"[{index + 1}/{args.offset + total}] "
              f"{result.get('status')} "
              f"{result.get('matched_by')} "
              f"cites={result.get('cited_by_count', 0)} "
              f"refs={len(result.get('referenced_works') or [])} "
              f"{item['title'][:90].encode('utf-8', errors='replace').decode('utf-8', errors='replace')}"
          )

          if enriched % args.save_every == 0:
              cache["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
              save_cache(cache, cache_path)
          time.sleep(args.sleep)
    finally:
        cache["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save_cache(cache, cache_path)

    cached_total = len(works)
    cached_matched = sum(1 for work in works.values() if work.get("status") == "matched")
    print(f"enriched={enriched} matched_this_run={matched}")
    print(f"cache={cache_path} cached_total={cached_total} cached_matched={cached_matched}")


if __name__ == "__main__":
    main()
