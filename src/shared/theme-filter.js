function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, '');
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

const THEME_ALIASES = {
  'Search and Planning': ['search', 'planning', 'heuristic', 'backtracking', 'sat'],
  'Knowledge Representation and Reasoning': ['knowledge representation', 'reasoning', 'ontology', 'logic', 'inference'],
  'Constraint Solving and Optimization': ['constraint', 'optimization', 'scheduling', 'solver'],
  'Machine Learning and Neural Networks': ['machine learning', 'deep learning', 'neural', 'classification', 'clustering'],
  'Natural Language Processing and LLMs': ['natural language', 'language model', 'transformer', 'question answering', 'dialogue'],
  'Computer Vision and Multimodal AI': ['computer vision', 'image', 'visual', 'video', 'multimodal'],
  'Multi-Agent Systems and Game AI': ['multi-agent', 'multiagent', 'agent', 'game', 'auction', 'coordination'],
  'Robotics and Autonomous Systems': ['robot', 'robotics', 'autonomous', 'navigation', 'motion planning'],
  'Probabilistic and Causal AI': ['probabilistic', 'bayesian', 'markov', 'uncertainty', 'causal'],
  'Data Mining and Information Retrieval': ['data mining', 'information retrieval', 'retrieval', 'recommender', 'ranking'],
  'AI Safety, Ethics and Explainability': ['safety', 'ethic', 'fairness', 'explainable', 'interpretability', 'bias'],
  'Reinforcement Learning and Decision Making': ['reinforcement learning', 'policy', 'reward', 'decision making', 'mdp'],
  'LLM agents': ['agent', 'tool use', 'planning'],
  'LoRA and adapters': ['lora', 'adapter', 'parameter efficient'],
  'retrieval augmented generation': ['rag', 'retrieval'],
  'reinforcement learning from human feedback': ['rlhf', 'human feedback'],
  'state space sequence models': ['mamba', 'state space', 'ssm'],
  'vision-language models': ['vision language', 'vlm', 'visual language'],
  'multimodal LLMs': ['multimodal', 'multi modal'],
  'code language models': ['code', 'programming'],
  'foundation models': ['foundation model', 'large language model'],
  'open foundation models': ['open model', 'llama', 'mistral', 'gemma'],
  'masked language modeling': ['masked language', 'bert'],
  'autoregressive language modeling': ['autoregressive', 'gpt'],
  'chain-of-thought reasoning': ['chain of thought', 'cot', 'reasoning'],
  'planning and reasoning': ['planning', 'reasoning'],
  'efficient inference and serving': ['efficient inference', 'serving', 'vllm'],
  'transformer architectures': ['transformer', 'attention'],
  'attention mechanisms': ['attention'],
  'question answering': ['question answering', 'qa']
};

export function paperMatchesTheme(node, theme) {
  const normalizedTheme = normalize(theme);
  if (!normalizedTheme) return true;

  const exactFields = [
    ...asArray(node.keywords),
    ...asArray(node.topic)
  ].map(normalize);
  if (exactFields.some((value) => value === normalizedTheme || value.includes(normalizedTheme) || normalizedTheme.includes(value))) {
    return true;
  }

  const aliases = [theme, ...(THEME_ALIASES[theme] || [])].map(normalize).filter(Boolean);
  const haystack = normalize([
    node.title,
    node.venue,
    ...asArray(node.keywords),
    ...asArray(node.topic)
  ].join(' '));
  const compactHaystack = compact(haystack);

  return aliases.some((alias) => {
    if (haystack.includes(alias)) return true;
    return alias.length > 4 && compactHaystack.includes(compact(alias));
  });
}

export function themePapers(nodes, theme) {
  return nodes.filter((node) => paperMatchesTheme(node, theme));
}

export function topThemePaper(nodes, theme) {
  return themePapers(nodes, theme)
    .sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0) || (b.year || 0) - (a.year || 0))[0] || null;
}
