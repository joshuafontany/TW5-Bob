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
  const Server = require('$:/plugins/OokTech/Bob/External/WS/ws.js').Server,
  { v4: uuid_v4, NIL: uuid_NIL, validate: uuid_validate } = require('$:/plugins/OokTech/Bob/External/uuid/src/index.js');

/*
  A simple websocket server extending the `ws` library
  options: 
*/
function WebSocketServer(options) {
  Object.assign(this, new Server(options));
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
  // Save the socket id
  socket.id = state.sessionId;
  $tw.Bob.wsManager.setSocket(socket);
  // Event handlers
  socket.on('message', function(event) {
    try {
      let eventData = JSON.parse(event);
      if(eventData.sessionId == socket.id) {
        // The Session Manager handles messages
        $tw.Bob.wsManager.handleMesage(eventData);
      } else {
        $tw.Bob.logger.error('WS handleMessage error: Invalid or missing sessionId', eventData, {level:3});
      }
    } catch (e) {
        $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
    }
  });
  socket.on('close', function(event) {
    $tw.Bob.logger.log(`Closed connection: ${socket.id} `+JSON.stringify(socket._peername, null, 4));
  });
  // Federation here? Why?
  if(false && $tw.node && $tw.Bob.settings.enableFederation === 'yes') {
    $tw.Bob.Federation.updateConnections();
  }
}

WebSocketManager.prototype.isAdmin = function(username) {
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
  let eol = new Date();
  userSession.tokenEOL = eol.setMinutes(eol.getMinutes() + 1);
  userSession.token = uuid_v4();
  // Log the session in this.authorizedUsers or this.anonymousUsers
  this.updateUser(userSession);
  return userSession;
}

WebSocketServer.prototype.verifyUpgrade = function(state) {
  let userSession;
  if(this.hasSession(state.sessionId)) {
      userSession = this.getSession(state.sessionId);
      // username, ip, & wikiName must match (token is tested in the 'handshake')
      if(
          state.username == userSession.username
          && state.ip == userSession.ip
          && state.wikiName == userSession.wikiName
      ) {
          return state;
      } else {
          return false;
      };
  } else {
      return false;
  }
}

WebSocketServer.prototype.refreshSession = function(sessionId) {
  let test = new Date(),
      session = this.getSession(sessionId);
  test.setMinutes(test.getMinutes() + 5);
  if(session.tokenEOL <= test) {
      let eol = new Date(session.tokenEOL);
      session.tokenEOL = eol.setHours(eol.getHours() + 1);
      session.token = uuid_v4();
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