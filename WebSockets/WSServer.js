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

/*
  A simple websocket server extending the `ws` library
  options: 
*/
function WebSocketServer(options) {
  Object.assign(this, new $tw.Bob.ws.Server(options));
  // Set the event handlers
  this.on('listening',this.serverOpened);
  this.on('close',this.serverClosed);
  this.on('connection',this.handleConnection);
}

WebSocketServer.prototype = Object.create(require('./External/ws/ws.js').Server.prototype);
WebSocketServer.prototype.constructor = WebSocketServer;

WebSocketServer.prototype.defaultVariables = {

};

WebSocketServer.prototype.serverOpened = function() {

}

WebSocketServer.prototype.serverClosed = function() {

}

WebSocketServer.prototype.isAdmin = function(username) {
  if(!!username && !!$tw.Bob.server) {
    return $tw.Bob.server.isAuthorized("admin",username);
  } else {
    return null;
  }
}

WebSocketServer.prototype.getUserAccess = function(username,wikiName) {
  wikiName = wikiName || 'RootWiki';
  if(!!username && !!$tw.Bob.server) {
      let type, accessPath = (wikiName == 'RootWiki')? "" : wikiName+'/';
      type = ($tw.Bob.server.isAuthorized(accessPath+"readers",username))? "readers" : null;
      type = ($tw.Bob.server.isAuthorized(accessPath+"writers",username))? "writers" : type;
      type = ($tw.Bob.server.isAuthorized("admin",username))? "admin" : type;
      return type;
  }
  return null;
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
  $tw.Bob.logger.log(`['${state.sessionId}'] Opened socket ${socket._socket._peername.address}:${socket._socket._peername.port}`, {level:3});
  let session = $tw.Bob.wsManager.getSession(state.sessionId);
  // Event handlers
  socket.on('close', function(event) {
    $tw.Bob.logger.log(`['${session.id}'] Closed socket ${socket._socket._peername.address}:${socket._socket._peername.port}  (code ${socket._closeCode})`);
    $tw.Bob.wsManager.closeYConnections(session);
  });
  socket.on('message', function(event) {
    let parsed;
    try {
      parsed = JSON.parse(event);
    } catch (e) {
      $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
    }
    let eventData = parsed || event;
    if(eventData.sessionId && eventData.sessionId == session.id) {
      session.handleMessage(eventData);
    } else {
      console.error(`['${sesion.id}'] handleMessage error: Invalid or missing session id`, JSON.stringify(eventData,null,4));
      this.close(4023, `['${sesion.id}'] Websocket closed by server`);
    }
  });
  session.initState(socket);
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