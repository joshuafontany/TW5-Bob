/*\
title: $:/plugins/OokTech/Bob/WSServer.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

if($tw.node) {
  const Server = require('$:/plugins/OokTech/Bob/External/WS/ws.js').Server;

/*
  A simple websocket server extending the `ws` library
  options: 
*/
function WebSocketServer(options) {
  Object.assign(this, new Server(options));
  // Reserve a connection for the session manager
  this.manager = null;
  // Load the node-messagehandlers modules
  this.messageHandlers = {};
  $tw.modules.applyMethods("node-messagehandlers",this.messageHandlers);
  // Set the event handlers
  this.on('listening',this.serverOpened);
  this.on('close',this.serverClosed);
  this.on('connection',this.handleConnection);
}

WebSocketServer.prototype = Object.create(Server.prototype);
WebSocketServer.prototype.constructor = WebSocketServer;

WebSocketServer.prototype.defaultVariables = {

};

WebSocketServer.prototype.isAdmin = function(username) {
  return this.manager.isAdmin(username);
}

WebSocketServer.prototype.serverOpened = function() {

}

WebSocketServer.prototype.serverClosed = function() {

}

/*
  This function handles incomming connections from client sessions.
  It can support multiple client sessions, each with a unique sessionId. 
  This function adds the message handler wrapper and the sessionId to
  the client socket.
  The message handler part is a generic wrapper that checks to see if we have a
  handler function for the message type and if so it passes the message to the
  handler, if not it prints an error to the console.

  Session objects are defined in $:/plugins/OokTech/Bob/WSSession.js
*/
WebSocketServer.prototype.handleConnection = function(socket,request,state) {
  $tw.Bob.logger.log(`'${state.sessionId}': New client session from ip ${state.ip}`, {level:3});
  // Event handlers
  socket.on('message', this.handleMessage);
  socket.on('close', this.closeConnection);
  // Save the socket
  socket.id = state.sessionId;
  this.manager.setSocket(socket);
  // Federation here? Why?
  if(false && $tw.node && $tw.Bob.settings.enableFederation === 'yes') {
    $tw.Bob.Federation.updateConnections();
  }
}

WebSocketServer.prototype.closeConnection = function(event) {
    $tw.Bob.logger.log(`Closed connection: ${this.id} `+JSON.stringify(this._peername, null, 4));
  }

/*
  This makes sure that the token sent allows the action on the wiki
*/
WebSocketServer.prototype.authenticateMessage = function(eventData) {
  let session = this.manager.getSession(eventData.sessionId);
  let now = new Date();
  return (
    eventData.wikiName == session.wikiName && eventData.userid == session.userid  
    && eventData.token == session.token && now <= session.tokenEOL
  );
}

/*
  The handle message function
*/
WebSocketServer.prototype.handleMessage = function(event) {
  try {
    let eventData = JSON.parse(event);
    if (eventData.sessionId == this.id) {
      // Check authentication
      const authenticated = $tw.Bob.wsServer.authenticateMessage(eventData);
      // Make sure we have a handler for the message type
      if(!!authenticated && typeof $tw.Bob.wsServer.messageHandlers[eventData.type] === 'function') {
        if (eventData.type !== "ping" && eventData.type !== "pong") {
          $tw.Bob.logger.log(`Received websocket message ${eventData.id}:`, event, {level:4});
        }
        // Acknowledge the message
        $tw.utils.sendMessageAck(eventData);
        // Determine the wiki instance
        data.instance = (eventData.wikiname == "RootWiki")? $tw: $tw.Bob.ServerSide.getInstance(eventData.wikiName);
        // Call the handler(s)
        $tw.Bob.wsServer.messageHandlers[eventData.type](eventData);
      } else {
        $tw.Bob.logger.error('WS handleMessage error: No handler for message of type ', eventData.type, {level:3});
      }
      $tw.Bob.logger.error('WS handleMessage error: Invalid or missing sessionId', eventData.type, {level:3});
    }
  } catch (e) {
    $tw.Bob.logger.error("WS handleMessage error: ", e, {level:1});
  }
}

/*
  This function checks to see if creating a wiki or uploading a file is
  allowed based on server quotas.
  Using the normal Bob server you have no quotas so this always says it is
  allowed.
*/
WebSocketServer.prototype.CheckQuotas = function(data) {
  return true;
}

exports.WebSocketServer = WebSocketServer;

}
})();