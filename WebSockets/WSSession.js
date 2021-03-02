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
    this.wikiName = options.wikiName || $tw.wikiName;
    this.ip = options.ip || null;
    this.id = options.id || null;
    this.token = options.token || null;
    this.tokenEOL = options.tokenEOL || null;
    this.userid = options.userid || null;
    this.username = options.username || null;
    this.access = options.access || this.accessLevels.Reader,
    this.isLoggedIn = options.isLoggedIn || null;
    this.isReadOnly = options.isReadOnly || null;
    this.isAnonymous = options.isAnonymous || null;
    this.state = options.state || null;
    this.socket = options.socket || null;
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
        state.delay = $tw.Bob.settings.reconnect.initial || 100;
        state.attempts = 0;
        state.retryTimeout = null
    }
    this.state = state;
}

exports.WebSocketSession = WebSocketSession;

})();