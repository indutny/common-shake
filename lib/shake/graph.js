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
  out += '  ranksep=1.2;\n';
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
  file = file || '';
  if (this.relativeCache.has(file))
    return this.relativeCache.get(file);

  const relative = path.relative(this.dir, file);
  this.relativeCache.set(file, relative);
  return relative;
};

Graph.prototype.escape = function escape(str) {
  return `"${str.replace(/"/g, '\\"')}"`;
};

Graph.prototype.declarationId = function declarationId(module, name) {
  return this.escape(`{${this.relative(module.resource)}}[${name}]`);
};

Graph.prototype.moduleId = function moduleId(module) {
  return this.escape(`{${this.relative(module.resource)}}/require`);
};

Graph.prototype.generateModule = function generateModule(module) {
  const resource = this.escape('cluster://' + this.relative(module.resource));
  const label = this.escape(this.relative(module.resource));

  let out = '';

  const color = module.bailouts === false ? 'black' : 'red';
  let cluster = `  subgraph ${resource} {\n`;
  cluster += `    label=${label};\n`;
  cluster += `    color=${color};\n`;
  cluster += `    ${this.moduleId(module)} [label=require shape=diamond];\n`;

  const issuersSeen = new Set();
  const declarationsSeen = new Set();

  const declare = (name) => {
    const id = this.declarationId(module, name);
    if (declarationsSeen.has(name))
      return id;

    declarationsSeen.add(name);

    const color = module.bailouts === false ?
      module.isUsed(name) ? 'black' : 'blue' :
      'red';

    const shortId = this.escape(`${name}`);
    cluster += `    ${id} [label=${shortId} color=${color}];\n`;

    return id;
  };

  // Add all declarations
  module.declarations.forEach((declaration) => {
    declare(declaration.name);
  });

  // Add uses
  module.uses.forEach((issuers, name) => {
    issuers.forEach((issuer) => {
      issuersSeen.add(issuer);

      out += `  ${this.moduleId(issuer)} -> ${declare(name)};\n`;
    });
  });

  // Add dynamic issuer edges (without particular uses)
  module.issuers.forEach((issuer) => {
    if (issuersSeen.has(issuer))
      return;
    issuersSeen.add(issuer);

    out += `  ${this.moduleId(issuer)} -> ${declare('[*]')};\n`;
  });

  cluster += '  }\n';

  return cluster + out;
};
