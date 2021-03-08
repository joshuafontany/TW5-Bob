/*\
title: $:/plugins/OokTech/Bob/WSSession.js
type: application/javascript
module-type: library

A simple websocket session prototype. On the server-side, these methods
are called by the SessionManager and the WebSocketServer, on the client
side they are called by the WebSocketClient.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
  A simple websocket session model
  options: 
*/
function WebSocketSession(options) {
  options = options || {};
  this.id = options.id;
  this.token = options.token;
  this.tokenEOL = options.tokenEOL;
  this.ip = options.ip;
  this.referer = options.referer;
  this.wikiName = options.wikiName || $tw.wikiName;
  this.userid = options.userid;
  this.displayUsername = options.displayUsername;
  this.access = options.access,
  this.isLoggedIn = options.isLoggedIn;
  this.isReadOnly = options.isReadOnly;
  this.isAnonymous = options.isAnonymous;
  this.url = options.url;
  this.socket = null;
  this.state = null;
  this.initState();
}

WebSocketSession.prototype.accessLevels = {
  Reader: "reader",
  Writer: "writer",
  Admin: "admin"
}

WebSocketSession.prototype.initState = function() {
    let state = {}
    if ($tw.node) {
        state.alive = false;
    } else {
        state.pingTimeout = null;
        state.ping = null;
        state.disconnected = null;
        state.reconnecting = null;
        state.delay = 100;
        state.attempts = 0;
        state.retryTimeout = null
    }
    this.state = state;
}

exports.WebSocketSession = WebSocketSession;

})();