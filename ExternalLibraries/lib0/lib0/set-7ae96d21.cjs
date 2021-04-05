'use strict';

/**
 * Utility module to work with sets.
 *
 * @module set
 */

const create = () => new Set();

/**
 * @template T
 * @param {Set<T>} set
 * @return {Array<T>}
 */
const toArray = set => Array.from(set);

var set = /*#__PURE__*/Object.freeze({
	__proto__: null,
	create: create,
	toArray: toArray
});

exports.create = create;
exports.set = set;
exports.toArray = toArray;

