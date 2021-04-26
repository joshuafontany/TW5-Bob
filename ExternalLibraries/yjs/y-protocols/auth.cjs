'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var encoding = require('../../lib0/dist/encoding.cjs');
var decoding = require('../../lib0/dist/decoding.cjs');
require('../yjs.cjs');

const messagePermissionDenied = 0;

/**
 * @param {encoding.Encoder} encoder
 * @param {string} reason
 */
const writePermissionDenied = (encoder, reason) => {
  encoding.writeVarUint(encoder, messagePermissionDenied);
  encoding.writeVarString(encoder, reason);
};

/**
 * @callback PermissionDeniedHandler
 * @param {any} y
 * @param {string} reason
 */

/**
 *
 * @param {decoding.Decoder} decoder
 * @param {Y.Doc} y
 * @param {PermissionDeniedHandler} permissionDeniedHandler
 */
const readAuthMessage = (decoder, y, permissionDeniedHandler) => {
  switch (decoding.readVarUint(decoder)) {
    case messagePermissionDenied: permissionDeniedHandler(y, decoding.readVarString(decoder));
  }
};

exports.messagePermissionDenied = messagePermissionDenied;
exports.readAuthMessage = readAuthMessage;
exports.writePermissionDenied = writePermissionDenied;
