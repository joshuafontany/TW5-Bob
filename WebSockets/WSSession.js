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
    type: "message-type",
    wikiName: "target-wiki"
  }
*/
WebSocketSession.prototype.queueMessage = function(message,callback) {
  let ticket;
  if(message.id && $tw.Bob.wsManager.hasTicket(message.id)) {
    ticket = $tw.Bob.wsManager.getTicket(message.id);
  } else {
    message.id = this.getMessageId();
    ticket = {
      message: message,
      ctime: null,
      ack: {},
      callback: {}
    };
    $tw.Bob.wsManager.setTicket(ticket)
  }
  ticket.ack[this.id] = false;
  if(!!callback && typeof callback == "function"){
    ticket.callback[this.id] = callback;
  }
  this.sendMesage(message);
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

// This returns sends a message if the socket is ready.
WebSocketSession.prototype.sendMessage = function(message) {
  if($tw.Bob.wsManager.isReady(this.id)) {
    message = $tw.utils.extend({
      wikiName: this.wikiName,
      sessionId: this.id,
      token: this.token,
      userid: this.userid
    },message);
    $tw.Bob.wsManager.getSocket(this.id).send(JSON.stringify(message));
  }
}

// This makes sure that the token sent allows the action on the wiki.
WebSocketSession.prototype.authenticateMessage = function(eventData) {
  return (
    eventData.wikiName == this.wikiName && eventData.userid == this.userid  
    && eventData.token == this.token && new Date() <= this.tokenEOL
  );
}

// The handle message function
WebSocketSession.prototype.handleMessage = function(eventData) {
    // Check authentication
    const authenticated = this.authenticateMessage(eventData),
      handler = (this.client)? $tw.Bob.wsManager.clientHandlers[eventData.type]: $tw.Bob.wsManager.serverHandlers[eventData.type];
    console.log(`Received websocket message ${eventData.id}:`, eventData.type);
    // Make sure we have a handler for the message type
    if(!!authenticated && typeof handler === 'function') {
        // The following messages do not need to be acknowledged
        let noAck = ['ack', 'ping', 'pong'];
        if(noAck.indexOf(eventData.type) == -1) {
          // Acknowledge the message
          this.sendMessageAck(eventData.id);
        }
        // Determine the wiki instance
        if(eventData.wikiname == "RootWiki") {
            eventData.instance = $tw;
        } else if($tw.Bob.Wikis.has(eventData.eventName)) {
            eventData.instance = $tw.Bob.Wikis.get(eventData.wikiName);
        }
        // Call the handler
        handler(eventData);
    } else {
        $tw.Bob.logger.error('WS handleMessage error: Unauthorized, or no handler for message of type ', eventData.type, {level:3});
    }
}

/*
  This acknowledges that a message has been received.
*/
WebSocketSession.prototype.sendMessageAck = function(id) {
  let ack = {
    id: 'ack' + id,
    type: 'ack'
  }
  console.log(`Sending ${message.id}`);
  this.sendMessage(ack);
}

/*
  This is the function for handling ack messages on both the server and
  client.

  It takes an ack object as input and checks it against the message
  queue. If the queue contains a message with the same id as the ack
  then the ack state for the session the ack came from is set
  to true, and any associated callback function is called.

  If all acks for the message in the queue are set to true than the ctime
  for that message is set to the current time so it can be properly
  removed later.
*/
WebSocketSession.prototype.handleMessageAck = function(ack) {
  let messageId = ack.id.slice(3),
    ticket = $tw.Bob.wsManager.getTicket(messageId);
  if(ticket) {
    // Set the message as acknowledged.
    ticket.ack[this.id] = true;
    // Check if all the expected acks have been received
    const complete = Object.values(ticket.ack).indexOf(false) == -1;
    // If acks have been received from all connections than set the ctime.
    if(complete && !ticket.ctime) {
      ticket.ctime = Date.now();
    }
    // If there is a callback, call it
    if(!!ticket.callback[this.id]) {
      ticket.calback[this.id](null, messageId)
    }
  } else {
    console.log("WS handleMessageAck error: no message found for id:", messageId);
  }
}

exports.WebSocketSession = WebSocketSession;

})();