'use strict';

function Module(file) {
  this.file = file;
  this.bailoutReason = false;
  this.uses = new Set();
  this.declarations = [];
}
module.exports = Module;

Module.prototype.bailout = function bailout(reason) {
  this.bailoutReason = reason || true;
};

Module.prototype.use = function use(prop) {
  this.uses.add(prop);
};

Module.prototype.declare = function declare(prop) {
  this.declarations.push(prop);
};

Module.prototype.mergeFrom = function mergeFrom(unresolved) {
  if (!this.bailoutReason)
    this.bailoutReason = unresolved.bailoutReason;

  unresolved.uses.forEach(use => this.use(use));
  unresolved.declarations.forEach(declaration => this.declare(declaration));
  unresolved.clear();
};

Module.prototype.clear = function clear() {
  this.uses = null;
  this.declarations = null;
};

Module.prototype.isUsed = function isUsed(name) {
  if (this.bailoutReason)
    return false;

  return this.uses.has(name);
};

Module.prototype.fillExports = function fillExports(module) {
  if (this.bailoutReason)
    return;

  module.providedExports = this.declarations.map(decl => decl.name);
  module.used = this.uses.size !== 0;
  module.usedExports = Array.from(this.uses);
};
