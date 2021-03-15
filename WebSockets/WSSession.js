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
  this.id = options.id; // Required uuid_4()
  this.client = !!options.client || false; // Is this a "client" session
  this.token = options.token; // Regenerating uuid_4()
  this.tokenEOL = options.tokenEOL; // End-of-Life for this.token
  this.ip = options.ip; // The ip address for the other end of the socket connection
  this.referer = options.referer; // Set by the initial upgrade (auto-set in browsers)
  this.wikiName = options.wikiName || $tw.wikiName; // The name of the wiki for the session
  this.userid = options.userid; // The internal userid
  this.displayUsername = options.displayUsername; // The display username
  this.access = options.access, // The user-sesion's access level
  this.isLoggedIn = options.isLoggedIn; // User's login state
  this.isReadOnly = options.isReadOnly; // User-session + Wiki's read-only state
  this.isAnonymous = options.isAnonymous; // User's anon state
  this.url = options.url; // The url obj used to connect
  this.messageId = 0; // The current message id
  this.messages = new Map(options.messages || []); // The session's message queue
  this.initState(); // Init the 
}

WebSocketSession.prototype.accessLevels = {
  Reader: "reader",
  Writer: "writer",
  Admin: "admin"
}

WebSocketSession.prototype.initState = function() {
  let newState;
  if (this.client) {
    newState = {
      pingTimeout: null,
      ping: null,
      disconnected: null,
      reconnecting: null,
      delay: 100,
      attempts: 0,
      retryTimeout: null
    };
  } else {
    newState = {alive: false};
  }
  this.state = newState;
}

/*
  This returns a new id for a message.
  Messages from the browser have ids that start with c for client, 
  messages from the server have an id that starts with s for server.
*/
WebSocketSession.prototype.getMessageId = function() {
  let id = (this.client)? "c": "s" + this.messageId++
  return id;
}

/*
  This enqueues a message, then checks a session's socket readyState
  and attempts to send the message. The minimum message is:
  {
    type: "messageType"
  }
*/
WebSocketSession.prototype.prepareMessage = function(message) {
  message = $tw.utils.extend({
    id: this.getMessageId(),
    sessionId: this.id,
    token: this.token,
    userid: this.userid,
    wikiName: this.wikiName
  },message);
  this.enqueueMessage(message);
  return JSON.stringify(message);
}

/*
  This enqueues a message to wait for incoming ack.
*/
WebSocketSession.prototype.enqueueMessage = function(message) {
  this.messages.add(message.id,{message: message, ack: false})
}

exports.WebSocketSession = WebSocketSession;

})();