'use strict';

const escope = require('escope');
const estraverse = require('estraverse');

function Module(name) {
  this.name = name;
  this.bailoutReason = false;
  this.uses = new Set();
  this.declarations = new Set();
}

Module.prototype.bailout = function bailout(reason) {
  this.bailoutReason = reason || true;
};

Module.prototype.use = function use(prop) {
  this.uses.add(prop);
};

Module.prototype.declare = function declare(prop) {
  this.declarations.add(prop);
};

function ShakeParserPlugin(current, modules) {
  this.moduleUses = new Map();
  this.current = current;
  this.modules = modules;
}

ShakeParserPlugin.prototype.apply = function apply(parser) {
  parser.plugin('program', (ast) => {
    this.gather(ast);
    this.sift(ast);
  });
};

ShakeParserPlugin.prototype.gather = function gather(ast) {
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

    let module;
    if (this.modules.has(name)) {
      module = this.modules.get(name);
    } else {
      module = new Module(name);
      this.modules.set(name, module);
    }

    for (let i = 0; i < decl.references.length; i++) {
      const ref = decl.references[i];
      this.moduleUses.set(ref.identifier, module);
    }
  }
};

ShakeParserPlugin.prototype.sift = function sift(ast) {
  estraverse.traverse(ast, {
    enter: (node) => {
      if (node.type === 'AssignmentExpression')
        this.siftAssignment(node);
      else if (node.type === 'MemberExpression')
        this.siftMember(node);
    }
  });
};

ShakeParserPlugin.prototype.siftAssignment = function siftAssignment(node) {
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
    this.current.bailout('Dynamic CommonJS export');
    return;
  }

  if (object === 'module') {
    this.current.bailout('module.exports assignment');
    return;
  }

  const prop = member.property.name || member.property.value;
  this.current.declare(prop);
};

ShakeParserPlugin.prototype.siftMember = function siftMember(node) {
  if (!this.moduleUses.has(node.object))
    return;

  const module = this.moduleUses.get(node.object);

  if (node.property.type !== (node.computed ? 'Literal' : 'Identifier')) {
    module.bailout('Dynamic CommonJS import');
    return;
  }

  const prop = node.property.name || node.property.value;
  module.use(prop);
};

function ShakePlugin() {
}

ShakePlugin.prototype.apply = function apply(compiler) {
  compiler.plugin('compilation', (compilation, params) => {
    params.normalModuleFactory.plugin('parser', (parser, parserOptions) => {
      if (typeof parserOptions.commonjs !== 'undefined' &&
        !parserOptions.commonjs) {
        return;
      }

      parser.apply(new ShakeParserPlugin(new Module('current'), new Map()));
    });

    compilation.plugin('optimize-modules-advanced', (modules) => {
      modules.forEach(module => this._applyModule(module));
    });
  });
};

ShakePlugin.prototype._applyModule = function _applyModule(module) {
//  console.log(module.dependencies.map(dep => dep.loc));
};

module.exports = ShakePlugin;
