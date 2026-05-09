import json

cache = json.load(open('data/raw/semantic_scholar_refs_cache.json', 'r', encoding='utf-8'))
gpt1 = [x for x in cache if x['id'] == 'cd18800a0fe0b668a1cc19f2ec95b5003d0a5035']
if gpt1:
    print(f"GPT-1 refs count: {len(gpt1[0]['references'])}")
    print(f"GPT-1 refs sample: {gpt1[0]['references'][:5]}")
else:
    print("GPT-1 not in cache")

empty = [x for x in cache if len(x['references']) == 0]
print(f"Papers with 0 refs: {len(empty)}/{len(cache)}")

# Check how many have refs
has_refs = [x for x in cache if len(x['references']) > 0]
print(f"Papers with refs: {len(has_refs)}")
total_refs = sum(len(x['references']) for x in cache)
print(f"Total ref entries: {total_refs}")
