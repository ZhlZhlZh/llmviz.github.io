"""Add theme-river keyword labels to processed paper nodes.

Each node receives a `keywords` array containing zero or more of the same
fine-grained topics used by the theme river chart.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


NODE_PATH = Path("data/processed/nodes.json")

KEYWORD_PATTERNS: list[tuple[str, str]] = [
    ("word embeddings", r"\b(word2vec|glove|word embedding|distributed representation|embedding model)\b"),
    ("sequence-to-sequence learning", r"\b(sequence[- ]to[- ]sequence|seq2seq|encoder[- ]decoder|neural machine translation)\b"),
    ("attention mechanisms", r"\b(attention mechanism|self-attention|cross-attention|align and translate|attention is all you need)\b"),
    ("transformer architectures", r"\b(transformer|vision transformer|bert|gpt|t5|palm|llama|gemini|mistral|gemma|qwen)\b"),
    ("state space sequence models", r"\b(state space model|state-space model|selective state space|mamba|ssm)\b"),
    ("mixture-of-experts models", r"\b(mixture[- ]of[- ]experts|moe|switch transformer|sparse expert|expert model)\b"),
    ("pretraining objectives", r"\b(pretrain|pre-training|pretraining objective|language representation|representation model)\b"),
    ("masked language modeling", r"\b(masked language model|masked language modeling|bert|bidirectional encoder)\b"),
    ("autoregressive language modeling", r"\b(autoregressive|causal language model|gpt|generative pre-training|unsupervised multitask learners?|few-shot learners?)\b"),
    ("text-to-text transfer", r"\b(text-to-text|t5|unified text-to-text|transfer transformer)\b"),
    ("foundation models", r"\b(foundation model|large language model|llm|gpt-4|palm|llama|gemini|gemma|mistral|qwen)\b"),
    ("open foundation models", r"\b(open foundation model|open-source model|open source model|llama|mistral|gemma|qwen|falcon)\b"),
    ("scaling laws", r"\b(scaling laws?|neural scaling|model scaling|compute-optimal|chinchilla)\b"),
    ("emergent abilities", r"\b(emergent abilit|emergence|emergent behavior|emergent capability)\b"),
    ("training data curation", r"\b(training data|data curation|dataset curation|web data|corpus|corpora|refinedweb|data filtering)\b"),
    ("synthetic data", r"\b(synthetic data|data generation|generated data|self-instruct|distilled data)\b"),
    ("prompt engineering", r"\b(prompt engineering|prompt design|prompt optimization|natural language prompt)\b"),
    ("in-context learning", r"\b(in-context learning|few-shot|zero-shot|few shot|zero shot|demonstrations in context)\b"),
    ("chain-of-thought reasoning", r"\b(chain[- ]of[- ]thought|cot|thought prompting|reasoning steps)\b"),
    ("planning and reasoning", r"\b(reasoning|planning|large reasoning model|mathematical reasoning|tree of thoughts|self-consistency)\b"),
    ("LLM agents", r"\b(agent|agents|agentic|multi-agent|workflow|deep research|autonomous)\b"),
    ("retrieval augmented generation", r"\b(retrieval augmented generation|retrieval-augmented generation|rag|retrieval augmented)\b"),
    ("knowledge editing", r"\b(knowledge editing|model editing|knowledge injection|knowledge graph|memory system)\b"),
    ("question answering", r"\b(question answering|machine comprehension|squad|natural questions|open-domain qa|knowledge-intensive)\b"),
    ("long-context modeling", r"\b(long context|long-context|long sequence|million-length|context window|extended context)\b"),
    ("instruction tuning", r"\b(instruction tuning|instruction following|instruction data|follow instructions|instructgpt)\b"),
    ("reinforcement learning from human feedback", r"\b(reinforcement learning from human feedback|rlhf|human feedback|reward model)\b"),
    ("preference optimization", r"\b(preference optimization|direct preference optimization|dpo|preference learning|safedpo)\b"),
    ("constitutional AI", r"\b(constitutional ai|ai feedback|harmlessness from ai feedback)\b"),
    ("alignment and safety", r"\b(alignment|ai safety|safe alignment|helpful and harmless|safety)\b"),
    ("evaluation benchmarks", r"\b(evaluation|benchmark|glue|superglue|mmlu|arc|truthfulqa|helm|capability evaluation)\b"),
    ("hallucination and factuality", r"\b(hallucination|factuality|factual|truthfulness|visual contrastive decoding)\b"),
    ("robustness and calibration", r"\b(robustness|robust|calibration|uncertainty|self-consistency|out-of-distribution)\b"),
    ("interpretability", r"\b(interpretability|explainability|mechanistic interpretability|attribution|probing)\b"),
    ("bias and fairness", r"\b(bias|fairness|toxicity|debias|gender bias|stereotype)\b"),
    ("privacy and security", r"\b(privacy|security|jailbreak|attack|adversarial|prompt injection|membership inference)\b"),
    ("multimodal LLMs", r"\b(multimodal large language model|multimodal llm|multimodal model|image-text|video-llm)\b"),
    ("vision-language models", r"\b(vision-language|visual language|clip|vlm|image caption|visual question answering|vision transformer)\b"),
    ("code language models", r"\b(code language model|program synthesis|code generation|program repair|coding|code model)\b"),
    ("domain-specific LLMs", r"\b(domain[- ]specific|specialized language model|scientific language model|legal|finance|education)\b"),
    ("medical LLMs", r"\b(medical|medicine|clinical|biomedical|healthcare|med-vcd)\b"),
    ("multilingual LLMs", r"\b(multilingual|cross-lingual|cross lingual|translation|low-resource language)\b"),
    ("parameter-efficient finetuning", r"\b(parameter-efficient|parameter efficient|peft|prefix tuning|prompt tuning|fine-tun|finetun)\b"),
    ("LoRA and adapters", r"\b(lora|qlora|adapter|adapters|low-rank adaptation)\b"),
    ("distillation and compression", r"\b(distillation|knowledge distillation|compression|compressed model|student model)\b"),
    ("quantization", r"\b(quantization|quantized|low-bit|4-bit|8-bit)\b"),
    ("efficient inference and serving", r"\b(efficient inference|fast inference|serving|kv cache|flashattention|throughput|latency)\b"),
]


def node_text(node: dict) -> str:
    parts = [
        node.get("title") or "",
        node.get("abstract") or "",
        node.get("venue") or "",
    ]
    parts.extend(node.get("topic") or [])
    return " ".join(parts)


def classify(node: dict, compiled: list[tuple[str, re.Pattern[str]]]) -> list[str]:
    text = node_text(node)
    tags = [keyword for keyword, pattern in compiled if pattern.search(text)]
    if tags:
        return tags

    title = (node.get("title") or "").lower()
    topics = {topic.lower() for topic in (node.get("topic") or [])}

    fallback_rules: list[tuple[str, str]] = [
        ("vision-language models", r"\b(image|vision|visual|cnn|convolution|object detection|face|uav|rgb|coco|imagenet|stable diffusion|diffusion)\b"),
        ("synthetic data", r"\b(generative|gan|stylegan|diffusion|data augmentation|generated text|ai-generated)\b"),
        ("foundation models", r"\b(neural network|deep learning|artificial intelligence|foundation model|modularity|bayesian|random forest|gaussian process|bagging)\b"),
        ("attention mechanisms", r"\b(attention|non-local|contextual hierarchical)\b"),
        ("word embeddings", r"\b(word vectors|sentiment analysis|language model|probabilistic language model|representations?)\b"),
        ("planning and reasoning", r"\b(reinforcement learning|tree search|complexity|prediction|optimization|forward-forward)\b"),
        ("training data curation", r"\b(dataset|datasheets|imagenet|coco|tiny images|online material)\b"),
        ("efficient inference and serving", r"\b(tensorflow|pytorch|caffe|scikit-learn|gpipe|pipeline|lightweight|optimization|optimizer|adam|weight decay|dropout|batch normalization|normalization|dimensionality)\b"),
        ("robustness and calibration", r"\b(anomaly detection|intrusion detection|stable|uncertainty|trust|customer trust)\b"),
        ("privacy and security", r"\b(cryptography|intrusion detection|fake review|security|banking)\b"),
        ("domain-specific LLMs", r"\b(bank|e-commerce|education|robot|recommendation|tabular|materials|granular|blasting|coal|customer|mispronunciation|lyric)\b"),
        ("medical LLMs", r"\b(mental health|biochemical|protein|molecular|siglec|transcriptomic|survival|nmr|fungal|biomedical|whole-slide|cadmium)\b"),
        ("multimodal LLMs", r"\b(multimodal|3d human face|rgb image|whole-slide images|transcriptomic|dialogue robots)\b"),
        ("interpretability", r"\b(interpretable|explainable|structural dynamic|decomposed)\b"),
        ("bias and fairness", r"\b(ethical|ethics|policy|proactive personality)\b"),
    ]
    fallback_tags = [keyword for keyword, pattern in fallback_rules if re.search(pattern, title)]

    if not fallback_tags and topics.intersection({"medicine", "biology", "chemistry"}):
        fallback_tags.append("medical LLMs")
    if not fallback_tags and topics.intersection({"engineering", "environmental science", "materials science", "business", "education", "law", "psychology"}):
        fallback_tags.append("domain-specific LLMs")
    if not fallback_tags and topics.intersection({"mathematics", "physics"}):
        fallback_tags.append("foundation models")
    if not fallback_tags and "computer science" in topics:
        fallback_tags.append("foundation models")

    return list(dict.fromkeys(fallback_tags or ["foundation models"]))


def main() -> None:
    nodes = json.loads(NODE_PATH.read_text(encoding="utf-8-sig"))
    compiled = [(keyword, re.compile(pattern, re.IGNORECASE)) for keyword, pattern in KEYWORD_PATTERNS]

    for node in nodes:
        tagged = classify(node, compiled)
        updated = {}
        for key, value in node.items():
            if key == "keywords":
                continue
            updated[key] = value
            if key == "topic":
                updated["keywords"] = tagged
        if "keywords" not in updated:
            updated["keywords"] = tagged
        node.clear()
        node.update(updated)

    NODE_PATH.write_text(json.dumps(nodes, ensure_ascii=False, indent=2), encoding="utf-8")
    tagged_count = sum(1 for node in nodes if node.get("keywords"))
    total_labels = sum(len(node.get("keywords") or []) for node in nodes)
    print(f"tagged {tagged_count}/{len(nodes)} nodes with {total_labels} keyword links")


if __name__ == "__main__":
    main()
