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

  Session objects are defined in $:/plugins/OokTech/Bob/WSSession.js
*/
WebSocketServer.prototype.handleConnection = function(socket,request,state) {
  if($tw.Bob.wsManager.getSession(state.sessionId)) {
    let session = $tw.Bob.wsManager.getSession(state.sessionId);
    session.ip = state.ip;
    session.url = state.urlInfo;
    $tw.Bob.logger.log(`['${state.sessionId}'] Opened socket ${socket._socket._peername.address}:${socket._socket._peername.port}`, {level:3});
    // Event handlers
    socket.on('message', function(event) {
      try {
        if (typeof event == "string") {
          parsed = JSON.parse(event);
        } else if (!!event.data && typeof event.data == "string") {
          parsed = JSON.parse(event.data);
        }        
      } catch (e) {
        $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
      }
      eventData = parsed||event;
      if(session.authenticateMessage(eventData)) {
        session.lastMessageReceived = time.getUnixTime();
        if(eventData.type == "y" ) {
          session.emit('y', [eventData, session]);
        } else {
          session.emit('message', [eventData, session]);
        }
      }
    });
    socket.on('close', function(event) {
      $tw.Bob.logger.log(`['${session.id}'] Closed socket ${socket._socket._peername.address}:${socket._socket._peername.port}  (code ${socket._closeCode})`);
      session.closeYProviders();
    });
    socket.on("error", function(error) {
      console.log(`['${session.id}'] socket error:`, JSON.toString(error));
    })
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