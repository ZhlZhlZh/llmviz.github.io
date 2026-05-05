const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.semanticscholar.org/graph/v1';
const OUT_DIR = path.join(__dirname, '..', 'data', 'processed');
const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');

const CONFIG = {
	query: process.env.S2_QUERY || 'large language model OR LLM OR transformer OR GPT OR "language model"',
	yearStart: Number(process.env.S2_YEAR_START || 2013),
	yearEnd: Number(process.env.S2_YEAR_END || 2026),
	limit: Number(process.env.S2_LIMIT || 500),
	batchSize: Number(process.env.S2_BATCH_SIZE || 100),
	delayMs: Number(process.env.S2_DELAY_MS || 1100)
};

const API_KEY = process.env.S2_API_KEY;
if (!API_KEY) {
	console.error('Missing S2_API_KEY. Set it in your environment before running this script.');
	process.exit(1);
}

if (typeof fetch !== 'function') {
	console.error('This script requires Node.js 18+ (global fetch).');
	process.exit(1);
}

function ensureDir(dir) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;
async function rateLimit() {
	const elapsed = Date.now() - lastRequestAt;
	if (elapsed < CONFIG.delayMs) {
		await sleep(CONFIG.delayMs - elapsed);
	}
	lastRequestAt = Date.now();
}

async function s2Fetch(url, options = {}) {
	await rateLimit();
	const headers = {
		'x-api-key': API_KEY,
		...(options.headers || {})
	};
	const response = await fetch(url, { ...options, headers });
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`S2 request failed (${response.status}): ${text.slice(0, 300)}`);
	}
	return response.json();
}

function writeJson(file, value) {
	ensureDir(OUT_DIR);
	fs.writeFileSync(path.join(OUT_DIR, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeRaw(file, value) {
	ensureDir(RAW_DIR);
	fs.writeFileSync(path.join(RAW_DIR, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const KNOWN_INSTITUTIONS = [
	['OpenAI', 'San Francisco', 'USA', 37.7749, -122.4194, 'english', 'research_lab'],
	['Google Research', 'Mountain View', 'USA', 37.422, -122.0841, 'english', 'company'],
	['Google DeepMind', 'London', 'UK', 51.5074, -0.1278, 'english', 'company'],
	['DeepMind', 'London', 'UK', 51.5074, -0.1278, 'english', 'company'],
	['Meta AI', 'Menlo Park', 'USA', 37.4848, -122.1484, 'english', 'company'],
	['Microsoft Research', 'Redmond', 'USA', 47.674, -122.1215, 'english', 'company'],
	['Amazon', 'Seattle', 'USA', 47.6062, -122.3321, 'english', 'company'],
	['Stanford University', 'Stanford', 'USA', 37.4275, -122.1697, 'english', 'university'],
	['UC Berkeley', 'Berkeley', 'USA', 37.8715, -122.273, 'english', 'university'],
	['MIT', 'Cambridge', 'USA', 42.3601, -71.0942, 'english', 'university'],
	['Carnegie Mellon University', 'Pittsburgh', 'USA', 40.4433, -79.9436, 'english', 'university'],
	['Harvard University', 'Cambridge', 'USA', 42.377, -71.1167, 'english', 'university'],
	['Princeton University', 'Princeton', 'USA', 40.343, -74.6514, 'english', 'university'],
	['University of Oxford', 'Oxford', 'UK', 51.7548, -1.2544, 'english', 'university'],
	['University of Cambridge', 'Cambridge', 'UK', 52.2043, 0.1218, 'english', 'university'],
	['ETH Zurich', 'Zurich', 'Switzerland', 47.3769, 8.5417, 'english', 'university'],
	['Inria', 'Paris', 'France', 48.8566, 2.3522, 'english', 'research_lab'],
	['University of Toronto', 'Toronto', 'Canada', 43.6629, -79.3957, 'english', 'university'],
	['Mila', 'Montreal', 'Canada', 45.5019, -73.5674, 'english', 'research_lab'],
	['Tsinghua University', 'Beijing', 'China', 40.0007, 116.3269, 'chinese', 'university'],
	['Peking University', 'Beijing', 'China', 39.9928, 116.3055, 'chinese', 'university'],
	['Zhejiang University', 'Hangzhou', 'China', 30.2638, 120.1236, 'chinese', 'university'],
	['Shanghai AI Lab', 'Shanghai', 'China', 31.2304, 121.4737, 'chinese', 'research_lab'],
	['Beijing Academy of AI', 'Beijing', 'China', 39.9042, 116.4074, 'chinese', 'research_lab'],
	['Huawei', 'Shenzhen', 'China', 22.5431, 114.0579, 'chinese', 'company'],
	['Alibaba', 'Hangzhou', 'China', 30.2741, 120.1551, 'chinese', 'company'],
	['Baidu', 'Beijing', 'China', 39.9042, 116.4074, 'chinese', 'company'],
	['Tencent', 'Shenzhen', 'China', 22.5431, 114.0579, 'chinese', 'company'],
	['National University of Singapore', 'Singapore', 'Singapore', 1.2966, 103.7764, 'english', 'university'],
	['University of Tokyo', 'Tokyo', 'Japan', 35.7126, 139.761, 'english', 'university']
].map(([institution, city, country, lat, lng, community, org_type]) => ({
	institution,
	city,
	country,
	lat,
	lng,
	community,
	org_type
}));

const KNOWN_BY_KEY = new Map(
	KNOWN_INSTITUTIONS.map((item) => [item.institution.toLowerCase(), item])
);

function normalizeInstitutionName(name) {
	return String(name || '')
		.replace(/\s+/g, ' ')
		.replace(/\(.*?\)/g, '')
		.trim();
}

function matchKnownInstitution(name) {
	const normalized = normalizeInstitutionName(name).toLowerCase();
	if (!normalized) return null;
	if (KNOWN_BY_KEY.has(normalized)) return KNOWN_BY_KEY.get(normalized);
	for (const [key, value] of KNOWN_BY_KEY.entries()) {
		if (normalized.includes(key)) return value;
	}
	return null;
}

function guessOrgType(name) {
	const normalized = name.toLowerCase();
	if (/(university|college|institute of technology|school|academy)/.test(normalized)) return 'university';
	if (/(lab|laboratory|research|inria)/.test(normalized)) return 'research_lab';
	if (/(openai|google|deepmind|meta|microsoft|amazon|apple|huawei|alibaba|baidu|tencent)/.test(normalized)) {
		return 'company';
	}
	return 'research_lab';
}

function guessCommunity(country) {
	return country === 'China' ? 'chinese' : 'english';
}

function resolveInstitution(affiliations, fallbackVenue) {
	const candidates = [];
	if (Array.isArray(affiliations)) {
		affiliations.forEach((item) => {
			if (typeof item === 'string') candidates.push(item);
			if (item && typeof item === 'object' && item.name) candidates.push(item.name);
		});
	}
	if (fallbackVenue) candidates.push(fallbackVenue);
	for (const candidate of candidates) {
		const normalized = normalizeInstitutionName(candidate);
		if (!normalized) continue;
		const known = matchKnownInstitution(normalized);
		if (known) return { ...known, institution: known.institution };
	}
	const fallback = normalizeInstitutionName(candidates[0] || 'Unknown Institution');
	const known = matchKnownInstitution(fallback);
	if (known) return { ...known, institution: known.institution };
	return {
		institution: fallback || 'Unknown Institution',
		city: 'Unknown',
		country: 'Unknown',
		lat: 0,
		lng: 0,
		community: 'english',
		org_type: guessOrgType(fallback || 'Unknown')
	};
}

function topicFromFields(fields) {
	if (!fields || !fields.length) return 'other';
	const primary = String(fields[0]).toLowerCase();
	if (primary.includes('language')) return 'language';
	if (primary.includes('machine learning')) return 'ml';
	if (primary.includes('computer vision')) return 'vision';
	if (primary.includes('natural language')) return 'nlp';
	return primary.replace(/\s+/g, '_');
}

function pickKeywords(fields) {
	if (!fields || !fields.length) return [];
	return fields.slice(0, 3).map((item) => String(item).toLowerCase());
}

async function fetchPapers() {
	const perPage = 100;
	let offset = 0;
	const all = [];
	while (all.length < CONFIG.limit) {
		const remaining = CONFIG.limit - all.length;
		const limit = Math.min(perPage, remaining);
		const params = new URLSearchParams({
			query: CONFIG.query,
			limit: String(limit),
			offset: String(offset),
			year: `${CONFIG.yearStart}-${CONFIG.yearEnd}`,
			fields: [
				'paperId',
				'title',
				'year',
				'abstract',
				'authors',
				'authors.affiliations',
				'venue',
				'publicationVenue',
				'fieldsOfStudy',
				's2FieldsOfStudy',
				'citationCount',
				'influentialCitationCount'
			].join(',')
		});
		const data = await s2Fetch(`${API_BASE}/paper/search?${params.toString()}`);
		if (!data?.data?.length) break;
		all.push(...data.data);
		offset += data.data.length;
		if (data.data.length < limit) break;
	}
	return all.slice(0, CONFIG.limit);
}

async function fetchReferences(paperIds) {
	const referencesById = new Map();
	const batches = [];
	for (let i = 0; i < paperIds.length; i += CONFIG.batchSize) {
		batches.push(paperIds.slice(i, i + CONFIG.batchSize));
	}

	for (const batch of batches) {
		const params = new URLSearchParams({
			fields: 'paperId,references.paperId'
		});
		const data = await s2Fetch(`${API_BASE}/paper/batch?${params.toString()}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids: batch })
		});
		data.forEach((item) => {
			referencesById.set(item.paperId, item.references || []);
		});
	}
	return referencesById;
}

function buildKeywordTrends(nodes) {
	const years = [];
	for (let year = CONFIG.yearStart; year <= CONFIG.yearEnd; year += 1) {
		years.push(year);
	}

	const counts = new Map();
	nodes.forEach((node) => {
		const keywords = node.keywords?.length ? node.keywords : [node.topic];
		keywords.forEach((keyword) => {
			if (!counts.has(keyword)) counts.set(keyword, new Map());
			const byYear = counts.get(keyword);
			byYear.set(node.year, (byYear.get(node.year) || 0) + 1);
		});
	});

	const totals = Array.from(counts.entries())
		.map(([keyword, byYear]) => ({
			keyword,
			total: years.reduce((sum, year) => sum + (byYear.get(year) || 0), 0),
			byYear
		}))
		.sort((a, b) => b.total - a.total)
		.slice(0, 12);

	return totals.flatMap((item) =>
		years.map((year) => ({
			keyword: item.keyword,
			year,
			count: item.byYear.get(year) || 0
		}))
	);
}

function buildInstitutions(nodes) {
	const stats = new Map();
	nodes.forEach((node) => {
		if (!stats.has(node.institution)) {
			stats.set(node.institution, { papers: 0, citations: 0, pagerank: 0 });
		}
		const record = stats.get(node.institution);
		record.papers += 1;
		record.citations += node.citations_count;
		record.pagerank += node.pagerank || 0;
	});

	return Array.from(stats.entries()).map(([institution, record], index) => {
		const geo = matchKnownInstitution(institution) || {
			institution,
			city: 'Unknown',
			country: 'Unknown',
			lat: 0,
			lng: 0,
			community: guessCommunity('Unknown'),
			org_type: guessOrgType(institution)
		};
		return {
			id: `inst_${institution.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${index}`,
			institution: geo.institution || institution,
			city: geo.city,
			country: geo.country,
			lat: geo.lat,
			lng: geo.lng,
			community: geo.community || guessCommunity(geo.country),
			org_type: geo.org_type || guessOrgType(institution),
			papers_count: record.papers,
			citations_count: record.citations,
			avg_pagerank: Number((record.pagerank / Math.max(record.papers, 1)).toFixed(4)),
			collaboration_breadth: Number((0.35 + (record.papers % 8) * 0.06).toFixed(2)),
			influence_score: Math.round(Math.min(98, 35 + Math.sqrt(record.citations) / 8 + record.papers * 1.3))
		};
	});
}

function buildPhases() {
	return [
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
}

async function main() {
	console.log(`Fetching ${CONFIG.limit} papers (${CONFIG.yearStart}-${CONFIG.yearEnd})...`);
	const papers = await fetchPapers();
	writeRaw('s2-search.json', papers);

	const nodes = papers
		.filter((paper) => paper.paperId && paper.year)
		.map((paper, index) => {
			const fields = paper.s2FieldsOfStudy?.length
				? paper.s2FieldsOfStudy.map((item) => item.category || item.name || item).filter(Boolean)
				: paper.fieldsOfStudy || [];
			const venueName = paper.publicationVenue?.name || paper.venue || 'Unknown Venue';
			const affiliations = (paper.authors || []).flatMap((author) => author.affiliations || []);
			const resolved = resolveInstitution(affiliations, venueName);
			return {
				id: paper.paperId,
				title: paper.title || 'Untitled',
				year: paper.year,
				abstract: paper.abstract || '',
				authors: (paper.authors || []).map((author) => author.name).filter(Boolean),
				keywords: pickKeywords(fields),
				topic: topicFromFields(fields),
				citations_count: paper.citationCount || 0,
				influential_citations_count: paper.influentialCitationCount || 0,
				venue: venueName,
				institution: resolved.institution,
				country: resolved.country,
				community: resolved.community || guessCommunity(resolved.country),
				org_type: resolved.org_type,
				pagerank: Number((0.004 + (paper.citationCount || 0) / 1500000).toFixed(4)),
				collaboration_breadth: Number((0.28 + (index % 9) * 0.05).toFixed(2))
			};
		});

	const paperIds = nodes.map((node) => node.id);
	console.log('Fetching references for edges...');
	const referencesById = await fetchReferences(paperIds);
	writeRaw('s2-references.json', Array.from(referencesById.entries()));

	const idSet = new Set(paperIds);
	const edgeSet = new Set();
	const edges = [];
	referencesById.forEach((refs, sourceId) => {
		(refs || []).forEach((ref) => {
			const targetId = ref.paperId || ref;
			if (!idSet.has(targetId) || sourceId === targetId) return;
			const key = `${sourceId}__${targetId}`;
			if (edgeSet.has(key)) return;
			edgeSet.add(key);
			edges.push({ source: sourceId, target: targetId, context: 'Reference link' });
		});
	});

	const keywordTrends = buildKeywordTrends(nodes);
	const institutions = buildInstitutions(nodes);
	const phases = buildPhases();

	writeJson('nodes.json', nodes);
	writeJson('edges.json', edges);
	writeJson('keyword_trends.json', keywordTrends);
	writeJson('institutions_geo.json', institutions);
	writeJson('phases.json', phases);

	console.log(`Done. Papers: ${nodes.length}, Edges: ${edges.length}, Institutions: ${institutions.length}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
