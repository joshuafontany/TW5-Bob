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
  const WebSocket = require('$:/plugins/OokTech/Bob/External/WS/ws.js'),
  { v4: uuid_v4, NIL: uuid_NIL, validate: uuid_validate } = require('$:/plugins/OokTech/Bob/External/uuid/src/index.js');

/*
  A simple websocket server extending the `ws` library
  options: 
*/
function WebSocketServer(options) {
  Object.assign(this, new WebSocket.Server(options));
  // Set the event handlers
  this.on('listening',this.serverOpened);
  this.on('close',this.serverClosed);
  this.on('connection',this.handleConnection);
}

WebSocketServer.prototype = Object.create(WebSocket.Server.prototype);
WebSocketServer.prototype.constructor = WebSocketServer;

WebSocketServer.prototype.defaultVariables = {

};

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
  $tw.Bob.logger.log(`['${state.sessionId}'] Opened socket ${socket._socket._peername.address}:${socket._socket._peername.port}`, {level:3});
  // Save the socket id
  socket.id = state.sessionId;
  $tw.Bob.wsManager.setSocket(socket);
  // Event handlers
  socket.on('message', function(event) {
    let eventData
    try {
      eventData = JSON.parse(event);
    } catch (e) {
      $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
    }
    let session = $tw.Bob.wsManager.getSession(eventData.sessionId);
    if(session && session.id == this.id) {
      session.handleMessage(eventData);
    } else {
      $tw.Bob.logger.error('WS handleMessage error: Invalid or missing session', eventData, {level:3});
    }
  });
  socket.on('close', function(event) {
    $tw.Bob.logger.log(`['${socket.id}'] Closed socket ${socket._socket._peername.address}:${socket._socket._peername.port}  (code ${socket._closeCode})`);
  });
  // Federation here? Why?
  if(false && $tw.node && $tw.Bob.settings.enableFederation === 'yes') {
    $tw.Bob.Federation.updateConnections();
  }
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

WebSocketServer.prototype.requestSession = function(state) {
  let userSession, 
      wikiName = state.queryParameters["wiki"],
      sessionId = state.queryParameters["session"];
  if(sessionId == uuid_NIL || !$tw.Bob.wsManager.hasSession(sessionId)  
      || $tw.Bob.wsManager.getSession(sessionId).username !== state.authenticatedUsername) {
      // Anon users always have a new random userid created
      userSession = $tw.Bob.wsManager.newSession({
          id: uuid_v4(),
          ip: state.ip,
          referer: state.referer,
          wikiName: wikiName,
          userid: !state.anonymous? state.authenticatedUsername: uuid_v4(),
          username: state.username,
          access: this.getUserAccess((state.anonymous)? null: state.authenticatedUsername,wikiName),
          isLoggedIn: !!state.authenticatedUsername,
          isReadOnly: !!state["read_only"],
          isAnonymous: !!state.anonymous
      });
  } else {
      userSession = $tw.Bob.wsManager.getSession(sessionId);
  }
  // Set a new login token and login tokenEOL. Only valid for 60 seconds.
  // These will be replaced with a session token during the "handshake".
  let eol = new Date().getTime() + (1000*60);
  userSession.tokenEOL = new Date(eol).getTime();
  userSession.token = uuid_v4();
  // Log the session in this.authorizedUsers or this.anonymousUsers
  $tw.Bob.wsManager.setSession(userSession);
  $tw.Bob.wsManager.updateUser(userSession);
  return userSession;
}

WebSocketServer.prototype.refreshSession = function(session) {
  let test = new Date().getTime() + (1000*60*5);
  if(session.tokenEOL <= test) {
      let eol = new Date(session.tokenEOL).getTime() + (1000*60*60);
      session.tokenEOL = new Date(eol).getTime();
      session.token = uuid_v4();
  }
  session.state.isAlive = true;
  return session;
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