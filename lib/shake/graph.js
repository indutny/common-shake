'use strict';

const path = require('path');

function Graph(dir) {
  this.dir = dir || '.';
  this.relativeCache = new Map();
}
module.exports = Graph;

Graph.prototype.generate = function generate(modules) {
  const seen = new Set();
  const queue = modules.slice();

  let out = 'digraph {\n';
  while (queue.length !== 0) {
    const module = queue.shift();

    if (seen.has(module))
      continue;
    seen.add(module);

    out += this.generateModule(module);
  }
  out += '}\n';
  return out;
};

Graph.prototype.relative = function relative(file) {
  if (this.relativeCache.has(file))
    return this.relativeCache.get(file);

  const relative = path.relative(this.dir, file);
  this.relativeCache.set(file, relative);
  return relative;
};

Graph.prototype.escape = function escape(str) {
  return `"${str.replace(/"/g, '\\"')}"`;
};

Graph.prototype.generateModule = function generateModule(module) {
  const resource = this.escape(this.relative(module.resource));

  const color = module.bailouts === false ? 'black' : 'red';
  let out = `  ${resource} [shape=box color=${color}];\n`;

  const issuersSeen = new Set();

  // Add uses
  module.uses.forEach((issuers, name) => {
    issuers.forEach((issuer) => {
      issuersSeen.add(issuer);

      const id = this.escape(this.relative(issuer.resource));
      out += `  ${id} -> ${resource} [label=${this.escape(name)}];\n`;
    });
  });

  // Add unused declarations
  module.declarations.forEach((declaration) => {
    const name = declaration.name;
    if (module.isUsed(name))
      return;

    const color = module.bailouts === false ? 'black' : 'red';

    const id = this.escape(`{${this.relative(module.resource)}}[${name}]`);
    out += `  ${id} [color=${color}];\n`;
    out += `  ${resource} -> ${id} [dir=none color=${color}];\n`;
  });

  // Add dynamic issuer edges (without particular uses)
  module.issuers.forEach((issuer) => {
    if (issuersSeen.has(issuer))
      return;
    issuersSeen.add(issuer);

    const id = this.escape(this.relative(issuer.resource));
    out += `  ${id} -> ${resource} [label=${this.escape('*')}];\n`;
  });

  return out;
};
