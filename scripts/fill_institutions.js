/**
 * Fill empty institution fields in nodes.json based on author affiliations.
 * 
 * Strategy:
 * 1. Build author -> institution mapping from papers that already have institutions
 * 2. For each author, pick their most frequently associated institution
 * 3. For papers with empty institution, look up each author's primary institution
 * 4. Deduplicate and assign
 */
const fs = require('fs');
const path = require('path');

const nodesPath = path.join(__dirname, '..', 'data', 'processed', 'nodes.json');
const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));

// Step 1: Build author -> institution frequency map
const authorInstFreq = new Map(); // author -> Map<institution, count>

nodes.forEach((node) => {
  if (!node.institution || node.institution.length === 0) return;
  if (!node.authors || node.authors.length === 0) return;
  
  node.authors.forEach((author) => {
    if (!authorInstFreq.has(author)) authorInstFreq.set(author, new Map());
    const freqMap = authorInstFreq.get(author);
    node.institution.forEach((inst) => {
      freqMap.set(inst, (freqMap.get(inst) || 0) + 1);
    });
  });
});

// Step 2: For each author, determine primary institution (most frequent)
const authorPrimary = new Map(); // author -> primary institution
authorInstFreq.forEach((freqMap, author) => {
  let best = null;
  let bestCount = 0;
  freqMap.forEach((count, inst) => {
    if (count > bestCount) { best = inst; bestCount = count; }
  });
  if (best) authorPrimary.set(author, best);
});

console.log(`Authors with known primary institution: ${authorPrimary.size}`);

// Step 3: Fill empty institutions
let filledCount = 0;
let partialCount = 0;

nodes.forEach((node) => {
  if (node.institution && node.institution.length > 0) return;
  if (!node.authors || node.authors.length === 0) return;
  
  const inferred = new Set();
  node.authors.forEach((author) => {
    const primary = authorPrimary.get(author);
    if (primary) inferred.add(primary);
  });
  
  if (inferred.size > 0) {
    node.institution = Array.from(inferred);
    filledCount++;
  } else {
    partialCount++;
  }
});

console.log(`Filled: ${filledCount} papers`);
console.log(`Still empty (no author match): ${partialCount} papers`);

// Step 4: Write back
fs.writeFileSync(nodesPath, JSON.stringify(nodes, null, 2), 'utf8');
console.log('Done. nodes.json updated.');
