'use strict';

function Module(resource) {
  this.resource = resource;
  this.bailouts = false;
  this.uses = new Set();
  this.declarations = [];
}
module.exports = Module;

Module.prototype.bailout = function bailout(reason, loc, source) {
  if (this.bailouts)
    this.bailouts.push({ reason, loc, source: source || null });
  else
    this.bailouts = [ { reason, loc, source: source || null } ];
};

Module.prototype.use = function use(prop) {
  this.uses.add(prop);
};

Module.prototype.declare = function declare(prop) {
  this.declarations.push(prop);
};

Module.prototype.mergeFrom = function mergeFrom(unresolved) {
  if (unresolved.bailouts)
    unresolved.bailouts.forEach(b => this.bailout(b.reason, b.loc, b.source));

  unresolved.uses.forEach(use => this.use(use));
  unresolved.declarations.forEach(declaration => this.declare(declaration));
  unresolved.clear();
};

Module.prototype.clear = function clear() {
  this.uses = null;
  this.declarations = null;
};

Module.prototype.isUsed = function isUsed(name) {
  if (this.bailouts)
    return false;

  return this.uses.has(name);
};

Module.prototype.getInfo = function getInfo() {
  return {
    bailouts: this.bailouts,
    declarations: this.declarations.map(decl => decl.name),
    uses: Array.from(this.uses)
  };
};
