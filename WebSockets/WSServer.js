/*\
title: $:/plugins/OokTech/Bob/WSServer.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const Server = require('$:/plugins/OokTech/Bob/External/WS/ws.js').Server,
SessionManager = require('$:/plugins/OokTech/Bob/SessionManager.js').SessionManager;

/*
  A simple websocket server extending the `ws` library
  options: 
*/
function WebSocketServer(options) {
  Server.call(this, options);
  this.manager = options.manager || new SessionManager();
  // Set the event handlers
  this.on('listening',this.serverOpened);
  this.on('close',this.serverClosed);
  this.on('connection',this.handleConnection);
}

WebSocketServer.prototype = Object.create(Server.prototype);
WebSocketServer.prototype.constructor = WebSocketServer;

WebSocketServer.prototype.defaultVariables = {

};

WebSocketServer.prototype.serverOpened = function() {

}

WebSocketServer.prototype.serverClosed = function() {

}

/*
  This function handles incomming connections from a client.
  It currently only supports one client and if a new client connection is made
  it will replace the current connection.
  This function saves the connection and adds the message handler wrapper to
  the client connection.
  The message handler part is a generic wrapper that checks to see if we have a
  handler function for the message type and if so it passes the message to the
  handler, if not it prints an error to the console.

  connection objects are:
  {
    "socket": socketObject,
    "wiki": the name for the wiki using this connection
  }
*/
WebSocketServer.prototype.handleConnection = function(socket,request) {
  let ip = request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
    request.connection.remoteAddress,
    id = null; //parse from request?
  $tw.Bob.logger.log(`New client session from ip: ${ip}, id: ${id}`, {level:2});
  $tw.Bob.logger.log(`Request:`, JSON.stringify(request), {level:4});
  // Event handlers
  socket.on('message', this.handleMessage);
  socket.on('close', this.closeConnection);
  socket.id = id;
  // Setup session object
  this.manager.addSession({
    "id": id,
    'socket': socket, 
    'url': ip, 
    'wiki': undefined, 
    'disconnected': null, 
    'reconnect': null
  });
  // Respond to the initial connection with a request for the tiddlers the
  // browser currently has to initialise everything.
  const message = {type: 'listTiddlers'}
  //$tw.Bob.SendToBrowser($tw.Bob.sessions[Object.keys($tw.Bob.sessions).length-1], message);
  if(false && $tw.node && $tw.Bob.settings.enableFederation === 'yes') {
    $tw.Bob.Federation.updateConnections();
  }
}

WebSocketServer.prototype.closeConnection = function(event) {
    let id = this.id;
    $tw.Bob.logger.log(`Closed client session from ip: ${this.manager.getSession(id).url}, id: ${id}`, JSON.stringify(event), {level:2});
}

/*
  This makes sure that the token sent allows the action on the wiki
*/
WebSocketServer.prototype.authenticateMessage = function(event) {
  return this.AccessCheck(event.wiki, event.token, event.type);
}

/*
  The handle message function, split out so we can use it other places
*/
WebSocketServer.prototype.handleMessage = function(event) {
  // Determine which connection the message came from
  let self = this;
  const connectionIndex = $tw.Bob.sessions.findIndex(function(connection) {return connection.socket === self;});
  try {
    let eventData = JSON.parse(event);
    // Add the source to the eventData object so it can be used later.
    eventData.source_connection = connectionIndex;
    // If the wiki on this connection hasn't been determined yet, take it
    // from the first message that lists the wiki.
    // After that the wiki can't be changed. It isn't a good security
    // measure but this part doesn't have real security anyway.
    // TODO figure out if this is actually a security problem.
    // We may have to add a check to the token before sending outgoing
    // messages.
    // This is really only a concern for the secure server, in that case
    // you authenticate the token and it only works if the wiki matches
    // and the token has access to that wiki.
    if(eventData.wiki && eventData.wiki !== $tw.Bob.sessions[connectionIndex].wiki && !$tw.Bob.sessions[connectionIndex].wiki) {
      $tw.Bob.sessions[connectionIndex].wiki = eventData.wiki;
      // Make sure that the new connection has the correct list of tiddlers
      // being edited.
      $tw.ServerSide.UpdateEditingTiddlers(false, eventData.wiki);
    }
    // Make sure that the connection is from the wiki the message is for.
    // This may not be a necessary security measure.
    // I don't think that not having this would open up any exploits but I am not sure.
    // TODO figure out if this is needed.
    if(eventData.wiki === $tw.Bob.sessions[connectionIndex].wiki) {
      // Make sure we have a handler for the message type
      if(typeof $tw.Bob.nodeMessageHandlers[eventData.type] === 'function') {
        // Check authorisation
        const authorised = this.authenticateMessage(eventData);
        if(authorised) {
          if (eventData.type !== "ping" && eventData.type !== "pong") {
            $tw.Bob.logger.log(`Received websocket message ${eventData.id}:`, event, {level:4});
          }
          eventData.decoded = authorised;
          // Acknowledge the message, then call handler(s)
          $tw.utils.sendMessageAck(eventData);
          $tw.Bob.nodeMessageHandlers[eventData.type](eventData);
          //debugger;
          this.handledMessages = this.handledMessages || {};
          if(!this.handledMessages[eventData.id]) this.handledMessages[eventData.id] = 0;
          this.handledMessages[eventData.id] = this.handledMessages[eventData.id]++;
        }
      } else {
        $tw.Bob.logger.error('No handler for message of type ', eventData.type, {level:3});
      }
    } else {
      $tw.Bob.logger.log('Target wiki and connected wiki don\'t match', {level:3});
    }
  } catch (e) {
    $tw.Bob.logger.error("WS handleMessage error: ", e, {level:1});
  }
}

  /*
  This function checks to see if the current action is allowed with the
  access level given by the supplied token

  If access controls are not enabled than this just returns true and
  everything is allowed.

  If access controls are enabled than this needs to check the token to get
  the list of wikis and actions that are allowed to it and if the action is
  allowed for the wiki return true, otherwise false.
*/
WebSocketServer.prototype.AccessCheck = function(fullName, token, action, category) {
  return true;
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
});