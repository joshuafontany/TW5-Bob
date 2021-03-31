/*\
title: $:/plugins/OokTech/Bob/WSSession.js
type: application/javascript
module-type: library

A simple websocket session prototype. On the server-side, these methods
are called by the WebSocketManager and the WebSocketServer, on the client
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
  if (!options.id) {
    throw new Error("WebSocketSession Error: no sesion id provided in constructor.")
  }
  this.id = options.id; // Required uuid_4()
  this.client = !!options.client; // Is this a "client" session
  this.token = options.token; // Regenerating uuid_4()
  this.tokenEOL = options.tokenEOL; // End-of-Life for this.token
  this.ip = options.ip; // The ip address for the other end of the socket connection
  this.referer = options.referer; // Set by the initial upgrade (auto-set in browsers)
  this.wikiName = options.wikiName || $tw.wikiName; // The name of the wiki for the session
  this.userid = options.userid; // The internal userid
  this.username = options.username; // The display username
  this.access = options.access, // The user-sesion's access level
  this.isLoggedIn = options.isLoggedIn; // User's login state
  this.isReadOnly = options.isReadOnly; // User-session + Wiki's read-only state
  this.isAnonymous = options.isAnonymous; // User's anon state
  this.url = options.url; // The url obj used to connect
  this.initState(); // Init the 
}

WebSocketSession.prototype.accessLevels = {
  Reader: "reader",
  Writer: "writer",
  Admin: "admin"
}

WebSocketSession.prototype.initState = function() {
  let newState;
  if(this.client) {
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
    newState = {
      alive: false
    };
  }
  this.state = newState;
}

/*
  This enqueues a message, then checks a session's socket readyState
  and attempts to send the message. The minimum message is:
  {
    type: "message-type"
  }
*/
WebSocketSession.prototype.sendMessage = function(message,callback) {
  let ticket;
  if($tw.Bob.wsManager.hasTicket(message.id)) {
    ticket = $tw.Bob.wsManager.getTicket(message.id);
  } else {
    message.id = this.getMessageId();
    ticket = {
      id: message.id,
      message: JSON.stringify(message),
      ctime: null,
      ack: {}
    };
  }
  if(!!callback && typeof callback == "function"){
    ticket.ack[this.id] = function() {
      return callback.call();
    };
  } else {
    // Waiting = true
    ticket.ack[this.id] = true;
  }
  $tw.Bob.wsManager.setTicket(ticket);
  this.send(message);
}

/*
  This returns a new id for a message.
  Messages from a client (usually the browser) have ids that start with c, 
  messages from a server have ids that starts with s.
*/
WebSocketSession.prototype.getMessageId = function() {
  let id;
  if (this.client) {
    id = "c" + $tw.Bob.wsManager.messageId++
  } else {
    id = "s" + $tw.Bob.wsManager.messageId++
  }
  return id;
}

// This sends a message if the socket is ready.
WebSocketSession.prototype.send = function(message) {
  if($tw.Bob.wsManager.isReady(this.id)) {
    message = $tw.utils.extend({
      wikiName: this.wikiName,
      sessionId: this.id,
      token: this.token,
      userid: this.userid
    },message);
    if (["ack", "ping", "pong"].indexOf(message.type) == -1) {
      console.log(`['${message.sessionId}'] send-${message.id}:`, message.type);
    }
    $tw.Bob.wsManager.getSocket(this.id).send(JSON.stringify(message));
  }
}

// This makes sure that the token sent allows the action on the wiki.
// The message.session.id == socket.id has already been checked.
WebSocketSession.prototype.authenticateMessage = function(eventData) {
  let authed = (
    eventData.wikiName == this.wikiName 
    && eventData.userid == this.userid  
    && eventData.token == this.token
  );
  return (authed && new Date().getTime() <= this.tokenEOL);
}

// The handle message function
WebSocketSession.prototype.handleMessage = function(eventData) {
    // Check authentication
    const authenticated = this.authenticateMessage(eventData),
      handler = (this.client)? $tw.Bob.wsManager.clientHandlers[eventData.type]: $tw.Bob.wsManager.serverHandlers[eventData.type];
    if (!authenticated) {
      // Invalid tokens, kill the socket
      console.error(`WS handleMessage error: Unauthorized message of type ${eventData.type}`);
      $tw.Bob.wsManager.deleteSocket(this.id);
      return null;
    }
    // Make sure we have a handler for the message type
    if(typeof handler === 'function') {
      // If handshake, set the tokenRefresh before acking
      if (this.client && eventData.type == "handshake" && !!eventData.tokenRefresh) {
        this.token = eventData.tokenRefresh;
        this.tokenEOL = eventData.tokenEOL;
      }
      // The following messages do not need to be acknowledged
      let noAck = ['ack', 'ping', 'pong'];
      if(eventData.id && noAck.indexOf(eventData.type) == -1) {
        console.log(`['${eventData.sessionId}'] handle-${eventData.id}:`, eventData.type);
        // Acknowledge the message
        this.send({
          id: 'ack' + eventData.id,
          type: 'ack'
        });
      }
      // Determine the wiki instance
      let instance = null;
      if($tw.node && $tw.Bob.Wikis.has(eventData.wikiName)) {
          instance = $tw.Bob.Wikis.get(eventData.wikiName);
      }
      // Call the handler
      handler.call(this,eventData,instance||$tw);
    } else {
      console.error('WS handleMessage error: No handler for message of type ', eventData.type);
    }
}

/*
  This is the function for handling ack messages on both the server and
  client.

  It takes an ack message object as input and checks it against the tickets in
  he message queue. If the queue has a ticket with an id that matches the ack
  then the ticket's ack object is checked for any sessions waiting to be acklowledged.

  If there is a truthy value in the session's ack state and it is a function, then
  the callback function associated with the session is called. Finally the "waiting"
  state for the session id is set to false. If all acks for the ticket are set to false 
  than the ctime for that message is set to the current time so it can be properly
  removed later.
*/
WebSocketSession.prototype.handleMessageAck = function(message,instance) {
  let messageId = message.id.slice(3),
    ticket = $tw.Bob.wsManager.getTicket(messageId);
  if(ticket) {
    // If there is a callback, call it
    if(!!ticket.ack[this.id] && typeof ticket.ack[this.id] == "function") {
      ticket.ack[this.id].call();
    }
    // Set the message as acknowledged (waiting == false).
    ticket.ack[this.id] = false;
    // Check if all the expected acks have been received
    const keys = Object.keys(ticket.ack),
      waiting = keys.filter(function(id) {
      return !!ticket.ack[id];
    });
    // If not waiting on any acks then set the ctime.
    if(!waiting.length && !ticket.ctime) {
      ticket.ctime = Date.now();
    }
  } else {
    console.log("WS handleMessageAck error: no message found for id", messageId);
  }
}

exports.WebSocketSession = WebSocketSession;

})();