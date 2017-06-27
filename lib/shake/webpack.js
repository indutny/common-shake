'use strict';

const shake = require('../shake');

function ShakeParserPlugin(analyzer) {
  this.analyzer = analyzer;
}

ShakeParserPlugin.prototype.apply = function apply(parser) {
  parser.plugin('program', (ast) => {
    this.analyzer.run(ast, parser.state.current.resource);
  });
};

function ShakePlugin() {
  this.analyzer = new shake.Analyzer();
}
module.exports = ShakePlugin;

ShakePlugin.prototype.apply = function apply(compiler) {
  compiler.plugin('compilation', (compilation, params) => {
    const imports = new Map();

    params.normalModuleFactory.plugin('parser', (parser, parserOptions) => {
      if (typeof parserOptions.commonjs !== 'undefined' &&
        !parserOptions.commonjs) {
        return;
      }

      parser.apply(new ShakeParserPlugin(this.analyzer));
    });

    params.normalModuleFactory.plugin('create-module', (module) => {
      const issuer = module.resourceResolveData.context.issuer;
      if (issuer === null)
        return;
      // TODO(indutny): this doesn't play well with package.browser
      this.analyzer.resolve(issuer, module.rawRequest, module.resource);
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

  const info = this.analyzer.getModule(module.resource).getInfo();
  if (info.bailouts)
    return;

  module.providedExports = info.declarations;
  module.usedExports = info.uses;
  module.used = module.usedExports.length !== 0;
};
