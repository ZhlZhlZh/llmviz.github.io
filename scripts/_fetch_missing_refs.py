"""Fetch references for papers that got empty results from the batch API."""
import json
import time
import urllib.request
import urllib.error

CACHE_PATH = 'data/raw/semantic_scholar_refs_cache.json'
NODES_PATH = 'data/processed/nodes.json'
EDGES_PATH = 'data/processed/edges.json'

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def fetch_refs(paper_id):
    url = f'https://api.semanticscholar.org/graph/v1/paper/{paper_id}?fields=references.paperId'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            req.add_header('x-api-key', 'eacWmrGqmt4hmYtBWo4Y36TiheW623hk3p1sTuoL')
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return [r['paperId'] for r in (data.get('references') or []) if r.get('paperId')]
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 5 * (attempt + 1)
                print(f'  Rate limited, waiting {wait}s...')
                time.sleep(wait)
            elif e.code == 404:
                return []
            else:
                print(f'  HTTP {e.code}, attempt {attempt+1}')
                time.sleep(3)
        except Exception as e:
            print(f'  Error: {e}, attempt {attempt+1}')
            time.sleep(3)
    return None

def main():
    cache_list = load_json(CACHE_PATH)
    cache = {item['id']: item['references'] for item in cache_list}
    
    # Find papers with 0 refs
    empty_ids = [pid for pid, refs in cache.items() if len(refs) == 0]
    print(f'Papers with 0 refs: {len(empty_ids)}')
    
    fetched = 0
    for i, pid in enumerate(empty_ids):
        print(f'  [{i+1}/{len(empty_ids)}] Fetching {pid[:16]}...')
        refs = fetch_refs(pid)
        if refs is None:
            print(f'    Failed, skipping')
            continue
        if refs:
            cache[pid] = refs
            fetched += 1
            print(f'    Got {len(refs)} refs')
        else:
            print(f'    Confirmed 0 refs')
        time.sleep(1.05)  # 1 req/sec with API key
        
        # Save every 20 papers
        if (i + 1) % 20 == 0:
            cache_out = [{'id': k, 'references': v} for k, v in cache.items()]
            save_json(CACHE_PATH, cache_out)
            print(f'  Saved cache ({fetched} updated so far)')
    
    # Final save
    cache_out = [{'id': k, 'references': v} for k, v in cache.items()]
    save_json(CACHE_PATH, cache_out)
    print(f'\nUpdated {fetched} papers with new refs')
    
    # Rebuild edges
    nodes = load_json(NODES_PATH)
    node_ids = set(n['id'] for n in nodes)
    edges_set = set()
    for source_id in node_ids:
        for ref_id in cache.get(source_id, []):
            if ref_id in node_ids and ref_id != source_id:
                edges_set.add((source_id, ref_id))
    
    edges = [{'source': s, 'target': t} for s, t in sorted(edges_set)]
    save_json(EDGES_PATH, edges)
    print(f'Final edges: {len(edges)}')
    
    # Check GPT-1 -> Attention
    gpt1_id = 'cd18800a0fe0b668a1cc19f2ec95b5003d0a5035'
    attention_id = None
    for n in nodes:
        if 'attention is all you need' in n['title'].lower():
            attention_id = n['id']
            break
    if attention_id:
        has_edge = (gpt1_id, attention_id) in edges_set or (attention_id, gpt1_id) in edges_set
        print(f'GPT-1 <-> Attention: {"FOUND" if has_edge else "NOT FOUND"}')
        print(f'  GPT-1 refs in set: {len([r for r in cache.get(gpt1_id, []) if r in node_ids])}')

if __name__ == '__main__':
    main()
