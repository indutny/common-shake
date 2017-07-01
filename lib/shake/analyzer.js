'use strict';

const escope = require('escope');

const shake = require('../shake');
const walk = shake.walk;
const Module = shake.Module;

function Analyzer() {
  // All `Module` instances by resource
  this.modules = new Map();

  // All unresolved `Module` instances by parent resource + path
  this.unresolved = new Map();

  // Uses of required module. Map from ast node to `Module` instance
  this.moduleUses = null;

  // Uses of `exports` in module. A collection of AST nodes.
  this.exportsUses = null;

  // Uses of `require` in module. A collection of AST nodes.
  this.requireUses = null;

  // Any global bailouts
  this.bailouts = false;
}
module.exports = Analyzer;

// Public API

Analyzer.prototype.run = function run(ast, resource) {
  this.requireUses = new Set();
  this.exportsUses = new Set();
  this.moduleUses = new Map();

  const current = this.getModule(resource);

  this.gather(ast, resource);
  this.sift(ast, current);

  this.moduleUses = null;
  this.exportsUses = null;
  this.requireUses = null;

  return current;
};

Analyzer.prototype.resolve = function resolve(issuer, name, to) {
  const unresolved = this.getUnresolvedModule(issuer, name);
  const resolved = this.getModule(to);
  resolved.mergeFrom(unresolved);
  this.unresolved.get(issuer).set(name, to);
};

Analyzer.prototype.getModule = function getModule(resource) {
  let module;
  if (this.modules.has(resource)) {
    module = this.modules.get(resource);
  } else {
    module = new Module(resource);
    this.modules.set(resource, module);
  }
  return module;
};

Analyzer.prototype.isSuccess = function isSuccess() {
  return this.bailouts === false;
};

// Private API

Analyzer.prototype.gather = function gather(ast, resource) {
  const manager = escope.analyze(ast, {
    ecmaVersion: 6,
    sourceType: 'module',
    optimistic: true,
    ignoreEval: true,
    impliedStrict: true
  });

  const scope = manager.acquireAll(ast);

  const declarations = [];

  const queue = scope.slice();
  while (queue.length !== 0) {
    const scope = queue.shift();

    for (let i = 0; i < scope.childScopes.length; i++)
      queue.push(scope.childScopes[i]);

    // Skip variables declared in dynamic scopes
    if (scope.dynamic)
      continue;

    for (let i = 0; i < scope.variables.length; i++)
      declarations.push(scope.variables[i]);
  }

  // Just to avoid double-bailouts
  const seenDefs = new Set();
  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i];

    const defs = decl.defs.filter(def => this.isRequireDef(def, decl));
    if (defs.length === 0)
      continue;

    if (decl.defs.length !== 1) {
      defs.forEach((def) => {
        if (seenDefs.has(def.node))
          return;
        seenDefs.add(def.node);

        const name = def.node.init.arguments[0].value;
        const module = this.getUnresolvedModule(resource, name);

        module.bailout('`require` variable override', def.node.loc, resource);
      });
      continue;
    }

    const node = defs[0].node;
    if (seenDefs.has(node))
      continue;
    seenDefs.add(node);

    const name = node.init.arguments[0].value;
    const module = this.getUnresolvedModule(resource, name);

    // Destructuring
    if (node.id.type === 'ObjectPattern') {
      this.gatherDestructured(module, node.id, resource);
      continue;
    }

    if (node.id.type !== 'Identifier') {
      module.bailout('`require` used in unknown way', node.loc, resource);
      continue;
    }

    for (let i = 0; i < decl.references.length; i++) {
      const ref = decl.references[i];
      if (ref.identifier !== node.id)
        this.moduleUses.set(ref.identifier, module);
    }
  }
};

Analyzer.prototype.gatherDestructured = function gatherDestructured(module,
                                                                    id,
                                                                    resource) {
  for (let i = 0; i < id.properties.length; i++) {
    const prop = id.properties[i];

    if (prop.key.type !== (prop.computed ? 'Literal' : 'Identifier')) {
      module.bailout('Dynamic properties in `require` destructuring', id.loc,
                     resource);
      continue;
    }

    const key = prop.key.name || prop.key.value;
    module.use(key);
  }
};

Analyzer.prototype.isRequireDef = function isRequireDef(def, decl) {
  if (def.type !== 'Variable')
    return false;

  const node = def.node;
  if (node.type !== 'VariableDeclarator')
    return false;

  if (node.id.type === 'Identifier') {
    if (node.id.name === 'exports') {
      this.markOverriddenUses(this.exportsUses, decl.references);
      return false;
    } else if (node.id.name === 'require') {
      this.markOverriddenUses(this.requireUses, decl.references);
      return false;
    }
  }

  const init = node.init;
  if (!init || init.type !== 'CallExpression')
    return false;

  if (init.callee.type !== 'Identifier' || init.callee.name !== 'require')
    return false;

  const args = init.arguments;
  if (args.length < 1 || args[0].type !== 'Literal')
    return false;

  // Overridden `require`
  if (this.requireUses.has(init.callee))
    return false;

  return true;
};

Analyzer.prototype.markOverriddenUses = function markOverriddenUses(set, refs) {
  for (let i = 0; i < refs.length; i++)
    set.add(refs[i].identifier);
};

Analyzer.prototype.sift = function sift(ast, current) {
  walk(ast, {
    AssignmentExpression: node => this.siftAssignment(node, current),
    MemberExpression: node => this.siftMember(node, current),
    Identifier: node => this.siftRequireUse(node, current),
    CallExpression: node => this.siftCall(node, current)
  });

  this.moduleUses.forEach((module, use) => {
    module.bailout('Escaping value or unknown use', use.loc, current.resource);
  });
};

Analyzer.prototype.siftAssignment = function siftAssignment(node, current) {
  if (node.left.type === 'Identifier') {
    if (node.left.name === 'exports') {
      if (this.exportsUses.has(node.left))
        return;
      this.exportsUses.add(node.left);

      current.bailout('`exports` assignment', node.loc);
      return;
    }
    if (node.left.name === 'require') {
      if (this.requireUses.has(node.left))
        return;

      this.requireUses.add(node.left);
      current.bailout('`require` assignment', node.loc);
      return;
    }
  }

  if (node.left.type !== 'MemberExpression')
    return;

  const member = node.left;

  if (this.moduleUses.has(member.object)) {
    const module = this.moduleUses.get(member.object);
    module.bailout('Module property assignment', node.loc, current.resource);
    return;
  }

  if (member.object.type !== 'Identifier')
    return;

  const object = member.object.name;
  if (object !== 'exports' && object !== 'module')
    return;

  if (member.property.type !== (member.computed ? 'Literal' : 'Identifier')) {
    if (object === 'exports') {
      if (this.exportsUses.has(member.object))
        return;
      this.exportsUses.add(member.object);

      current.bailout('Dynamic CommonJS export', member.loc);
    } else {
      current.bailout('Dynamic `module` use', member.loc);
    }
    return;
  }

  if (object === 'module') {
    current.bailout('`module.exports` assignment', node.loc, null, 'info');
    return;
  }

  if (this.exportsUses.has(member.object))
    return;
  this.exportsUses.add(member.object);

  const name = member.property.name || member.property.value;
  current.declare({ name, ast: node });
};

Analyzer.prototype.siftMember = function siftMember(node, current) {
  let module;
  if (node.object.type === 'Identifier' && node.object.name === 'exports') {
    // Do not track assignments twice
    if (this.exportsUses.has(node.object))
      return;
    this.exportsUses.add(node.object);

    module = current;
  } else if (node.object.type === 'Identifier' &&
             node.object.name === 'require') {
    // It is ok to use `require` properties
    this.requireUses.add(node.object);
    return;
  } else if (this.moduleUses.has(node.object)) {
    module = this.moduleUses.get(node.object);
    this.moduleUses.delete(node.object);
  } else if (node.object.type === 'CallExpression') {
    module = this.siftRequireCall(node.object, current);
    if (!module)
      return;
  } else {
    return;
  }

  if (node.property.type !== (node.computed ? 'Literal' : 'Identifier')) {
    if (module === current) {
      module.bailout('Dynamic CommonJS use', node.loc);
    } else {
      const reason = 'Dynamic CommonJS import';
      module.bailout(reason, node.loc, current.resource);
      this.bailout(reason, node.loc, current.resource);
    }
    return;
  }

  const prop = node.property.name || node.property.value;
  module.use(prop);
};

Analyzer.prototype.siftCall = function siftCall(node, current) {
  // `lib()`
  if (this.moduleUses.has(node.callee)) {
    const module = this.moduleUses.get(node.callee);
    this.moduleUses.delete(node.callee);
    module.bailout('Imported library call', node.loc, current.resource, 'info');
    return;
  }

  this.siftRequireCall(node, current);
};

Analyzer.prototype.siftRequireCall = function siftRequireCall(node, current) {
  const callee = node.callee;
  if (callee.type !== 'Identifier' || callee.name !== 'require')
    return false;

  // Valid `require` use
  if (this.requireUses.has(callee))
    return;
  this.requireUses.add(callee);

  const args = node.arguments;
  if (args.length < 1)
    return false;

  if (args[0].type !== 'Literal' || typeof args[0].value !== 'string') {
    const msg = 'Dynamic argument of `require`';
    current.bailout(msg, node.loc);
    this.bailout(msg, node.loc, current.resource);
    return false;
  }

  // TODO(indutny): support `require('./lib')()`
  return this.getUnresolvedModule(current.resource, args[0].value);
};

Analyzer.prototype.siftRequireUse = function siftRequireUse(node, current) {
  if (node.type !== 'Identifier' || node.name !== 'require')
    return;

  if (this.requireUses.has(node))
    return;
  this.requireUses.add(node);

  current.bailout('Invalid use of `require`', node.loc);
};

Analyzer.prototype.getUnresolvedModule = function getUnresolvedModule(issuer,
                                                                      name) {
  let issuerMap;
  if (this.unresolved.has(issuer)) {
    issuerMap = this.unresolved.get(issuer);
  } else {
    issuerMap = new Map();
    this.unresolved.set(issuer, issuerMap);
  }

  let module;
  if (issuerMap.has(name)) {
    module = issuerMap.get(name);
  } else {
    module = new Module(name);
    issuerMap.set(name, module);
  }

  // Already resolved
  if (typeof module === 'string')
    return this.getModule(module);

  return module;
};

Analyzer.prototype.bailout = function bailout(reason, loc, source) {
  if (this.bailouts)
    this.bailouts.push({ reason, loc, source });
  else
    this.bailouts = [ { reason, loc, source } ];
};
