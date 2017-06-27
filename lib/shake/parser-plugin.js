'use strict';

const escope = require('escope');
const estraverse = require('estraverse');

function ShakeParserPlugin(shaker) {
  this.shaker = shaker;
  this.moduleUses = new Map();
}
module.exports = ShakeParserPlugin;

ShakeParserPlugin.prototype.apply = function apply(parser) {
  parser.plugin('program', (ast) => {
    this.gather(ast, parser.state.current);
    this.sift(ast, this.shaker.getModule(parser.state.current.resource));
  });
};

ShakeParserPlugin.prototype.gather = function gather(ast, state) {
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

    const module = this.shaker.getUnresolvedModule(state.resource, name);

    for (let i = 0; i < decl.references.length; i++) {
      const ref = decl.references[i];
      if (ref.identifier !== node.id)
        this.moduleUses.set(ref.identifier, module);
    }
  }
};

ShakeParserPlugin.prototype.sift = function sift(ast, current) {
  estraverse.traverse(ast, {
    enter: (node) => {
      if (node.type === 'AssignmentExpression')
        this.siftAssignment(node, current);
      else if (node.type === 'MemberExpression')
        this.siftMember(node);
    }
  });

  this.moduleUses.forEach((module, use) => {
    module.bailout('Strange uses');
  });
};

ShakeParserPlugin.prototype.siftAssignment = function siftAssignment(node,
                                                                     current) {
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
};

ShakeParserPlugin.prototype.siftMember = function siftMember(node) {
  if (!this.moduleUses.has(node.object))
    return;

  const module = this.moduleUses.get(node.object);
  this.moduleUses.delete(node.object);

  if (node.property.type !== (node.computed ? 'Literal' : 'Identifier')) {
    module.bailout('Dynamic CommonJS import');
    return;
  }

  const prop = node.property.name || node.property.value;
  module.use(prop);
};
