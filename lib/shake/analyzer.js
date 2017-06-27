'use strict';

const escope = require('escope');
const estraverse = require('estraverse');

const shake = require('../shake');
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
}
module.exports = Analyzer;

Analyzer.prototype.run = function run(ast, resource) {
  this.requireUses = new Set();
  this.exportsUses = new Set();
  this.moduleUses = new Map();

  this.gather(ast, resource);
  this.sift(ast, this.getModule(resource));

  this.moduleUses = null;
  this.exportsUses = null;
  this.requireUses = null;
};

Analyzer.prototype.gather = function gather(ast, resource) {
  const manager = escope.analyze(ast, {
    nodejsScope: true
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

  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i];

    // TODO(indutny): multiple definitions mean that we have to bailout
    if (decl.defs.length !== 1)
      continue;

    const def = decl.defs[0];
    if (def.type !== 'Variable')
      continue;

    const node = def.node;
    if (node.type !== 'VariableDeclarator')
      continue;

    const init = node.init;
    if (!init || init.type !== 'CallExpression')
      continue;

    if (init.callee.type !== 'Identifier' || init.callee.name !== 'require')
      continue;

    const args = init.arguments;
    if (args.length < 1 || args[0].type !== 'Literal')
      continue;

    const name = args[0].value;
    if (typeof name !== 'string')
      continue;

    const module = this.getUnresolvedModule(resource, name);

    for (let i = 0; i < decl.references.length; i++) {
      const ref = decl.references[i];
      if (ref.identifier !== node.id)
        this.moduleUses.set(ref.identifier, module);
    }
  }
};

Analyzer.prototype.sift = function sift(ast, current) {
  estraverse.traverse(ast, {
    enter: (node) => {
      if (node.type === 'AssignmentExpression')
        this.siftAssignment(node, current);
      else if (node.type === 'MemberExpression')
        this.siftMember(node, current);
      else if (node.type === 'Identifier')
        this.siftRequireUse(node, current);
      else if (node.type === 'CallExpression')
        this.siftRequireCall(node, current);
    }
  });

  this.moduleUses.forEach((module, use) => {
    module.bailout('Escaping value or unknown use', use.loc, current.resource);
  });
};

Analyzer.prototype.siftAssignment = function siftAssignment(node, current) {
  if (node.left.type === 'Identifier') {
    if (node.left.name === 'exports') {
      current.bailout('`exports` assignment', node.loc);
      return;
    }
    if (node.left.name === 'require') {
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
      this.exportsUses.add(member.object);
      current.bailout('Dynamic CommonJS export', member.loc);
    } else {
      current.bailout('Dynamic `module` use', member.loc);
    }
    return;
  }

  if (object === 'module') {
    current.bailout('`module.exports` assignment', node.loc);
    return;
  }

  const name = member.property.name || member.property.value;
  current.declare({ name, ast: node });
  this.exportsUses.add(member.object);
};

Analyzer.prototype.siftMember = function siftMember(node, current) {
  let module;
  if (node.object.type === 'Identifier' && node.object.name === 'exports') {
    // Do not track assignments twice
    if (this.exportsUses.has(node.object))
      return;

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
      module.bailout('Dynamic CommonJS import', node.loc, current.resource);
    }
    return;
  }

  const prop = node.property.name || node.property.value;
  module.use(prop);
};

Analyzer.prototype.siftRequireCall = function siftRequireCall(node, current) {
  const callee = node.callee;
  if (callee.type !== 'Identifier' || callee.name !== 'require')
    return false;

  // Valid `require` use
  this.requireUses.add(callee);

  const args = node.arguments;
  if (args.length < 1)
    return false;

  if (args[0].type !== 'Literal' || typeof args[0].value !== 'string') {
    current.bailout('Dynamic argument of `require`', node.loc);
    return false;
  }

  return this.getUnresolvedModule(current.resource, args[0].value);
};

Analyzer.prototype.siftRequireUse = function siftRequireUse(node, current) {
  if (node.type !== 'Identifier' || node.name !== 'require')
    return;

  if (this.requireUses.has(node))
    return;

  current.bailout('Invalid use of `require`', node.loc);
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

Analyzer.prototype.resolve = function resolve(issuer, name, to) {
  const unresolved = this.getUnresolvedModule(issuer, name);
  const resolved = this.getModule(to);
  resolved.mergeFrom(unresolved);
  this.unresolved.get(issuer).set(name, to);
};
