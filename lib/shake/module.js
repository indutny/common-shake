'use strict';

const debug = require('debug')('common-shake:module');

function Module(resource) {
  this.resource = resource;
  this.bailouts = false;
  this.issuers = new Set();
  this.uses = new Map();
  this.declarations = [];

  this.pendingUses = [];
  this.computing = false;
  this.forced = false;
}
module.exports = Module;

// Public API

Module.prototype.forceExport = function forceExport() {
  this.forced = true;
};

Module.prototype.isUsed = function isUsed(name) {
  this.compute();

  if (this.bailouts || this.forced)
    return true;

  // Detect loops
  if (this.computing) {
    const pending = this.pendingUses.some(use => use.property === name);
    if (pending)
      return true;
  }

  return this.uses.has(name);
};

Module.prototype.getInfo = function getInfo() {
  this.compute();

  return {
    bailouts: this.bailouts,
    declarations: this.declarations.map(decl => decl.name),
    uses: Array.from(this.uses.keys())
  };
};

Module.prototype.getDeclarations = function getDeclarations() {
  return this.declarations.slice();
};

// Private API

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

Module.prototype.use = function use(property, from, recursive) {
  if (recursive !== false) {
    debug('pending use this=%j property=%j from=%j recursive=%j',
          this.resource, property, from.resource, recursive);
    this.pendingUses.push({ property, from, recursive });
    return;
  }

  debug('use this=%j property=%j from=%j recursive=%j',
        this.resource, property, from.resource, recursive);

  if (this.uses.has(property))
    this.uses.get(property).add(from);
  else
    this.uses.set(property, new Set([ from ]));
};

Module.prototype.seal = function seal() {
  this.sealed = true;
};

Module.prototype.declare = function declare(property) {
  this.declarations.push(property);

  return !this.sealed;
};

Module.prototype.multiDeclare = function multiDeclare(declarations) {
  const success = this.declarations.length === 0 && !this.sealed;
  this.seal();
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

  unresolved.uses.forEach((from, property) => {
    from.forEach(resource => this.use(property, resource, false));
  });
  unresolved.declarations.forEach(declaration => this.declare(declaration));
  this.pendingUses = this.pendingUses.concat(unresolved.pendingUses);

  unresolved.clear();
};

Module.prototype.addIssuer = function addIssuer(issuer) {
  this.issuers.add(issuer);
};

Module.prototype.clear = function clear() {
  this.uses = null;
  this.declarations = null;
  this.pendingUses = null;
};

Module.prototype.compute = function compute() {
  // Already computed or cleared
  if (this.pendingUses === null)
    return;

  if (this.computing)
    return;
  this.computing = true;
  debug('compute this=%j pending=%d', this.resource, this.pendingUses.length);

  // Do several passes until it will stabilize
  // TODO(indutny): what is complexity of this? Exponential?
  let before;
  do {
    before = this.pendingUses.length;

    // NOTE: it is important to overwrite this, since recursive lookups will
    // get to it.
    this.pendingUses = this.pendingUses.filter((use) => {
      return use.from.isUsed(use.recursive);
    });
    debug('compute pass this=%j before=%d after=%d',
          this.resource, before, this.pendingUses.length);
  } while (this.pendingUses.length !== before);

  this.pendingUses.forEach(use => this.use(use.property, use.from, false));

  this.pendingUses = null;
  this.computing = false;
};
