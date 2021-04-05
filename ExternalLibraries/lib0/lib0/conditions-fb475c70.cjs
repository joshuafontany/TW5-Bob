'use strict';

/**
 * Often used conditions.
 *
 * @module conditions
 */

/**
 * @template T
 * @param {T|null|undefined} v
 * @return {T|null}
 */
/* istanbul ignore next */
const undefinedToNull = v => v === undefined ? null : v;

var conditions = /*#__PURE__*/Object.freeze({
	__proto__: null,
	undefinedToNull: undefinedToNull
});

exports.conditions = conditions;
exports.undefinedToNull = undefinedToNull;

