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
  this.moduleUses = new Map();

  // Uses of `exports` in module. A collection of AST nodes.
  this.exportsUses = new Set();
}
module.exports = Analyzer;

Analyzer.prototype.run = function run(ast, resource) {
  this.gather(ast, resource);
  this.sift(ast, this.getModule(resource));
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

    // TODO(indutny): resolve this
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
    }
  });

  this.moduleUses.forEach((module, use) => {
    module.bailout('Strange uses');
  });
};

Analyzer.prototype.siftAssignment = function siftAssignment(node, current) {
  if (node.left.type === 'Identifier' && node.left.name === 'exports') {
    current.bailout('exports assignment');
    return;
  }

  if (node.left.type !== 'MemberExpression')
    return;

  const member = node.left;

  if (this.moduleUses.has(member.object)) {
    const module = this.moduleUses.get(member.object);
    module.bailout('Module property assignment');
    return;
  }

  if (member.object.type !== 'Identifier')
    return;

  const object = member.object.name;
  if (object !== 'exports' && object !== 'module')
    return;

  if (member.property.type !== (member.computed ? 'Literal' : 'Identifier')) {
    current.bailout('Dynamic CommonJS export');
    return;
  }

  if (object === 'module') {
    current.bailout('module.exports assignment');
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
  } else if (this.moduleUses.has(node.object)) {
    module = this.moduleUses.get(node.object);
    this.moduleUses.delete(node.object);
  } else {
    return;
  }

  if (node.property.type !== (node.computed ? 'Literal' : 'Identifier')) {
    module.bailout('Dynamic CommonJS import/use');
    return;
  }

  const prop = node.property.name || node.property.value;
  module.use(prop);
};

Analyzer.prototype.getModule = function getModule(file) {
  let module;
  if (this.modules.has(file)) {
    module = this.modules.get(file);
  } else {
    module = new Module(file);
    this.modules.set(file, module);
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
    module = new Module(null);
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
