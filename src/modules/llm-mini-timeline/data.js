// Timeline data adapted from https://github.com/Michaelgathara/llm-timeline
// (MIT License). Content was rephrased for compliance with licensing restrictions.
// This file powers the compact LLM timeline chart shown in the site header.

export const timelineBranches = [
  { id: 'foundation', name: 'Foundation', color: '#4285F4' },
  { id: 'decoder-only', name: 'Decoder-Only', color: '#EA4335' },
  { id: 'encoder-only', name: 'Encoder-Only', color: '#FBBC05' },
  { id: 'encoder-decoder', name: 'Encoder-Decoder', color: '#34A853' },
  { id: 'mixture-of-experts', name: 'Mixture-of-Experts', color: '#8E44AD' },
  { id: 'open-source', name: 'Open-Source', color: '#3498DB' },
  { id: 'alignment', name: 'Alignment', color: '#E67E22' },
  { id: 'theory', name: 'Theory', color: '#1ABC9C' },
  { id: 'multimodal', name: 'Multimodal', color: '#9B59B6' },
  { id: 'hybrid', name: 'Hybrid', color: '#7F8C8D' }
];

export const timelineData = [
  {
    id: 'transformer',
    title: 'Attention Is All You Need',
    year: 2017, month: 6,
    branch: 'foundation',
    description: 'Vaswani et al. 提出 Transformer，用自注意力替代循环结构，奠定后续 LLM 基石。',
    link: 'https://arxiv.org/abs/1706.03762'
  },
  {
    id: 'gpt1',
    title: 'GPT-1',
    year: 2018, month: 6,
    branch: 'decoder-only',
    parentIds: ['transformer'],
    description: 'OpenAI 的首代生成式预训练 Transformer，确立“预训练+微调”的迁移范式。',
    modelSize: '117M',
    link: 'https://cdn.openai.com/research-covers/language-unsupervised/language_understanding_paper.pdf'
  },
  {
    id: 'bert',
    title: 'BERT',
    year: 2018, month: 10,
    branch: 'encoder-only',
    parentIds: ['transformer'],
    description: 'Google 通过双向自注意力与掩码语言建模显著提升了语义理解。',
    modelSize: '340M',
    link: 'https://arxiv.org/abs/1810.04805'
  },
  {
    id: 'gpt2',
    title: 'GPT-2',
    year: 2019, month: 2,
    branch: 'decoder-only',
    parentIds: ['gpt1'],
    description: '以 10× 规模验证了“更大模型 + 更多数据”带来的零样本能力。',
    modelSize: '1.5B'
  },
  {
    id: 't5',
    title: 'T5',
    year: 2019, month: 10,
    branch: 'encoder-decoder',
    parentIds: ['transformer'],
    description: '将所有 NLP 任务统一为 text-to-text 的通用框架。',
    modelSize: '最大 11B',
    link: 'https://arxiv.org/abs/1910.10683'
  },
  {
    id: 'scaling-laws',
    title: 'Scaling Laws',
    year: 2020, month: 1,
    branch: 'theory',
    parentIds: ['gpt2'],
    description: 'Kaplan 等给出模型-数据-算力的幂律关系，成为后续规模决策的依据。',
    link: 'https://arxiv.org/abs/2001.08361'
  },
  {
    id: 'gpt3',
    title: 'GPT-3',
    year: 2020, month: 5,
    branch: 'decoder-only',
    parentIds: ['gpt2'],
    description: '175B 规模 + 少样本上下文学习，确立 in-context learning 范式。',
    modelSize: '175B',
    link: 'https://arxiv.org/abs/2005.14165'
  },
  {
    id: 'rag',
    title: 'Retrieval-Augmented Generation',
    year: 2020, month: 9,
    branch: 'hybrid',
    parentIds: ['transformer'],
    description: '将外部检索与生成结合，改善事实性与知识时效性。',
    link: 'https://arxiv.org/abs/2005.11401'
  },
  {
    id: 'switch-transformer',
    title: 'Switch Transformer (MoE)',
    year: 2021, month: 1,
    branch: 'mixture-of-experts',
    parentIds: ['transformer'],
    description: '用稀疏专家混合把参数量推到万亿级，保持训练可行性。',
    modelSize: '最大 1.6T (稀疏)',
    link: 'https://arxiv.org/abs/2101.03961'
  },
  {
    id: 'clip',
    title: 'CLIP',
    year: 2021, month: 2,
    branch: 'multimodal',
    parentIds: ['gpt3'],
    description: '用对比学习对齐文本与图像表示，成为后续多模态系统的底座。',
    link: 'https://arxiv.org/abs/2103.00020'
  },
  {
    id: 'megatron',
    title: 'Megatron-Turing NLG',
    year: 2021, month: 10,
    branch: 'decoder-only',
    parentIds: ['gpt3'],
    description: '微软与 NVIDIA 合作的 530B 级训练工程，推动 3D 并行成熟。',
    modelSize: '530B'
  },
  {
    id: 'flan',
    title: 'FLAN Instruction Tuning',
    year: 2021, month: 10,
    branch: 'alignment',
    parentIds: ['gpt3'],
    description: '在自然语言指令任务上微调，显著改善零样本泛化。',
    link: 'https://arxiv.org/abs/2109.01652'
  },
  {
    id: 'instructgpt',
    title: 'InstructGPT (RLHF)',
    year: 2022, month: 1,
    branch: 'alignment',
    parentIds: ['gpt3'],
    description: '用人类反馈强化学习对齐偏好，为 ChatGPT 铺路。',
    link: 'https://arxiv.org/abs/2203.02155'
  },
  {
    id: 'chinchilla',
    title: 'Chinchilla',
    year: 2022, month: 3,
    branch: 'theory',
    parentIds: ['scaling-laws'],
    description: 'DeepMind 指出参数与 token 的最优配比约为 1:20，重塑训练预算分配。',
    modelSize: '70B',
    link: 'https://arxiv.org/abs/2203.15556'
  },
  {
    id: 'palm',
    title: 'PaLM',
    year: 2022, month: 4,
    branch: 'decoder-only',
    parentIds: ['gpt3'],
    description: 'Google Pathways 平台训练的 540B 密集模型，强化推理与代码。',
    modelSize: '540B',
    link: 'https://arxiv.org/abs/2204.02311'
  },
  {
    id: 'opt',
    title: 'OPT',
    year: 2022, month: 5,
    branch: 'open-source',
    parentIds: ['gpt3'],
    description: 'Meta 公开 GPT-3 同级别权重，推动开放研究。',
    modelSize: '175B',
    link: 'https://arxiv.org/abs/2205.01068'
  },
  {
    id: 'midjourney',
    title: 'Midjourney',
    year: 2022, month: 7,
    branch: 'multimodal',
    parentIds: ['clip'],
    description: '以艺术风格为核心的文本到图像生成服务。'
  },
  {
    id: 'chatgpt',
    title: 'ChatGPT',
    year: 2022, month: 11,
    branch: 'alignment',
    parentIds: ['instructgpt'],
    description: '消费级对话界面让大模型进入公众视野。',
    link: 'https://openai.com/blog/chatgpt'
  },
  {
    id: 'constitutional-ai',
    title: 'Constitutional AI',
    year: 2022, month: 12,
    branch: 'alignment',
    parentIds: ['instructgpt'],
    description: 'Anthropic 用 AI 反馈代替部分人类反馈，规模化对齐。',
    link: 'https://arxiv.org/abs/2212.08073'
  },
  {
    id: 'llama1',
    title: 'LLaMA 1',
    year: 2023, month: 2,
    branch: 'open-source',
    parentIds: ['opt', 'chinchilla'],
    description: '按 Chinchilla 比例训练的中等规模开源模型，引爆开源生态。',
    modelSize: '7B–65B',
    link: 'https://arxiv.org/abs/2302.13971'
  },
  {
    id: 'alpaca',
    title: 'Stanford Alpaca',
    year: 2023, month: 3,
    branch: 'open-source',
    parentIds: ['llama1', 'instructgpt'],
    description: '基于 LLaMA-7B 指令微调，展示小模型也能接近 ChatGPT 交互。',
    modelSize: '7B',
    link: 'https://crfm.stanford.edu/2023/03/13/alpaca.html'
  },
  {
    id: 'claude1',
    title: 'Claude 1',
    year: 2023, month: 3,
    branch: 'decoder-only',
    parentIds: ['constitutional-ai'],
    description: 'Anthropic 首个商用模型，采用 Constitutional AI 路线。',
    link: 'https://www.anthropic.com/index/introducing-claude'
  },
  {
    id: 'gpt4',
    title: 'GPT-4',
    year: 2023, month: 3,
    branch: 'multimodal',
    parentIds: ['instructgpt', 'gpt3'],
    description: '支持图像输入的多模态模型，大幅提升推理与考试表现。',
    link: 'https://arxiv.org/abs/2303.08774'
  },
  {
    id: 'palm2',
    title: 'PaLM 2',
    year: 2023, month: 5,
    branch: 'decoder-only',
    parentIds: ['palm'],
    description: '更小但更强的多语言推理模型，驱动 Google Bard。',
    link: 'https://ai.google/discover/palm2/'
  },
  {
    id: 'claude2',
    title: 'Claude 2',
    year: 2023, month: 7,
    branch: 'decoder-only',
    parentIds: ['claude1'],
    description: '提供 100K token 的超长上下文。',
    link: 'https://www.anthropic.com/news/claude-2'
  },
  {
    id: 'llama2',
    title: 'LLaMA 2',
    year: 2023, month: 7,
    branch: 'open-source',
    parentIds: ['llama1'],
    description: '带有商业许可的 Meta 开源模型，成为开源事实标准。',
    modelSize: '7B / 13B / 70B',
    link: 'https://arxiv.org/abs/2307.09288'
  },
  {
    id: 'falcon',
    title: 'Falcon',
    year: 2023, month: 9,
    branch: 'open-source',
    parentIds: ['gpt3'],
    description: 'TII 推出的多查询注意力高质量开源权重。',
    modelSize: '7B / 40B / 180B',
    link: 'https://falconllm.tii.ae/'
  },
  {
    id: 'mistral',
    title: 'Mistral 7B & Mixtral',
    year: 2023, month: 9,
    branch: 'open-source',
    parentIds: ['llama2'],
    description: '滑动窗口注意力与 MoE，用更小模型挑战更大模型。',
    modelSize: '7B / 8×7B MoE',
    link: 'https://mistral.ai/news/announcing-mistral-7b/'
  },
  {
    id: 'phi',
    title: 'Microsoft Phi',
    year: 2023, month: 9,
    branch: 'open-source',
    parentIds: ['llama1'],
    description: '用教科书级合成数据训练的小而强模型。',
    modelSize: '1.3B–3.8B',
    link: 'https://arxiv.org/abs/2309.05463'
  },
  {
    id: 'dalle3',
    title: 'DALL·E 3',
    year: 2023, month: 10,
    branch: 'multimodal',
    parentIds: ['gpt4'],
    description: '结合 GPT-4 的提示理解，显著提升复杂提示的一致性。',
    link: 'https://openai.com/dall-e-3'
  },
  {
    id: 'gpt4_turbo',
    title: 'GPT-4 Turbo',
    year: 2023, month: 11,
    branch: 'multimodal',
    parentIds: ['gpt4'],
    description: '128K 上下文、更低延迟与成本的 GPT-4 变体。',
    link: 'https://openai.com/blog/new-models-and-developer-products-announced-at-devday'
  },
  {
    id: 'gemini',
    title: 'Gemini',
    year: 2023, month: 12,
    branch: 'multimodal',
    parentIds: ['palm'],
    description: 'Google DeepMind 面向规划与多模态的旗舰模型。',
    link: 'https://deepmind.google/technologies/gemini/'
  },
  {
    id: 'gemini-nano',
    title: 'Gemini Nano',
    year: 2023, month: 12,
    branch: 'decoder-only',
    parentIds: ['gemini'],
    description: '为端侧设备优化的高效小模型。',
    modelSize: '1.8B / 3.25B'
  },
  {
    id: 'mamba',
    title: 'Mamba (SSM)',
    year: 2023, month: 12,
    branch: 'foundation',
    parentIds: ['transformer'],
    description: '基于选择性状态空间的线性复杂度序列模型。',
    modelSize: '2.8B',
    link: 'https://arxiv.org/abs/2312.00752'
  },
  {
    id: 'sora',
    title: 'Sora',
    year: 2024, month: 2,
    branch: 'multimodal',
    parentIds: ['gpt4'],
    description: '可生成长达 60 秒物理合理视频的文本到视频模型。',
    link: 'https://openai.com/sora'
  },
  {
    id: 'claude3',
    title: 'Claude 3 (Opus/Sonnet/Haiku)',
    year: 2024, month: 3,
    branch: 'decoder-only',
    parentIds: ['claude2'],
    description: '三档模型兼顾能力与成本，多模态与推理显著加强。',
    link: 'https://www.anthropic.com/news/claude-3-family'
  },
  {
    id: 'llama3',
    title: 'LLaMA 3',
    year: 2024, month: 4,
    branch: 'open-source',
    parentIds: ['llama2'],
    description: 'Meta 的 8B–405B 系列，接近当时闭源顶尖水平。',
    modelSize: '8B / 70B / 405B',
    link: 'https://ai.meta.com/blog/meta-llama-3/'
  },
  {
    id: 'gpt4o',
    title: 'GPT-4o',
    year: 2024, month: 8,
    branch: 'multimodal',
    parentIds: ['gpt4'],
    description: '原生融合文本、图像、音频的 Omni 模型，更快更便宜。',
    link: 'https://openai.com/index/gpt-4o-system-card/'
  },
  {
    id: 'claude3_5',
    title: 'Claude 3.5',
    year: 2024, month: 8,
    branch: 'decoder-only',
    parentIds: ['claude3'],
    description: '中期更新，强化推理、工具使用与多模态。',
    link: 'https://www.anthropic.com/claude/haiku'
  },
  {
    id: 'claude3_7',
    title: 'Claude 3.7 Sonnet',
    year: 2025, month: 2,
    branch: 'decoder-only',
    parentIds: ['claude3_5'],
    description: '具备可延长思考的“推理模式”，强化数学与编程。',
    link: 'https://www.anthropic.com/news/claude-3-7-sonnet'
  },
  {
    id: 'llama4',
    title: 'LLaMA 4',
    year: 2025, month: 4,
    branch: 'mixture-of-experts',
    parentIds: ['llama3', 'switch-transformer'],
    description: '原生多模态 + MoE，最长 10M token 上下文。',
    modelSize: 'Scout 109B / Maverick 400B',
    link: 'https://ai.meta.com/blog/llama-4-multimodal-intelligence/'
  }
];
