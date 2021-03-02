/*\
title: $:/plugins/OokTech/Bob/WSUser.js
type: application/javascript
module-type: library

A simple websocket user prototype. On the server-side, these methods
are called by the SessionManager and the WebSocketServer.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";


/*
  A simple websocket user model
  options: 
*/
function WebSocketUser(options) {
    options = options || {};
    this.id = options.userid || options.username;
    this.username = options.username;
    this.isAnonymous = !!options.isAnonymous;
    // A set to store the session ids
    this.sessions = new Set();
    if (options.session) {
        this.sessions.add(options.session.id);
    }
}

WebSocketUser.prototype.isAdmin = function() {
    return $tw.Bob.wsServer.iAdmin(this.username);
}

exports.WebSocketUser = WebSocketUser;

})();