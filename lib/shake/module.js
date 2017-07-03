'use strict';

function Module(resource) {
  this.resource = resource;
  this.bailouts = false;
  this.issuers = [];
  this.uses = new Map();
  this.declarations = [];
}
module.exports = Module;

Module.prototype.bailout = function bailout(reason, loc, source, level) {
  const bail = {
    reason,
    loc,
    source: source || null,
    level: level || 'warning'
  };
  if (this.bailouts)
    this.bailouts.push(bail);
  else
    this.bailouts = [ bail ];
  this.sealed = false;
};

Module.prototype.use = function use(prop, from) {
  if (this.uses.has(prop))
    this.uses.get(prop).add(from);
  else
    this.uses.set(prop, new Set([ from ]));
};

Module.prototype.seal = function seal() {
  this.sealed = true;
};

Module.prototype.declare = function declare(prop) {
  this.declarations.push(prop);

  return !this.sealed;
};

Module.prototype.multiDeclare = function multiDeclare(declarations) {
  const success = this.declarations.length === 0 && !this.sealed;
  this.sealed = true;
  for (let i = 0; i < declarations.length; i++)
    this.declarations.push(declarations[i]);
  return success;
};

Module.prototype.mergeFrom = function mergeFrom(unresolved) {
  if (unresolved.bailouts) {
    unresolved.bailouts.forEach((b) => {
      this.bailout(b.reason, b.loc, b.source, b.level);
    });
  }

  unresolved.uses.forEach((from, prop) => this.use(prop, from));
  unresolved.declarations.forEach(declaration => this.declare(declaration));
  unresolved.clear();
};

Module.prototype.addIssuer = function addIssuer(issuer) {
  this.issuers.push(issuer);
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
    uses: Array.from(this.uses.keys())
  };
};

Module.prototype.getDeclarations = function getDeclarations() {
  return this.declarations.slice();
};
