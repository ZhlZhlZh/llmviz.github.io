const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'data', 'processed');

const institutions = [
  ['inst_openai', 'OpenAI', 'San Francisco', 'USA', 37.7749, -122.4194, 'english', 'research_lab'],
  ['inst_google', 'Google Research', 'Mountain View', 'USA', 37.422, -122.0841, 'english', 'company'],
  ['inst_meta', 'Meta AI', 'Menlo Park', 'USA', 37.4848, -122.1484, 'english', 'company'],
  ['inst_anthropic', 'Anthropic', 'San Francisco', 'USA', 37.7897, -122.3972, 'english', 'research_lab'],
  ['inst_deepmind', 'DeepMind', 'London', 'UK', 51.5074, -0.1278, 'english', 'company'],
  ['inst_microsoft', 'Microsoft Research', 'Redmond', 'USA', 47.674, -122.1215, 'english', 'company'],
  ['inst_stanford', 'Stanford University', 'Stanford', 'USA', 37.4275, -122.1697, 'english', 'university'],
  ['inst_berkeley', 'UC Berkeley', 'Berkeley', 'USA', 37.8715, -122.273, 'english', 'university'],
  ['inst_mit', 'MIT CSAIL', 'Cambridge', 'USA', 42.3601, -71.0942, 'english', 'university'],
  ['inst_cmu', 'Carnegie Mellon University', 'Pittsburgh', 'USA', 40.4433, -79.9436, 'english', 'university'],
  ['inst_tsinghua', 'Tsinghua University', 'Beijing', 'China', 40.0007, 116.3269, 'chinese', 'university'],
  ['inst_pku', 'Peking University', 'Beijing', 'China', 39.9928, 116.3055, 'chinese', 'university'],
  ['inst_zju', 'Zhejiang University', 'Hangzhou', 'China', 30.2638, 120.1236, 'chinese', 'university'],
  ['inst_shanghai_ai', 'Shanghai AI Lab', 'Shanghai', 'China', 31.2304, 121.4737, 'chinese', 'research_lab'],
  ['inst_baai', 'Beijing Academy of AI', 'Beijing', 'China', 39.9042, 116.4074, 'chinese', 'research_lab'],
  ['inst_huawei', 'Huawei Noah Ark Lab', 'Shenzhen', 'China', 22.5431, 114.0579, 'chinese', 'company'],
  ['inst_alibaba', 'Alibaba DAMO Academy', 'Hangzhou', 'China', 30.2741, 120.1551, 'chinese', 'company'],
  ['inst_nus', 'National University of Singapore', 'Singapore', 'Singapore', 1.2966, 103.7764, 'english', 'university'],
  ['inst_tokyo', 'University of Tokyo', 'Tokyo', 'Japan', 35.7126, 139.761, 'english', 'university'],
  ['inst_eth', 'ETH Zurich', 'Zurich', 'Switzerland', 47.3769, 8.5417, 'english', 'university'],
  ['inst_oxford', 'University of Oxford', 'Oxford', 'UK', 51.7548, -1.2544, 'english', 'university'],
  ['inst_inria', 'Inria', 'Paris', 'France', 48.8566, 2.3522, 'english', 'research_lab'],
  ['inst_toronto', 'University of Toronto', 'Toronto', 'Canada', 43.6629, -79.3957, 'english', 'university'],
  ['inst_mila', 'Mila', 'Montreal', 'Canada', 45.5019, -73.5674, 'english', 'research_lab']
].map(([id, institution, city, country, lat, lng, community, org_type]) => ({
  id,
  institution,
  city,
  country,
  lat,
  lng,
  community,
  org_type,
  papers_count: 0,
  citations_count: 0,
  avg_pagerank: 0,
  collaboration_breadth: 0,
  influence_score: 0
}));

const instByName = new Map(institutions.map((item) => [item.institution, item]));

const authorPool = [
  'Yoshua Bengio',
  'Ilya Sutskever',
  'Geoffrey Hinton',
  'Ashish Vaswani',
  'Noam Shazeer',
  'Alec Radford',
  'Jason Wei',
  'Chelsea Finn',
  'Percy Liang',
  'Fei-Fei Li',
  'Diyi Yang',
  'Pieter Abbeel',
  'Kaiming He',
  'Lilian Weng',
  'Andrew Ng',
  'Wei Li',
  'Hao Zhang',
  'Jie Tang',
  'Zhiyuan Liu',
  'Minlie Huang',
  'Yue Cao',
  'Han Xiao',
  'Qing Li',
  'Rui Wang',
  'Yiming Yang',
  'Ming Zhou',
  'Tao Qin',
  'Junxian He',
  'Xiang Ren',
  'Denny Zhou',
  'Daphne Koller',
  'Christopher Manning',
  'Anima Anandkumar',
  'Oriol Vinyals'
];

const topics = [
  ['word2vec', 'Representation Learning', ['word2vec', 'embedding', 'semantic search']],
  ['lstm', 'Sequence Modeling', ['lstm', 'seq2seq', 'translation']],
  ['attention', 'Attention Mechanisms', ['attention', 'alignment', 'context modeling']],
  ['transformer', 'Transformer Architectures', ['transformer', 'self-attention', 'parallel sequence modeling']],
  ['bert', 'Bidirectional Pretraining', ['bert', 'masked language modeling', 'pretraining']],
  ['gpt', 'Autoregressive Scaling', ['gpt', 'few-shot learning', 'scaling law']],
  ['instruction', 'Instruction Tuning', ['instruction tuning', 'rlhf', 'human feedback']],
  ['rag', 'Retrieval Augmentation', ['rag', 'retrieval', 'factuality']],
  ['multimodal', 'Multimodal Foundation Models', ['multimodal', 'vision-language', 'contrastive learning']],
  ['agent', 'Agentic Planning', ['agent', 'tool use', 'planning']],
  ['moe', 'Sparse Expert Models', ['moe', 'expert routing', 'efficient scaling']],
  ['small_llm', 'Efficient and Local LLMs', ['distillation', 'small llm', 'edge deployment']]
];

const anchorPapers = [
  ['p2013_word2vec', 2013, 'Distributed Word Embeddings for Efficient Semantic Search', 'word2vec', 'Google Research', ['Yoshua Bengio', 'Ilya Sutskever']],
  ['p2014_seq2seq', 2014, 'Sequence to Sequence Learning with Neural Translation', 'lstm', 'Mila', ['Ilya Sutskever', 'Oriol Vinyals']],
  ['p2015_attention', 2015, 'Neural Attention for Long-Range Sequence Modeling', 'attention', 'University of Toronto', ['Yoshua Bengio', 'Diyi Yang']],
  ['p2017_transformer', 2017, 'Attention-Only Neural Architectures', 'transformer', 'Google Research', ['Ashish Vaswani', 'Noam Shazeer']],
  ['p2018_bert', 2018, 'Bidirectional Pretraining with Masked Objectives', 'bert', 'Google Research', ['Jacob Devlin', 'Ming Zhou']],
  ['p2018_gpt', 2018, 'Generative Pretraining for Language Understanding', 'gpt', 'OpenAI', ['Alec Radford', 'Ilya Sutskever']],
  ['p2020_gpt3', 2020, 'Few-Shot Learners at Scale', 'gpt', 'OpenAI', ['Alec Radford', 'Denny Zhou']],
  ['p2021_clip', 2021, 'Contrastive Language-Image Pretraining', 'multimodal', 'OpenAI', ['Alec Radford', 'Fei-Fei Li']],
  ['p2022_instructgpt', 2022, 'Instruction Tuning with Human Feedback', 'instruction', 'OpenAI', ['Lilian Weng', 'Denny Zhou']],
  ['p2023_llama', 2023, 'Open Foundation Models at Smaller Scale', 'small_llm', 'Meta AI', ['Kaiming He', 'Percy Liang']],
  ['p2024_rag', 2024, 'Retrieval-Augmented Generation for Reliable LLMs', 'rag', 'Stanford University', ['Percy Liang', 'Christopher Manning']],
  ['p2025_multimodal_agent', 2025, 'Unified Multimodal Agent Models', 'agent', 'DeepMind', ['Oriol Vinyals', 'Fei-Fei Li']],
  ['p2026_world_model_agent', 2026, 'World-Model Grounded Foundation Agents', 'agent', 'Google Research', ['Chelsea Finn', 'Pieter Abbeel']]
];

const venues = ['NeurIPS', 'ICML', 'ACL', 'ICLR', 'EMNLP', 'CVPR', 'KDD'];

function topicForYear(year, index) {
  if (year <= 2014) return topics[index % 3];
  if (year <= 2017) return topics[(index + 1) % 4];
  if (year <= 2020) return topics[3 + (index % 4)];
  if (year <= 2022) return topics[5 + (index % 5)];
  return topics[6 + (index % 6)];
}

function pickAuthors(seed, forced = []) {
  const authors = [...forced];
  let cursor = seed * 3;
  while (authors.length < 4) {
    const candidate = authorPool[cursor % authorPool.length];
    if (!authors.includes(candidate)) {
      authors.push(candidate);
    }
    cursor += 5;
  }
  return authors.slice(0, 3 + (seed % 2));
}

function citationsFor(year, topicIndex, anchorBoost = 0) {
  const age = 2027 - year;
  const topicBoost = 1 + ((topicIndex % 5) * 0.12);
  return Math.round((age * age * 185 + 1200 + anchorBoost) * topicBoost);
}

const nodes = [];

anchorPapers.forEach(([id, year, title, topicKey, institution, forcedAuthors], index) => {
  const topic = topics.find((item) => item[0] === topicKey);
  const inst = instByName.get(institution);
  const citations = citationsFor(year, index, 8200);
  nodes.push({
    id,
    title,
    year,
    abstract: `A synthetic anchor paper about ${topic[1].toLowerCase()}, used to test interactions across citation paths, topic streams, and institution views.`,
    authors: pickAuthors(index, forcedAuthors),
    keywords: topic[2],
    topic: topic[0],
    citations_count: citations,
    influential_citations_count: Math.round(citations * (0.16 + (index % 4) * 0.025)),
    venue: venues[index % venues.length],
    institution,
    country: inst.country,
    community: inst.community,
    org_type: inst.org_type,
    pagerank: Number((0.006 + citations / 1200000).toFixed(4)),
    collaboration_breadth: Number((0.32 + (index % 8) * 0.055).toFixed(2))
  });
});

for (let year = 2013; year <= 2026; year += 1) {
  for (let i = 0; i < 5; i += 1) {
    const topic = topicForYear(year, i);
    const id = `p${year}_${topic[0]}_${i + 1}`;
    if (nodes.some((node) => node.id === id)) continue;
    const inst = institutions[(year * 7 + i * 5) % institutions.length];
    const title = `${topic[1]} for ${['Robust Reasoning', 'Domain Transfer', 'Open Evaluation', 'Human Feedback', 'Efficient Deployment'][i]}`;
    const citations = citationsFor(year, i, i === 0 ? 2600 : 0);
    nodes.push({
      id,
      title,
      year,
      abstract: `A synthetic ${topic[1].toLowerCase()} study focusing on ${topic[2][i % topic[2].length]} and its downstream impact on LLM research.`,
      authors: pickAuthors(year + i),
      keywords: topic[2],
      topic: topic[0],
      citations_count: citations,
      influential_citations_count: Math.round(citations * (0.08 + (i % 4) * 0.03)),
      venue: venues[(year + i) % venues.length],
      institution: inst.institution,
      country: inst.country,
      community: inst.community,
      org_type: inst.org_type,
      pagerank: Number((0.004 + citations / 1600000).toFixed(4)),
      collaboration_breadth: Number((0.25 + ((year + i) % 10) * 0.047).toFixed(2))
    });
  }
}

nodes.sort((a, b) => a.year - b.year || b.citations_count - a.citations_count);

const edges = [];
function addEdge(source, target, context) {
  if (source === target) return;
  if (edges.some((edge) => edge.source === source && edge.target === target)) return;
  edges.push({ source, target, context });
}

const byTopic = new Map();
nodes.forEach((node) => {
  if (!byTopic.has(node.topic)) byTopic.set(node.topic, []);
  byTopic.get(node.topic).push(node);
});

nodes.forEach((node, index) => {
  const older = nodes
    .filter((candidate) => candidate.year < node.year)
    .sort((a, b) => {
      const sameTopic = Number(b.topic === node.topic) - Number(a.topic === node.topic);
      if (sameTopic) return sameTopic;
      return b.citations_count - a.citations_count;
    });
  older.slice(0, 2 + (index % 3)).forEach((target) => {
    addEdge(node.id, target.id, `Builds on ${target.topic} ideas for ${node.topic} research.`);
  });
});

[
  ['p2014_seq2seq', 'p2013_word2vec'],
  ['p2015_attention', 'p2014_seq2seq'],
  ['p2017_transformer', 'p2015_attention'],
  ['p2018_bert', 'p2017_transformer'],
  ['p2018_gpt', 'p2017_transformer'],
  ['p2020_gpt3', 'p2018_gpt'],
  ['p2022_instructgpt', 'p2020_gpt3'],
  ['p2024_rag', 'p2020_gpt3'],
  ['p2025_multimodal_agent', 'p2021_clip'],
  ['p2026_world_model_agent', 'p2025_multimodal_agent']
].forEach(([source, target]) => addEdge(source, target, 'Synthetic canonical influence link.'));

const keywordBase = {
  word2vec: [150, 160, 140, 120, 92, 70, 58, 48, 40, 32, 25, 20, 15, 12],
  lstm: [90, 130, 155, 170, 150, 125, 98, 76, 58, 45, 36, 30, 24, 20],
  attention: [18, 28, 55, 95, 155, 210, 230, 205, 182, 160, 138, 120, 105, 95],
  transformer: [0, 0, 8, 18, 78, 170, 245, 310, 350, 395, 430, 460, 480, 500],
  bert: [0, 0, 0, 0, 0, 210, 310, 285, 260, 230, 205, 185, 165, 150],
  gpt: [0, 0, 0, 0, 20, 70, 125, 250, 305, 380, 520, 610, 660, 700],
  rlhf: [0, 0, 0, 0, 0, 0, 8, 18, 42, 115, 260, 330, 360, 390],
  rag: [0, 0, 0, 0, 0, 0, 12, 22, 45, 80, 160, 320, 410, 470],
  multimodal: [0, 0, 0, 0, 5, 18, 42, 75, 135, 210, 300, 430, 520, 590],
  agent: [0, 0, 0, 0, 0, 0, 5, 12, 30, 64, 140, 310, 520, 680],
  moe: [0, 0, 0, 8, 16, 25, 40, 72, 150, 220, 240, 260, 310, 350],
  small_llm: [0, 0, 0, 0, 0, 0, 0, 8, 20, 45, 110, 230, 360, 430]
};

const years = Array.from({ length: 14 }, (_, idx) => 2013 + idx);
const keywordTrends = Object.entries(keywordBase).flatMap(([keyword, values]) =>
  years.map((year, idx) => ({
    keyword,
    year,
    count: values[idx] + ((idx * 7 + keyword.length * 3) % 18)
  }))
);

const instMetrics = new Map(institutions.map((inst) => [inst.institution, { papers: 0, citations: 0, pagerank: 0 }]));
nodes.forEach((node) => {
  const stats = instMetrics.get(node.institution);
  stats.papers += 1;
  stats.citations += node.citations_count;
  stats.pagerank += node.pagerank;
});

institutions.forEach((inst) => {
  const stats = instMetrics.get(inst.institution);
  inst.papers_count = stats.papers;
  inst.citations_count = stats.citations;
  inst.avg_pagerank = Number((stats.pagerank / Math.max(stats.papers, 1)).toFixed(4));
  inst.collaboration_breadth = Number((0.35 + (stats.papers % 8) * 0.07).toFixed(2));
  inst.influence_score = Math.round(Math.min(98, 35 + Math.sqrt(stats.citations) / 8 + stats.papers * 1.5));
});

const phases = [
  {
    id: 'phase_foundation',
    label: '2013-2017 Representation and Sequence Modeling',
    start_year: 2013,
    end_year: 2017,
    summary: 'Word embeddings, recurrent sequence models, and attention mechanisms form the technical base.',
    peak_keywords: ['word2vec', 'lstm', 'attention'],
    accent_color: '#64748b'
  },
  {
    id: 'phase_boom',
    label: '2018-2022 Pretraining and Scaling',
    start_year: 2018,
    end_year: 2022,
    summary: 'Transformer-based pretraining and scaling laws become the dominant research pattern.',
    peak_keywords: ['transformer', 'bert', 'gpt', 'moe'],
    accent_color: '#d97706'
  },
  {
    id: 'phase_agentic',
    label: '2023-2026 Alignment, Retrieval, Multimodality, and Agents',
    start_year: 2023,
    end_year: 2026,
    summary: 'Research shifts toward alignment, tool use, retrieval augmentation, multimodal models, and agents.',
    peak_keywords: ['rlhf', 'rag', 'multimodal', 'agent', 'small_llm'],
    accent_color: '#176b87'
  }
];

const butterflyPaths = [
  {
    source: 'p2013_word2vec',
    target: 'p2026_world_model_agent',
    path: ['p2013_word2vec', 'p2014_seq2seq', 'p2015_attention', 'p2017_transformer', 'p2020_gpt3', 'p2025_multimodal_agent', 'p2026_world_model_agent']
  },
  {
    source: 'p2017_transformer',
    target: 'p2024_rag',
    path: ['p2017_transformer', 'p2018_gpt', 'p2020_gpt3', 'p2024_rag']
  }
];

const csvHeaders = [
  'id',
  'title',
  'year',
  'authors',
  'topic',
  'citations_count',
  'venue',
  'institution',
  'country'
];
const csv = [
  csvHeaders.join(','),
  ...nodes.map((node) =>
    csvHeaders
      .map((key) => {
        const value = key === 'authors' ? node.authors.join('; ') : node[key];
        return `"${String(value).replaceAll('"', '""')}"`;
      })
      .join(',')
  )
].join('\n');

function writeJson(file, value) {
  fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

writeJson('nodes.json', nodes);
writeJson('edges.json', edges);
writeJson('keyword_trends.json', keywordTrends);
writeJson('institutions_geo.json', institutions);
writeJson('phases.json', phases);
writeJson('butterfly_paths.json', butterflyPaths);
fs.writeFileSync(path.join(outDir, 'nodes.csv'), `${csv}\n`, 'utf8');

console.log(`Generated ${nodes.length} papers, ${edges.length} edges, ${institutions.length} institutions.`);
