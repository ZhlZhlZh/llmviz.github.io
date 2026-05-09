/**
 * Rebuild institutions_geo.json from nodes.json
 * 
 * - Aggregates papers_count and citations_count from nodes.json
 * - Preserves existing geo data (lat, lng, city, country, org_type, community)
 * - Adds new institutions with curated geo coordinates
 * - Recalculates influence_score
 */
const fs = require('fs');
const path = require('path');

const nodesPath = path.join(__dirname, '..', 'data', 'processed', 'nodes.json');
const geoPath = path.join(__dirname, '..', 'data', 'processed', 'institutions_geo.json');

const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
const existingGeo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

// Build lookup of existing geo data
const existingByName = new Map(existingGeo.map(g => [g.institution, g]));

// Curated geo data for institutions that might appear in nodes but not in existing geo
const GEO_DATABASE = {
  'Google Research': { city: 'Mountain View', country: 'USA', lat: 37.422, lng: -122.0841, community: 'english', org_type: 'company' },
  'Google': { city: 'Mountain View', country: 'USA', lat: 37.422, lng: -122.0841, community: 'english', org_type: 'company' },
  'Google DeepMind': { city: 'London', country: 'UK', lat: 51.5074, lng: -0.1278, community: 'english', org_type: 'company' },
  'DeepMind': { city: 'London', country: 'UK', lat: 51.5074, lng: -0.1278, community: 'english', org_type: 'company' },
  'OpenAI': { city: 'San Francisco', country: 'USA', lat: 37.7749, lng: -122.4194, community: 'english', org_type: 'research_lab' },
  'Anthropic': { city: 'San Francisco', country: 'USA', lat: 37.7897, lng: -122.3972, community: 'english', org_type: 'research_lab' },
  'Meta AI': { city: 'Menlo Park', country: 'USA', lat: 37.4848, lng: -122.1484, community: 'english', org_type: 'company' },
  'Facebook AI Research': { city: 'Menlo Park', country: 'USA', lat: 37.4848, lng: -122.1484, community: 'english', org_type: 'company' },
  'Microsoft': { city: 'Redmond', country: 'USA', lat: 47.674, lng: -122.1215, community: 'english', org_type: 'company' },
  'Microsoft Research': { city: 'Redmond', country: 'USA', lat: 47.674, lng: -122.1215, community: 'english', org_type: 'company' },
  'NVIDIA': { city: 'Santa Clara', country: 'USA', lat: 37.3861, lng: -121.9613, community: 'english', org_type: 'company' },
  'Hugging Face': { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.006, community: 'english', org_type: 'company' },
  'Mistral AI': { city: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522, community: 'english', org_type: 'company' },
  'Inflection AI': { city: 'Palo Alto', country: 'USA', lat: 37.4419, lng: -122.143, community: 'english', org_type: 'company' },
  'EleutherAI': { city: 'Remote', country: 'USA', lat: 37.7749, lng: -122.4194, community: 'english', org_type: 'research_lab' },
  'Allen Institute for AI': { city: 'Seattle', country: 'USA', lat: 47.6205, lng: -122.3493, community: 'english', org_type: 'research_lab' },
  'Cohere': { city: 'Toronto', country: 'Canada', lat: 43.6532, lng: -79.3832, community: 'english', org_type: 'company' },

  // Universities - North America
  'Stanford University': { city: 'Stanford', country: 'USA', lat: 37.4275, lng: -122.1697, community: 'english', org_type: 'university' },
  'UC Berkeley': { city: 'Berkeley', country: 'USA', lat: 37.8715, lng: -122.273, community: 'english', org_type: 'university' },
  'MIT': { city: 'Cambridge', country: 'USA', lat: 42.3601, lng: -71.0942, community: 'english', org_type: 'university' },
  'Carnegie Mellon University': { city: 'Pittsburgh', country: 'USA', lat: 40.4433, lng: -79.9436, community: 'english', org_type: 'university' },
  'Princeton University': { city: 'Princeton', country: 'USA', lat: 40.3431, lng: -74.6551, community: 'english', org_type: 'university' },
  'New York University': { city: 'New York', country: 'USA', lat: 40.7295, lng: -73.9965, community: 'english', org_type: 'university' },
  'Columbia University': { city: 'New York', country: 'USA', lat: 40.8075, lng: -73.9626, community: 'english', org_type: 'university' },
  'University of Washington': { city: 'Seattle', country: 'USA', lat: 47.6553, lng: -122.3035, community: 'english', org_type: 'university' },
  'University of Michigan': { city: 'Ann Arbor', country: 'USA', lat: 42.2780, lng: -83.7382, community: 'english', org_type: 'university' },
  'University of Illinois': { city: 'Champaign', country: 'USA', lat: 40.1020, lng: -88.2272, community: 'english', org_type: 'university' },
  'University of Maryland': { city: 'College Park', country: 'USA', lat: 38.9869, lng: -76.9426, community: 'english', org_type: 'university' },
  'University of Pennsylvania': { city: 'Philadelphia', country: 'USA', lat: 39.9522, lng: -75.1932, community: 'english', org_type: 'university' },
  'Harvard University': { city: 'Cambridge', country: 'USA', lat: 42.3770, lng: -71.1167, community: 'english', org_type: 'university' },
  'Yale University': { city: 'New Haven', country: 'USA', lat: 41.3163, lng: -72.9223, community: 'english', org_type: 'university' },
  'Georgia Institute of Technology': { city: 'Atlanta', country: 'USA', lat: 33.7756, lng: -84.3963, community: 'english', org_type: 'university' },
  'University of Southern California': { city: 'Los Angeles', country: 'USA', lat: 34.0224, lng: -118.2851, community: 'english', org_type: 'university' },
  'UCLA': { city: 'Los Angeles', country: 'USA', lat: 34.0689, lng: -118.4452, community: 'english', org_type: 'university' },
  'University of Texas at Austin': { city: 'Austin', country: 'USA', lat: 30.2849, lng: -97.7341, community: 'english', org_type: 'university' },
  'University of Wisconsin-Madison': { city: 'Madison', country: 'USA', lat: 43.0766, lng: -89.4125, community: 'english', org_type: 'university' },
  'University of Massachusetts': { city: 'Amherst', country: 'USA', lat: 42.3912, lng: -72.5267, community: 'english', org_type: 'university' },
  'Johns Hopkins University': { city: 'Baltimore', country: 'USA', lat: 39.3299, lng: -76.6205, community: 'english', org_type: 'university' },
  'University of Utah': { city: 'Salt Lake City', country: 'USA', lat: 40.7649, lng: -111.8421, community: 'english', org_type: 'university' },
  'Arizona State University': { city: 'Tempe', country: 'USA', lat: 33.4242, lng: -111.9281, community: 'english', org_type: 'university' },
  'Dartmouth College': { city: 'Hanover', country: 'USA', lat: 43.7044, lng: -72.2887, community: 'english', org_type: 'university' },
  'University of Toronto': { city: 'Toronto', country: 'Canada', lat: 43.6629, lng: -79.3957, community: 'english', org_type: 'university' },
  'Mila': { city: 'Montreal', country: 'Canada', lat: 45.5019, lng: -73.5674, community: 'english', org_type: 'research_lab' },
  'University of Waterloo': { city: 'Waterloo', country: 'Canada', lat: 43.4723, lng: -80.5449, community: 'english', org_type: 'university' },
  'McGill University': { city: 'Montreal', country: 'Canada', lat: 45.5048, lng: -73.5772, community: 'english', org_type: 'university' },
  'University of Alberta': { city: 'Edmonton', country: 'Canada', lat: 53.5232, lng: -113.5263, community: 'english', org_type: 'university' },
  'University of British Columbia': { city: 'Vancouver', country: 'Canada', lat: 49.2606, lng: -123.246, community: 'english', org_type: 'university' },

  // Universities - Europe
  'University of Oxford': { city: 'Oxford', country: 'UK', lat: 51.7548, lng: -1.2544, community: 'english', org_type: 'university' },
  'University of Cambridge': { city: 'Cambridge', country: 'UK', lat: 52.2043, lng: 0.1149, community: 'english', org_type: 'university' },
  'University College London': { city: 'London', country: 'UK', lat: 51.5246, lng: -0.1340, community: 'english', org_type: 'university' },
  'University of Edinburgh': { city: 'Edinburgh', country: 'UK', lat: 55.9445, lng: -3.1892, community: 'english', org_type: 'university' },
  'Imperial College London': { city: 'London', country: 'UK', lat: 51.4988, lng: -0.1749, community: 'english', org_type: 'university' },
  'ETH Zurich': { city: 'Zurich', country: 'Switzerland', lat: 47.3763, lng: 8.5481, community: 'english', org_type: 'university' },
  'EPFL': { city: 'Lausanne', country: 'Switzerland', lat: 46.5191, lng: 6.5668, community: 'english', org_type: 'university' },
  'Inria': { city: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522, community: 'english', org_type: 'research_lab' },
  'Max Planck Institute for Informatics': { city: 'Saarbrucken', country: 'Germany', lat: 49.2578, lng: 7.0423, community: 'english', org_type: 'research_lab' },
  'Technical University of Munich': { city: 'Munich', country: 'Germany', lat: 48.1497, lng: 11.5679, community: 'english', org_type: 'university' },
  'University of Amsterdam': { city: 'Amsterdam', country: 'Netherlands', lat: 52.3559, lng: 4.9554, community: 'english', org_type: 'university' },
  'KU Leuven': { city: 'Leuven', country: 'Belgium', lat: 50.8798, lng: 4.7005, community: 'english', org_type: 'university' },

  // Universities - China
  'Tsinghua University': { city: 'Beijing', country: 'China', lat: 40.0007, lng: 116.3269, community: 'chinese', org_type: 'university' },
  'Peking University': { city: 'Beijing', country: 'China', lat: 39.9928, lng: 116.3109, community: 'chinese', org_type: 'university' },
  'Chinese Academy of Sciences': { city: 'Beijing', country: 'China', lat: 39.9087, lng: 116.3975, community: 'chinese', org_type: 'research_lab' },
  'Fudan University': { city: 'Shanghai', country: 'China', lat: 31.2984, lng: 121.5015, community: 'chinese', org_type: 'university' },
  'Zhejiang University': { city: 'Hangzhou', country: 'China', lat: 30.2636, lng: 120.1217, community: 'chinese', org_type: 'university' },
  'Shanghai Jiao Tong University': { city: 'Shanghai', country: 'China', lat: 31.0295, lng: 121.4467, community: 'chinese', org_type: 'university' },
  'Nanjing University': { city: 'Nanjing', country: 'China', lat: 32.0603, lng: 118.7969, community: 'chinese', org_type: 'university' },
  'Harbin Institute of Technology': { city: 'Harbin', country: 'China', lat: 45.7500, lng: 126.6500, community: 'chinese', org_type: 'university' },
  'University of Science and Technology of China': { city: 'Hefei', country: 'China', lat: 31.8206, lng: 117.2272, community: 'chinese', org_type: 'university' },
  'Sun Yat-sen University': { city: 'Guangzhou', country: 'China', lat: 23.0955, lng: 113.2970, community: 'chinese', org_type: 'university' },
  'Renmin University of China': { city: 'Beijing', country: 'China', lat: 39.9707, lng: 116.3185, community: 'chinese', org_type: 'university' },
  'Wuhan University': { city: 'Wuhan', country: 'China', lat: 30.5400, lng: 114.3600, community: 'chinese', org_type: 'university' },
  'Huazhong University of Science and Technology': { city: 'Wuhan', country: 'China', lat: 30.5131, lng: 114.4130, community: 'chinese', org_type: 'university' },
  'Beijing Institute of Technology': { city: 'Beijing', country: 'China', lat: 39.9652, lng: 116.3107, community: 'chinese', org_type: 'university' },
  'University of Chinese Academy of Sciences': { city: 'Beijing', country: 'China', lat: 39.9500, lng: 116.3900, community: 'chinese', org_type: 'university' },

  // Universities - Asia
  'National University of Singapore': { city: 'Singapore', country: 'Singapore', lat: 1.2966, lng: 103.7764, community: 'english', org_type: 'university' },
  'Nanyang Technological University': { city: 'Singapore', country: 'Singapore', lat: 1.3483, lng: 103.6831, community: 'english', org_type: 'university' },
  'University of Tokyo': { city: 'Tokyo', country: 'Japan', lat: 35.7126, lng: 139.761, community: 'english', org_type: 'university' },
  'RIKEN': { city: 'Wako', country: 'Japan', lat: 35.7796, lng: 139.6099, community: 'english', org_type: 'research_lab' },
  'Tokyo Institute of Technology': { city: 'Tokyo', country: 'Japan', lat: 35.6047, lng: 139.6832, community: 'english', org_type: 'university' },
  'KAIST': { city: 'Daejeon', country: 'South Korea', lat: 36.3721, lng: 127.3604, community: 'english', org_type: 'university' },
  'Seoul National University': { city: 'Seoul', country: 'South Korea', lat: 37.4602, lng: 126.9520, community: 'english', org_type: 'university' },
  'POSTECH': { city: 'Pohang', country: 'South Korea', lat: 36.0107, lng: 129.3225, community: 'english', org_type: 'university' },
  'University of Macau': { city: 'Macau', country: 'China', lat: 22.1987, lng: 113.5439, community: 'chinese', org_type: 'university' },
  'Hong Kong University of Science and Technology': { city: 'Hong Kong', country: 'China', lat: 22.3364, lng: 114.2655, community: 'english', org_type: 'university' },
  'Chinese University of Hong Kong': { city: 'Hong Kong', country: 'China', lat: 22.4196, lng: 114.2068, community: 'english', org_type: 'university' },

  // India
  'IIT Bombay': { city: 'Mumbai', country: 'India', lat: 19.1334, lng: 72.9133, community: 'english', org_type: 'university' },
  'IISc Bangalore': { city: 'Bangalore', country: 'India', lat: 13.0219, lng: 77.5671, community: 'english', org_type: 'university' },
  'IIT Delhi': { city: 'New Delhi', country: 'India', lat: 28.5459, lng: 77.1926, community: 'english', org_type: 'university' },

  // Middle East
  'Tel Aviv University': { city: 'Tel Aviv', country: 'Israel', lat: 32.1133, lng: 34.8044, community: 'english', org_type: 'university' },
  'Technion': { city: 'Haifa', country: 'Israel', lat: 32.7775, lng: 35.0217, community: 'english', org_type: 'university' },
  'KAUST': { city: 'Thuwal', country: 'Saudi Arabia', lat: 22.3095, lng: 39.1044, community: 'english', org_type: 'university' },

  // Aliases / alternate names
  'Allen Institute for Artificial Intelligence': { city: 'Seattle', country: 'USA', lat: 47.6205, lng: -122.3493, community: 'english', org_type: 'research_lab' },
  'University of California, Berkeley': { city: 'Berkeley', country: 'USA', lat: 37.8715, lng: -122.273, community: 'english', org_type: 'university' },
  'University of California, San Diego': { city: 'San Diego', country: 'USA', lat: 32.8801, lng: -117.234, community: 'english', org_type: 'university' },
  'University of California, San Francisco': { city: 'San Francisco', country: 'USA', lat: 37.7631, lng: -122.4586, community: 'english', org_type: 'university' },
  'University of Illinois Urbana-Champaign': { city: 'Champaign', country: 'USA', lat: 40.1020, lng: -88.2272, community: 'english', org_type: 'university' },
  'Université de Montréal': { city: 'Montreal', country: 'Canada', lat: 45.5048, lng: -73.6132, community: 'english', org_type: 'university' },
  'École Polytechnique Fédérale de Lausanne': { city: 'Lausanne', country: 'Switzerland', lat: 46.5191, lng: 6.5668, community: 'english', org_type: 'university' },
  'Toyota Technological Institute at Chicago': { city: 'Chicago', country: 'USA', lat: 41.7942, lng: -87.5897, community: 'english', org_type: 'research_lab' },
  'NVIDIA Research': { city: 'Santa Clara', country: 'USA', lat: 37.3861, lng: -121.9613, community: 'english', org_type: 'company' },
  'University of the Basque Country': { city: 'Bilbao', country: 'Spain', lat: 43.2630, lng: -2.9350, community: 'english', org_type: 'university' },
  'University of Navarra': { city: 'Pamplona', country: 'Spain', lat: 42.8047, lng: -1.6600, community: 'english', org_type: 'university' },
  'Shandong University': { city: 'Jinan', country: 'China', lat: 36.6683, lng: 117.0204, community: 'chinese', org_type: 'university' },
  'University of Manchester': { city: 'Manchester', country: 'UK', lat: 53.4668, lng: -2.2339, community: 'english', org_type: 'university' },
  'University of Birmingham': { city: 'Birmingham', country: 'UK', lat: 52.4508, lng: -1.9305, community: 'english', org_type: 'university' },
  'Beijing University of Posts and Telecommunications': { city: 'Beijing', country: 'China', lat: 39.9642, lng: 116.3544, community: 'chinese', org_type: 'university' },
  'Osaka University': { city: 'Osaka', country: 'Japan', lat: 34.8222, lng: 135.5244, community: 'english', org_type: 'university' },
  'University of Tübingen': { city: 'Tübingen', country: 'Germany', lat: 48.5216, lng: 9.0576, community: 'english', org_type: 'university' },
  'University of New South Wales': { city: 'Sydney', country: 'Australia', lat: -33.9173, lng: 151.2313, community: 'english', org_type: 'university' },
  'The University of Edinburgh': { city: 'Edinburgh', country: 'UK', lat: 55.9445, lng: -3.1892, community: 'english', org_type: 'university' },
  'Heidelberg University': { city: 'Heidelberg', country: 'Germany', lat: 49.3988, lng: 8.6724, community: 'english', org_type: 'university' },
  'Brown University': { city: 'Providence', country: 'USA', lat: 41.8268, lng: -71.4025, community: 'english', org_type: 'university' },
  'University of Trento': { city: 'Trento', country: 'Italy', lat: 46.0664, lng: 11.1211, community: 'english', org_type: 'university' },
  'Université Paris Cité': { city: 'Paris', country: 'France', lat: 48.8275, lng: 2.3818, community: 'english', org_type: 'university' },
  'University College Dublin': { city: 'Dublin', country: 'Ireland', lat: 53.3067, lng: -6.2233, community: 'english', org_type: 'university' },
  'University of Auckland': { city: 'Auckland', country: 'New Zealand', lat: -36.8523, lng: 174.7691, community: 'english', org_type: 'university' },
  'Cornell University': { city: 'Ithaca', country: 'USA', lat: 42.4534, lng: -76.4735, community: 'english', org_type: 'university' },
  'Google Brain': { city: 'Mountain View', country: 'USA', lat: 37.422, lng: -122.0841, community: 'english', org_type: 'company' },
  'Tencent AI Lab': { city: 'Shenzhen', country: 'China', lat: 22.5431, lng: 114.0579, community: 'chinese', org_type: 'company' },
  'Korea University': { city: 'Seoul', country: 'South Korea', lat: 37.5895, lng: 127.0322, community: 'english', org_type: 'university' },
  'UC Irvine': { city: 'Irvine', country: 'USA', lat: 33.6405, lng: -117.8443, community: 'english', org_type: 'university' },
  'University of California, Santa Barbara': { city: 'Santa Barbara', country: 'USA', lat: 34.4140, lng: -119.8489, community: 'english', org_type: 'university' },
  'University of Sydney': { city: 'Sydney', country: 'Australia', lat: -33.8688, lng: 151.1872, community: 'english', org_type: 'university' },
  'University of Technology Sydney': { city: 'Sydney', country: 'Australia', lat: -33.8833, lng: 151.2000, community: 'english', org_type: 'university' },
  'University of Freiburg': { city: 'Freiburg', country: 'Germany', lat: 47.9959, lng: 7.8494, community: 'english', org_type: 'university' },
  'IDSIA': { city: 'Lugano', country: 'Switzerland', lat: 46.0037, lng: 8.9511, community: 'english', org_type: 'research_lab' },
  'Meta AI Research': { city: 'Menlo Park', country: 'USA', lat: 37.4848, lng: -122.1484, community: 'english', org_type: 'company' },
  'APPLE AI': { city: 'Cupertino', country: 'USA', lat: 37.3230, lng: -122.0322, community: 'english', org_type: 'company' },
  'Singapore Management University': { city: 'Singapore', country: 'Singapore', lat: 1.2966, lng: 103.8493, community: 'english', org_type: 'university' },
  'University of Illinois at Urbana-Champaign': { city: 'Champaign', country: 'USA', lat: 40.1020, lng: -88.2272, community: 'english', org_type: 'university' },
  'Xidian University': { city: "Xi'an", country: 'China', lat: 34.2317, lng: 108.9200, community: 'chinese', org_type: 'university' },
  'École Normale Supérieure': { city: 'Paris', country: 'France', lat: 48.8422, lng: 2.3447, community: 'english', org_type: 'university' },
  'University of Virginia': { city: 'Charlottesville', country: 'USA', lat: 38.0336, lng: -78.5080, community: 'english', org_type: 'university' },
  'Indian Institute of Technology Hyderabad': { city: 'Hyderabad', country: 'India', lat: 17.5946, lng: 78.1230, community: 'english', org_type: 'university' },
};

// Step 1: Aggregate from nodes.json
const instStats = new Map(); // institution name -> { papers_count, citations_count }

nodes.forEach((node) => {
  if (!node.institution || node.institution.length === 0) return;
  node.institution.forEach((instName) => {
    if (!instStats.has(instName)) {
      instStats.set(instName, { papers_count: 0, citations_count: 0 });
    }
    const stats = instStats.get(instName);
    stats.papers_count += 1;
    stats.citations_count += Number(node.citations_count) || 0;
  });
});

console.log(`Found ${instStats.size} unique institutions in nodes.json`);

// Step 2: Build output
const output = [];
const maxCitations = Math.max(...Array.from(instStats.values()).map(s => s.citations_count), 1);
const maxPapers = Math.max(...Array.from(instStats.values()).map(s => s.papers_count), 1);

instStats.forEach((stats, name) => {
  // Get geo data: prefer existing, then database, skip if neither
  let geo = null;
  const existing = existingByName.get(name);
  if (existing) {
    geo = { city: existing.city, country: existing.country, lat: existing.lat, lng: existing.lng, community: existing.community, org_type: existing.org_type };
  } else if (GEO_DATABASE[name]) {
    geo = { ...GEO_DATABASE[name] };
  }

  if (!geo) {
    // Skip institutions we don't have coordinates for
    return;
  }

  // Calculate influence score (0-100)
  const citationScore = (stats.citations_count / maxCitations) * 60;
  const paperScore = (stats.papers_count / maxPapers) * 40;
  const influence_score = Math.round(Math.min(100, citationScore + paperScore));

  const id = `inst_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

  output.push({
    id,
    institution: name,
    city: geo.city,
    country: geo.country,
    lat: geo.lat,
    lng: geo.lng,
    community: geo.community,
    org_type: geo.org_type,
    papers_count: stats.papers_count,
    citations_count: stats.citations_count,
    influence_score: Math.max(influence_score, 30) // minimum 30 for visibility
  });
});

// Sort by influence_score descending
output.sort((a, b) => b.influence_score - a.influence_score);

console.log(`Output: ${output.length} institutions with geo data`);
console.log(`Skipped: ${instStats.size - output.length} institutions (no geo coordinates)`);
console.log('\nTop 10:');
output.slice(0, 10).forEach(i => console.log(`  ${i.institution}: ${i.papers_count} papers, ${i.citations_count} citations, score ${i.influence_score}`));

fs.writeFileSync(geoPath, JSON.stringify(output, null, 2), 'utf8');
console.log('\nDone. institutions_geo.json rebuilt.');
