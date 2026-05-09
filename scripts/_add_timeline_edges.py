"""
Add mini timeline parentIds relationships to edges.json.
Maps timeline node titles to nodes.json IDs via title matching.
"""
import json
import os
import re

NODES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'nodes.json')
EDGES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'edges.json')

# Mini timeline relationships (child -> parent means child cites parent)
# Extracted from src/modules/llm-mini-timeline/data.js
TIMELINE_LINKS = [
    # (child_title_pattern, parent_title_pattern)
    ('improving language understanding by generative pre-training', 'attention is all you need'),  # gpt1 -> transformer
    ('bert.*pre-training of deep bidirectional', 'attention is all you need'),  # bert -> transformer
    ('language models are unsupervised multitask learners', 'improving language understanding by generative pre-training'),  # gpt2 -> gpt1
    ('exploring the limits of transfer learning', 'attention is all you need'),  # t5 -> transformer
    ('scaling laws for neural language models', 'language models are unsupervised multitask learners'),  # scaling-laws -> gpt2
    ('language models are few-shot learners', 'language models are unsupervised multitask learners'),  # gpt3 -> gpt2
    ('retrieval-augmented generation', 'attention is all you need'),  # rag -> transformer
    ('switch transformers', 'attention is all you need'),  # switch-transformer -> transformer
    ('learning transferable visual models', 'language models are few-shot learners'),  # clip -> gpt3
    ('megatron-turing', 'language models are few-shot learners'),  # megatron -> gpt3
    ('finetuned language models are zero-shot learners', 'language models are few-shot learners'),  # flan -> gpt3
    ('training language models to follow instructions', 'language models are few-shot learners'),  # instructgpt -> gpt3
    ('training compute-optimal large language models', 'scaling laws for neural language models'),  # chinchilla -> scaling-laws
    ('palm.*scaling language modeling', 'language models are few-shot learners'),  # palm -> gpt3
    ('opt.*open pre-trained transformer', 'language models are few-shot learners'),  # opt -> gpt3
    ('midjourney', 'learning transferable visual models'),  # midjourney -> clip (skip, likely not in nodes)
    ('chatgpt', 'training language models to follow instructions'),  # chatgpt -> instructgpt (skip, likely not in nodes)
    ('constitutional ai', 'training language models to follow instructions'),  # constitutional-ai -> instructgpt
    ('llama.*open and efficient', 'opt.*open pre-trained transformer'),  # llama1 -> opt
    ('llama.*open and efficient', 'training compute-optimal large language models'),  # llama1 -> chinchilla
    ('alpaca', 'llama.*open and efficient'),  # alpaca -> llama1
    ('alpaca', 'training language models to follow instructions'),  # alpaca -> instructgpt
    ('claude', 'constitutional ai'),  # claude1 -> constitutional-ai (skip if not in nodes)
    ('gpt-4 technical report', 'training language models to follow instructions'),  # gpt4 -> instructgpt
    ('gpt-4 technical report', 'language models are few-shot learners'),  # gpt4 -> gpt3
    ('palm 2', 'palm.*scaling language modeling'),  # palm2 -> palm
    ('llama 2', 'llama.*open and efficient'),  # llama2 -> llama1
    ('falcon', 'language models are few-shot learners'),  # falcon -> gpt3
    ('mistral 7b', 'llama 2'),  # mistral -> llama2
    ('phi', 'llama.*open and efficient'),  # phi -> llama1 (skip if not in nodes)
    ('dall.*e 3', 'gpt-4 technical report'),  # dalle3 -> gpt4 (skip if not in nodes)
    ('gpt-4.*turbo', 'gpt-4 technical report'),  # gpt4_turbo -> gpt4 (skip if not in nodes)
    ('gemini', 'palm.*scaling language modeling'),  # gemini -> palm
    ('mamba.*linear-time sequence', 'attention is all you need'),  # mamba -> transformer
    ('sora', 'gpt-4 technical report'),  # sora -> gpt4 (skip if not in nodes)
    ('llama 3', 'llama 2'),  # llama3 -> llama2 (skip if not in nodes)
    ('direct preference optimization', 'training language models to follow instructions'),  # dpo -> instructgpt
    ('chain-of-thought prompting', 'language models are few-shot learners'),  # cot -> gpt3
    ('flashattention', 'attention is all you need'),  # flashattention -> transformer
    ('lora.*low-rank adaptation', 'language models are few-shot learners'),  # lora -> gpt3
    ('lora.*low-rank adaptation', 'attention is all you need'),  # lora -> transformer
    ('an image is worth 16x16', 'attention is all you need'),  # vit -> transformer
    ('deep contextualized word representations', 'bert.*pre-training of deep bidirectional'),  # elmo -> bert
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


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    nodes = load_json(NODES_PATH)
    edges = load_json(EDGES_PATH)
    edges_set = set((e['source'], e['target']) for e in edges)

    print(f'Current edges: {len(edges_set)}')

    added = 0
    not_found = []
    for child_pattern, parent_pattern in TIMELINE_LINKS:
        child = find_node_by_title(nodes, child_pattern)
        parent = find_node_by_title(nodes, parent_pattern)
        if not child:
            not_found.append(f'  child not found: {child_pattern}')
            continue
        if not parent:
            not_found.append(f'  parent not found: {parent_pattern}')
            continue
        if child['id'] == parent['id']:
            continue
        edge = (child['id'], parent['id'])
        if edge not in edges_set:
            edges_set.add(edge)
            added += 1

    print(f'Added {added} timeline edges')
    if not_found:
        print(f'Skipped {len(not_found)} (node not in nodes.json):')
        for nf in not_found[:10]:
            print(nf)

    # Save
    edges_out = [{'source': s, 'target': t} for s, t in sorted(edges_set)]
    save_json(EDGES_PATH, edges_out)
    print(f'Final edge count: {len(edges_out)}')


if __name__ == '__main__':
    main()
