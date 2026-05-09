"""
Rebuild edges.json using Semantic Scholar API.

For each paper in nodes.json, fetches its references from the Semantic Scholar
API and keeps only edges where both source and target are in our node set.

Usage:
    python scripts/rebuild_edges_semantic_scholar.py

Output:
    data/processed/edges.json (overwritten)

Rate limiting: S2 allows 100 requests/5 min for unauthenticated.
We batch using the /paper/batch endpoint (up to 500 papers per call)
to fetch references efficiently.
"""

import json
import time
import os
import sys
import urllib.request
import urllib.error

NODES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'nodes.json')
EDGES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'edges.json')
CACHE_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw', 'semantic_scholar_refs_cache.json')

S2_BATCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/batch'
S2_SINGLE_URL = 'https://api.semanticscholar.org/graph/v1/paper/{paper_id}'
FIELDS = 'references.paperId'
BATCH_SIZE = 100  # S2 batch endpoint limit


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fetch_batch_references(paper_ids, retries=3):
    """Fetch references for a batch of paper IDs using S2 batch endpoint."""
    url = f'{S2_BATCH_URL}?fields={FIELDS}'
    payload = json.dumps({'ids': paper_ids}).encode('utf-8')
    
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Content-Type', 'application/json')
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 60 * (attempt + 1)
                print(f'  Rate limited, waiting {wait}s...')
                time.sleep(wait)
            else:
                print(f'  HTTP {e.code} for batch, attempt {attempt+1}/{retries}')
                time.sleep(5)
        except Exception as e:
            print(f'  Error: {e}, attempt {attempt+1}/{retries}')
            time.sleep(5)
    return None


def fetch_single_references(paper_id, retries=3):
    """Fallback: fetch references for a single paper."""
    url = f'{S2_SINGLE_URL.format(paper_id=paper_id)}?fields={FIELDS}'
    
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 60 * (attempt + 1)
                print(f'  Rate limited on {paper_id[:12]}..., waiting {wait}s...')
                time.sleep(wait)
            elif e.code == 404:
                return None
            else:
                print(f'  HTTP {e.code} for {paper_id[:12]}..., attempt {attempt+1}')
                time.sleep(5)
        except Exception as e:
            print(f'  Error: {e}, attempt {attempt+1}')
            time.sleep(5)
    return None


def main():
    print('Loading nodes...')
    nodes = load_json(NODES_PATH)
    node_ids = set(n['id'] for n in nodes)
    print(f'  {len(node_ids)} papers in node set')

    # Load cache if exists
    cache = {}
    if os.path.exists(CACHE_PATH):
        try:
            cache = {item['id']: item.get('references', []) for item in load_json(CACHE_PATH)}
            print(f'  Loaded cache with {len(cache)} entries')
        except Exception:
            cache = {}

    # Determine which papers still need fetching
    to_fetch = [pid for pid in node_ids if pid not in cache]
    print(f'  Need to fetch references for {len(to_fetch)} papers')

    # Fetch in batches
    if to_fetch:
        batches = [to_fetch[i:i+BATCH_SIZE] for i in range(0, len(to_fetch), BATCH_SIZE)]
        for batch_idx, batch in enumerate(batches):
            print(f'  Batch {batch_idx+1}/{len(batches)} ({len(batch)} papers)...')
            results = fetch_batch_references(batch)
            
            if results is None:
                # Fallback to single requests
                print('  Batch failed, falling back to single requests...')
                for pid in batch:
                    if pid in cache:
                        continue
                    result = fetch_single_references(pid)
                    if result and 'references' in result:
                        refs = [r['paperId'] for r in (result['references'] or []) if r.get('paperId')]
                        cache[pid] = refs
                    else:
                        cache[pid] = []
                    time.sleep(1.1)  # Rate limit: ~1 req/sec
            else:
                for i, paper_data in enumerate(results):
                    pid = batch[i]
                    if paper_data is None:
                        cache[pid] = []
                        continue
                    refs = [r['paperId'] for r in (paper_data.get('references') or []) if r.get('paperId')]
                    cache[pid] = refs
            
            # Save cache after each batch
            cache_list = [{'id': k, 'references': v} for k, v in cache.items()]
            save_json(CACHE_PATH, cache_list)
            
            # Rate limit between batches
            if batch_idx < len(batches) - 1:
                print('  Waiting 3s between batches...')
                time.sleep(3)

    # Build edges from cache
    print('Building edges...')
    edges_set = set()
    for source_id in node_ids:
        refs = cache.get(source_id, [])
        for ref_id in refs:
            if ref_id in node_ids and ref_id != source_id:
                edges_set.add((source_id, ref_id))

    # Also add reverse: if A references B, that means A cites B.
    # In our data model: source=A (the paper that has the reference list), target=B (the referenced paper)
    edges = [{'source': s, 'target': t} for s, t in sorted(edges_set)]
    
    print(f'  Found {len(edges)} edges (was 858)')
    save_json(EDGES_PATH, edges)
    print(f'  Saved to {EDGES_PATH}')
    
    # Verify the specific case mentioned by user
    gpt1_id = 'cd18800a0fe0b668a1cc19f2ec95b5003d0a5035'
    attention_id = None
    for n in nodes:
        if 'attention is all you need' in n['title'].lower():
            attention_id = n['id']
            break
    
    if attention_id:
        has_edge = (gpt1_id, attention_id) in edges_set or (attention_id, gpt1_id) in edges_set
        print(f'\n  GPT-1 -> Attention Is All You Need: {"FOUND" if has_edge else "NOT FOUND"}')
        if not has_edge:
            print(f'    GPT-1 refs in our set: {len([r for r in cache.get(gpt1_id, []) if r in node_ids])}')
            print(f'    Attention refs in our set: {len([r for r in cache.get(attention_id, []) if r in node_ids])}')
    
    print('\nDone!')


if __name__ == '__main__':
    main()
