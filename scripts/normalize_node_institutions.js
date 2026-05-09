/**
 * Normalize institution names in nodes.json using institution_aliases.json
 * This ensures all modules display consistent institution names.
 */
const fs = require('fs');
const path = require('path');

const nodesPath = path.join(__dirname, '..', 'data', 'processed', 'nodes.json');
const aliasPath = path.join(__dirname, '..', 'data', 'processed', 'institution_aliases.json');

const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
const aliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));

// Build alias lookup: alias -> canonical
const lookup = new Map();
aliases.forEach((row) => {
  lookup.set(row.canonical, row.canonical);
  (row.aliases || []).forEach((alias) => lookup.set(alias, row.canonical));
});

let changedCount = 0;

nodes.forEach((node) => {
  if (!node.institution || node.institution.length === 0) return;
  
  const normalized = Array.from(new Set(
    node.institution.map((name) => {
      const canonical = lookup.get(name.trim());
      return canonical || name.trim();
    })
  ));
  
  // Check if anything changed
  const changed = normalized.length !== node.institution.length || 
    normalized.some((n, i) => n !== node.institution[i]);
  
  if (changed) {
    node.institution = normalized;
    changedCount++;
  }
});

console.log(`Normalized ${changedCount} papers' institution names.`);

// Show unique institutions after normalization
const allInsts = new Set();
nodes.forEach(n => (n.institution || []).forEach(i => allInsts.add(i)));
console.log(`Unique institutions after normalization: ${allInsts.size}`);

fs.writeFileSync(nodesPath, JSON.stringify(nodes, null, 2), 'utf8');
console.log('Done. nodes.json updated.');
