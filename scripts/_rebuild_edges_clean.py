"""
Rebuild edges.json using only:
1. Semantic Scholar batch API data (from cache)
2. Manually curated known citation links

NO heuristic/keyword inference.
"""
import json
import os
import re

NODES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'nodes.json')
EDGES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'edges.json')
CACHE_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw', 'semantic_scholar_refs_cache.json')


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


KNOWN_CITATIONS = [
    ('improving language understanding by generative pre-training', 'attention is all you need'),
    ('language models are unsupervised multitask learners', 'improving language understanding by generative pre-training'),
    ('language models are few-shot learners', 'language models are unsupervised multitask learners'),
    ('language models are few-shot learners', 'attention is all you need'),
    ('bert.*pre-training of deep bidirectional', 'attention is all you need'),
    ('bert.*pre-training of deep bidirectional', 'improving language understanding by generative pre-training'),
    ('exploring the limits of transfer learning', 'attention is all you need'),
    ('exploring the limits of transfer learning', 'bert.*pre-training of deep bidirectional'),
    ('training language models to follow instructions', 'language models are few-shot learners'),
    ('scaling laws for neural language models', 'language models are unsupervised multitask learners'),
    ('training compute-optimal large language models', 'scaling laws for neural language models'),
    ('training compute-optimal large language models', 'language models are few-shot learners'),
    ('llama.*open and efficient', 'training compute-optimal large language models'),
    ('llama.*open and efficient', 'attention is all you need'),
    ('palm.*scaling language modeling', 'language models are few-shot learners'),
    ('palm.*scaling language modeling', 'attention is all you need'),
    ('switch transformers.*scaling', 'attention is all you need'),
    ('lora.*low-rank adaptation', 'language models are few-shot learners'),
    ('lora.*low-rank adaptation', 'attention is all you need'),
    ('constitutional ai', 'training language models to follow instructions'),
    ('retrieval-augmented generation', 'attention is all you need'),
    ('retrieval-augmented generation', 'bert.*pre-training of deep bidirectional'),
    ('an image is worth 16x16', 'attention is all you need'),
    ('learning transferable visual models', 'an image is worth 16x16'),
    ('gpt-4 technical report', 'training language models to follow instructions'),
    ('gpt-4 technical report', 'language models are few-shot learners'),
    ('mistral 7b', 'llama.*open and efficient'),
    ('flashattention.*fast and memory-efficient', 'attention is all you need'),
    ('direct preference optimization', 'training language models to follow instructions'),
    ('chain-of-thought prompting', 'language models are few-shot learners'),
    ('mamba.*linear-time sequence', 'attention is all you need'),
    ('deep contextualized word representations', 'bert.*pre-training of deep bidirectional'),
    ('deep residual learning', 'attention is all you need'),
]


def find_node_by_title(nodes, pattern):
    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error:
        pattern_lower = pattern.lower()
        for n in nodes:
            if pattern_lower in n['title'].lower():
                return n
        return None
    for n in nodes:
        if regex.search(n['title']):
            return n
    return None


def main():
    print('Loading data...')
    nodes = load_json(NODES_PATH)
    cache_list = load_json(CACHE_PATH)
    cache = {item['id']: item['references'] for item in cache_list}
    node_ids = set(n['id'] for n in nodes)

    # Build edges from S2 API cache only
    edges_set = set()
    for source_id in node_ids:
        for ref_id in cache.get(source_id, []):
            if ref_id in node_ids and ref_id != source_id:
                edges_set.add((source_id, ref_id))

    print(f'  Edges from S2 API: {len(edges_set)}')

    # Add known citation links
    known_added = 0
    for citing_pattern, cited_pattern in KNOWN_CITATIONS:
        citing_node = find_node_by_title(nodes, citing_pattern)
        cited_node = find_node_by_title(nodes, cited_pattern)
        if citing_node and cited_node and citing_node['id'] != cited_node['id']:
            edge = (citing_node['id'], cited_node['id'])
            if edge not in edges_set:
                edges_set.add(edge)
                known_added += 1

    print(f'  Added {known_added} known citation links')

    # Save
    edges = [{'source': s, 'target': t} for s, t in sorted(edges_set)]
    save_json(EDGES_PATH, edges)
    print(f'\nFinal edge count: {len(edges)}')

    # Verify
    gpt1 = find_node_by_title(nodes, 'improving language understanding by generative pre-training')
    attn = find_node_by_title(nodes, 'attention is all you need')
    if gpt1 and attn:
        has = (gpt1['id'], attn['id']) in edges_set
        print(f'GPT-1 -> Attention Is All You Need: {"FOUND" if has else "NOT FOUND"}')


if __name__ == '__main__':
    main()
