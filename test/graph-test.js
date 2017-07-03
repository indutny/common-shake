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
      ranksep=1.2;
      subgraph "cluster://../root" {
        label="../root";
        color=black;
        "{../root}/require" [label=require shape=diamond];
        "{../root}[prop]" [label="prop" color=blue];
      }
      subgraph "cluster://../a" {
        label="../a";
        color=red;
        "{../a}/require" [label=require shape=diamond];
        "{../a}[aprop]" [label="aprop" color=red];
        "{../a}[[*]]" [label="[*]" color=red];
      }
      "{../root}/require" -> "{../a}[[*]]";
      subgraph "cluster://../b" {
        label="../b";
        color=black;
        "{../b}/require" [label=require shape=diamond];
        "{../b}[bprop]" [label="bprop" color=black];
      }
      "{../root}/require" -> "{../b}[bprop]";
    }`);
  });
});
