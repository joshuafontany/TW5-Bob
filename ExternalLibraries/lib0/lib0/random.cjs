'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var math = require('./math-08e068f9.cjs');
var isomorphic_js = require('../isomorphic.js/iso.js');

const rand = Math.random;

/* istanbul ignore next */
const uint32 = () => new Uint32Array(isomorphic_js.cryptoRandomBuffer(4))[0];

/**
 * @template T
 * @param {Array<T>} arr
 * @return {T}
 */
const oneOf = arr => arr[math.floor(rand() * arr.length)];

// @ts-ignore
const uuidv4Template = [1e7] + -1e3 + -4e3 + -8e3 + -1e11;
const uuidv4 = () => uuidv4Template.replace(/[018]/g, /** @param {number} c */ c =>
  (c ^ uint32() & 15 >> c / 4).toString(16)
);

exports.oneOf = oneOf;
exports.rand = rand;
exports.uint32 = uint32;
exports.uuidv4 = uuidv4;
