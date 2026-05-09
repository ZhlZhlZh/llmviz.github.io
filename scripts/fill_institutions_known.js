/**
 * Second pass: fill remaining empty institutions using a curated
 * author -> institution knowledge base for well-known AI/ML researchers.
 */
const fs = require('fs');
const path = require('path');

const nodesPath = path.join(__dirname, '..', 'data', 'processed', 'nodes.json');
const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));

// Curated mapping of well-known researchers to their primary institution
const KNOWN_AUTHORS = {
  // Google / DeepMind
  'Jeff Dean': 'Google Research',
  'Quoc V. Le': 'Google Research',
  'Oriol Vinyals': 'Google DeepMind',
  'Ilya Sutskever': 'OpenAI',
  'I. Sutskever': 'OpenAI',
  'Noam Shazeer': 'Google Research',
  'Ashish Vaswani': 'Google Research',
  'Niki Parmar': 'Google Research',
  'Jakob Uszkoreit': 'Google Research',
  'Llion Jones': 'Google Research',
  'Aidan N. Gomez': 'University of Toronto',
  'Lukasz Kaiser': 'Google Research',
  'Illia Polosukhin': 'Google Research',
  'Barret Zoph': 'Google Research',
  'Yi Tay': 'Google Research',
  'Hyung Won Chung': 'Google Research',
  'Sebastian Gehrmann': 'Google Research',
  'Denny Zhou': 'Google Research',
  'Jason Wei': 'Google Research',
  'Gemini Team': 'Google DeepMind',
  'Rohan Anil': 'Google DeepMind',
  
  // OpenAI
  'Sam Altman': 'OpenAI',
  'Greg Brockman': 'OpenAI',
  'John Schulman': 'OpenAI',
  'Alec Radford': 'OpenAI',
  'Ilya Sutskever': 'OpenAI',
  'Dario Amodei': 'Anthropic',
  'Tom B. Brown': 'OpenAI',
  'Mark Chen': 'OpenAI',
  'Rewon Child': 'OpenAI',
  'R. Child': 'OpenAI',
  'Lilian Weng': 'OpenAI',
  'Long Ouyang': 'OpenAI',
  'Jeff Wu': 'OpenAI',
  'Jan Leike': 'OpenAI',
  
  // Anthropic
  'Dario Amodei': 'Anthropic',
  'Daniela Amodei': 'Anthropic',
  'Chris Olah': 'Anthropic',
  'Sam McCandlish': 'Anthropic',
  'Jack Clark': 'Anthropic',
  'Jared Kaplan': 'Anthropic',
  'J. Kaplan': 'Anthropic',
  'Amanda Askell': 'Anthropic',
  'Tom Henighan': 'Anthropic',
  'T. Henighan': 'Anthropic',
  
  // Meta AI
  'Yann LeCun': 'Meta AI',
  'Mike Lewis': 'Meta AI',
  'M. Lewis': 'Meta AI',
  'Hugo Touvron': 'Meta AI',
  'Thibaut Lavril': 'Meta AI',
  'Naman Goyal': 'Meta AI',
  'Luke Zettlemoyer': 'Meta AI',
  'Douwe Kiela': 'Meta AI',
  'Guillaume Lample': 'Meta AI',
  'Armand Joulin': 'Meta AI',
  'Edouard Grave': 'Meta AI',
  'Timothée Lacroix': 'Meta AI',
  
  // Stanford
  'Christopher Manning': 'Stanford University',
  'Percy Liang': 'Stanford University',
  'Chelsea Finn': 'Stanford University',
  'Tengyu Ma': 'Stanford University',
  'Tatsu Hashimoto': 'Stanford University',
  'Tri Dao': 'Stanford University',
  'Christopher Ré': 'Stanford University',
  'Jure Leskovec': 'Stanford University',
  'Dan Jurafsky': 'Stanford University',
  
  // UC Berkeley
  'Pieter Abbeel': 'UC Berkeley',
  'Trevor Darrell': 'UC Berkeley',
  'Ion Stoica': 'UC Berkeley',
  'Joseph E. Gonzalez': 'UC Berkeley',
  'Kurt Keutzer': 'UC Berkeley',
  'Dawn Song': 'UC Berkeley',
  
  // CMU
  'Graham Neubig': 'Carnegie Mellon University',
  'Yiming Yang': 'Carnegie Mellon University',
  'Albert Gu': 'Carnegie Mellon University',
  'Zhiting Hu': 'Carnegie Mellon University',
  'Eric Xing': 'Carnegie Mellon University',
  
  // MIT
  'Regina Barzilay': 'MIT',
  'Tommi Jaakkola': 'MIT',
  'Jacob Andreas': 'MIT',
  'Yoon Kim': 'MIT',
  
  // Princeton
  'Sanjeev Arora': 'Princeton University',
  'Karthik Narasimhan': 'Princeton University',
  'Danqi Chen': 'Princeton University',
  
  // University of Toronto / Mila
  'Geoffrey Hinton': 'University of Toronto',
  'Jimmy Ba': 'University of Toronto',
  'Raquel Urtasun': 'University of Toronto',
  
  // Mila / Montreal
  'Yoshua Bengio': 'Mila',
  'Aaron Courville': 'Mila',
  'Nicolas Chapados': 'Mila',
  
  // Microsoft
  'Jianfeng Gao': 'Microsoft',
  'Furu Wei': 'Microsoft',
  'Li Dong': 'Microsoft',
  'Shuming Ma': 'Microsoft',
  
  // Tsinghua
  'Jie Tang': 'Tsinghua University',
  'Zhiyuan Liu': 'Tsinghua University',
  'Maosong Sun': 'Tsinghua University',
  'Yuxiao Dong': 'Tsinghua University',
  'Jian Li': 'Tsinghua University',
  'Minlie Huang': 'Tsinghua University',
  
  // Peking University
  'Xu Sun': 'Peking University',
  'Baobao Chang': 'Peking University',
  
  // Chinese Academy of Sciences
  'Jun Zhao': 'Chinese Academy of Sciences',
  'Kang Liu': 'Chinese Academy of Sciences',
  
  // NUS
  'Min-Yen Kan': 'National University of Singapore',
  'Tat-Seng Chua': 'National University of Singapore',
  
  // ETH Zurich
  'Ce Zhang': 'ETH Zurich',
  'Thomas Hofmann': 'ETH Zurich',
  'Ryan Cotterell': 'ETH Zurich',
  
  // Oxford
  'Phil Blunsom': 'University of Oxford',
  'Yarin Gal': 'University of Oxford',
  
  // Cambridge
  'Anna Korhonen': 'University of Cambridge',
  'C. Sherlock': 'University of Cambridge',
  
  // Hugging Face
  'Thomas Wolf': 'Hugging Face',
  'Julien Chaumond': 'Hugging Face',
  'Lysandre Debut': 'Hugging Face',
  
  // NVIDIA
  'Bryan Catanzaro': 'NVIDIA',
  'Mohammad Shoeybi': 'NVIDIA',
  'Mostofa Patwary': 'NVIDIA',
  
  // DeepMind
  'Demis Hassabis': 'DeepMind',
  'David Silver': 'DeepMind',
  'Koray Kavukcuoglu': 'DeepMind',
  
  // EPFL
  'Martin Jaggi': 'EPFL',
  'Antoine Bosselut': 'EPFL',
  
  // Inria
  'Guillaume Obozinski': 'Inria',
  
  // KAIST
  'Minjoon Seo': 'KAIST',
  'Sung Ju Hwang': 'KAIST',
  
  // University of Tokyo
  'Issei Sato': 'University of Tokyo',
  'Yusuke Miyao': 'University of Tokyo',
  
  // NYU
  'Kyunghyun Cho': 'New York University',
  'Sam Bowman': 'New York University',
  'He He': 'New York University',
  
  // UW
  'Noah A. Smith': 'University of Washington',
  'Yejin Choi': 'University of Washington',
  
  // Allen AI
  'Oren Etzioni': 'Allen Institute for AI',
  'Matt Gardner': 'Allen Institute for AI',
  
  // Mistral
  'Arthur Mensch': 'Mistral AI',
  'Guillaume Lample': 'Mistral AI',
};

let filledCount = 0;

nodes.forEach((node) => {
  if (node.institution && node.institution.length > 0) return;
  if (!node.authors || node.authors.length === 0) return;
  
  const inferred = new Set();
  node.authors.forEach((author) => {
    const inst = KNOWN_AUTHORS[author];
    if (inst) inferred.add(inst);
  });
  
  if (inferred.size > 0) {
    node.institution = Array.from(inferred);
    filledCount++;
  }
});

console.log(`Filled ${filledCount} more papers from curated author list.`);

// Final stats
const stillEmpty = nodes.filter(n => !n.institution || n.institution.length === 0).length;
console.log(`Still empty: ${stillEmpty} papers`);
console.log(`Total with institution: ${nodes.length - stillEmpty}/${nodes.length}`);

fs.writeFileSync(nodesPath, JSON.stringify(nodes, null, 2), 'utf8');
console.log('Done. nodes.json updated.');
