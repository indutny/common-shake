'use strict';
/* globals describe it beforeEach afterEach */

const assertText = require('assert-text');
const acorn = require('acorn-dynamic-import').default;

assertText.options.trim = true;

const shake = require('../');
const Analyzer = shake.Analyzer;
const Graph = shake.Graph;

function parse(source) {
  return acorn.parse(source, {
    locations: true,
    sourceType: 'module',
    ecmaVersion: 2017,
    plugins: {
      dynamicImport: true
    }
  });
}

describe('Analyzer', () => {
  let analyzer;
  let graph;

  beforeEach(() => {
    analyzer = new Analyzer();
    graph = new Graph(__dirname);
  });

  afterEach(() => {
    analyzer = null;
    graph = null;
  });

  it('should find all exported values', () => {
    analyzer.run(parse(`
      // Import all
      require('./a')[K];

      require('./b').bprop;

      exports.prop = 1;
    `), 'root');

    analyzer.run(parse(`
      exports.aprop = 1;
    `), 'a');

    analyzer.run(parse(`
      exports.bprop = 1;
    `), 'b');

    analyzer.resolve('root', './a', 'a');
    analyzer.resolve('root', './b', 'b');

    const out = graph.generate(analyzer.getModules());
    assertText.equal(out, `digraph {
      "../root" [shape=box color=black];
      "{../root}[prop]" [color=black];
      "../root" -> "{../root}[prop]" [dir=none color=black];
      "../a" [shape=box color=red];
      "{../a}[aprop]" [color=red];
      "../a" -> "{../a}[aprop]" [dir=none color=red];
      "../root" -> "../a" [label="*"];
      "../b" [shape=box color=black];
      "../root" -> "../b" [label="bprop"];
    }`);
  });
});
