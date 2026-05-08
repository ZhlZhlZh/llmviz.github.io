export function applyForceLayout(nodes, links, options = {}) {
  const {
    centerX = 0,
    centerY = 0,
    repulsion = 1000,
    springLength = 80,
    springStrength = 0.004,
    centerStrength = 0.0008,
    damping = 0.86,
    bounds = null
  } = options;

  nodes.forEach((a, i) => {
    if (!a.fixed) {
      a.vx += (centerX - a.x) * centerStrength;
      a.vy += (centerY - a.y) * centerStrength;
    }
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distSq = dx * dx + dy * dy + 0.1;
      const dist = Math.sqrt(distSq);
      const force = repulsion / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.fixed) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.fixed) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }
  });

  links.forEach((link) => {
    const a = link.sourceNode;
    const b = link.targetNode;
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - (link.springLength || springLength)) * (link.springStrength || springStrength);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.fixed) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.fixed) {
      b.vx -= fx;
      b.vy -= fy;
    }
  });

  nodes.forEach((node) => {
    if (!node.fixed) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
    if (bounds) {
      node.x = Math.min(Math.max(node.x, bounds.left), bounds.right);
      node.y = Math.min(Math.max(node.y, bounds.top), bounds.bottom);
    }
  });
}
