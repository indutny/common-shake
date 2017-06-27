'use strict';

const shake = require('../shake');
const Module = shake.Module;
const ShakeParserPlugin = shake.ShakeParserPlugin;
const Replacement = shake.Replacement;

function ShakePlugin() {
  this.modules = new Map();
  this.unresolved = new Map();
  this.resolution = new Map();
}
module.exports = ShakePlugin;

ShakePlugin.prototype.getModule = function getModule(file) {
  let module;
  if (this.modules.has(file)) {
    module = this.modules.get(file);
  } else {
    module = new Module(file);
    this.modules.set(file, module);
  }
  return module;
};

ShakePlugin.prototype.getUnresolvedModule = function getUnresolvedModule(issuer,
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

ShakePlugin.prototype.resolve = function resolve(issuer, name, to) {
  const unresolved = this.getUnresolvedModule(issuer, name);
  const resolved = this.getModule(to);
  resolved.mergeFrom(unresolved);
  this.unresolved.get(issuer).set(name, to);
};

ShakePlugin.prototype.apply = function apply(compiler) {
  compiler.plugin('compilation', (compilation, params) => {
    const imports = new Map();

    params.normalModuleFactory.plugin('parser', (parser, parserOptions) => {
      if (typeof parserOptions.commonjs !== 'undefined' &&
        !parserOptions.commonjs) {
        return;
      }

      parser.apply(new ShakeParserPlugin(this));
    });

    params.normalModuleFactory.plugin('create-module', (module) => {
      const issuer = module.resourceResolveData.context.issuer;
      if (issuer === null)
        return;
      this.resolve(issuer, module.rawRequest, module.resource);
    });

    compilation.plugin('optimize-modules-advanced', (modules) => {
      for (let i = 0; i < modules.length; i++)
        this.applyModule(modules[i]);
    });
  });
};

ShakePlugin.prototype.applyModule = function applyModule(module) {
  // TODO(indutny): figure out why it happens
  if (typeof module.resource !== 'string')
    return;

  this.getModule(module.resource).fillExports(module);
};
