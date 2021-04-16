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
  this.ws = null;  // The active websocket
  this.yhandlers = []; // Session & docname specific Y handlers
}

WebSocketSession.prototype.accessLevels = {
  Reader: "reader",
  Writer: "writer",
  Admin: "admin"
}

WebSocketSession.prototype.initState = function(ws) {
  this.ws = ws;
  if(this.client) {
    this.state = {
      pingTimeout: null,
      ping: null,
      disconnected: null,
      reconnecting: null,
      delay: 100,
      attempts: 0,
      retryTimeout: null
    };
  } else {
    this.state = {
      alive: true,
      clientTitles: []
    };
  }
}

/*
  Client connection methods
*/
WebSocketSession.prototype.openConn = function() {
  let self = this;
  if(!this.client || !this.url) {
    console.error(`['${self.id}'] WSSession connect error: no client url`)
    return false;
  }
  // Create the socket
  try{
    let socket = new $tw.Bob.ws(this.url.href);
    socket.binaryType = "arraybuffer";
    // On Open
    socket.onopen = function(event) {
      console.log(`['${self.id}'] Opened socket to ${self.url.href}`);
      // Reset the state, open any Y provider connections & send a handshake request
      self.initState(this);
      $tw.Bob.wsManager.openYProviders(self);
      const message = {
        type: 'handshake'
      };
      self.sendMessage(message, function(){
        console.log(`['${self.id}'] Handshake ack recieved from ${self.url.href}`)
      });
    };
    // On Close
    socket.onclose = function(event) {
      /*
      The heartbeat process will terminate the socket if it fails. This lets us know when to
      use a reconnect algorithm with exponential back-off and a maximum retry window.
      */
      let text, tiddler;
      console.log(`['${self.id}'] Closed socket to ${self.url.href}`);
      // Close the Y provider connections
      $tw.Bob.wsManager.closeYProviders(self);
      // Clear the ping timers
      clearTimeout(self.state.pingTimeout);
      clearTimeout(self.state.ping);
      // log the disconnection time & handle the message queue
      if (!self.state.disconnected) {
        self.state.disconnected = new Date().getTime();
        self.state.reconnecting = self.state.disconnected;
      }
      if(event.code == 4023 && $tw.syncadaptor.session == self) {
        // Error code 4023 means that the client session is invalid, and should be refreshed
        $tw.syncadaptor.session = null;
        // Get the login status
        $tw.syncer.getStatus(function(err,isLoggedIn) {
          if(err) {
            console.log(`['${self.id}'] Error retrieveing status after invalid session request.`)
          } else {
            // Do a sync from the server
            $tw.syncer.syncFromServer();
          }
        });
      } else if(event.code > 1000) {
        if( $tw.Bob.settings['ws-client'].reconnect.auto &&
        self.state.disconnected - self.state.reconnecting < $tw.Bob.settings['ws-client'].reconnect.abort) {
          // Error code = 1000 means that the connection was closed normally.
          text = `''WARNING: You are no longer connected to the server (${self.url}).` + 
          `Reconnecting (attempt ${self.state.attempts})...''`;
          // Reconnect here
          self.state.retryTimeout = setTimeout(function(){
              // Log the attempt
              self.state.reconnecting = new Date().getTime();
              self.state.attempts++;
              // Calculate the next exponential backoff delay
              let delay = (Math.random()+0.5) * $tw.Bob.settings['ws-client'].reconnect.initial * Math.pow($tw.Bob.settings['ws-client'].reconnect.decay, self.state.attempts);
              // Use the delay or the $tw.Bob.settings.reconnect.max value
              self.state.delay = Math.min(delay, $tw.Bob.settings['ws-client'].reconnect.max);
              // Recreate the socket
              self.openConn();
            }, self.state.delay);
        } else {
          text = `''WARNING: You are no longer connected (${self.url}).` + 
          `''<$button style='color:black;'>Reconnect <$action-reconnectwebsocket/><$action-navigate $to='$:/plugins/Bob/ConflictList'/></$button>`;
        }
      }
      if($tw.syncadaptor.session && $tw.syncadaptor.session == self) {
        text = `<div style='position:fixed;top:0px;width:100%;background-color:red;height:2.5em;text-align:center;vertical-align:center;color:white;'>` + text + `</div>`;
        tiddler = {
          title: `$:/plugins/OokTech/Bob/Server Warning/`,
          text: text,
          component: `$tw.Bob.wsClient`,
          session: self.id,
          tags: '$:/tags/PageTemplate'
        };
      } else {
        text = `<div style='width:100%;height:100%;background-color:red;max-height:2.5em;color:white;'>` + text + `</div>`;
        tiddler = {
          title: `$:/plugins/OokTech/Bob/Session Warning/${self.id}`,
          text: text,
          component: `$tw.Bob.wsClient`,
          session: self.id,
          tags: '$:/tags/Alert'
        };
      }
      // Display the socket warning after the 3rd reconnect attempt or if not auto-reconnecting
      if(!$tw.Bob.settings['ws-client'].reconnect.auto || self.state.attempts > 3) {
        let instance = $tw.Bob.Wikis.get(self.wikiName);
        instance.wiki.addTiddler(new $tw.Tiddler(
          instance.wiki.getCreationFields(),
          tiddler,
          instance.wiki.getModificationFields()
        ));
      }
    };
    // On Message
    socket.onmessage = function(event) {
      let parsed;
      try {
        if (typeof event == "string") {
          parsed = JSON.parse(event);
        } else if (!!event.data && typeof event.data == "string") {
          parsed = JSON.parse(event.data);
        }        
      } catch (e) {
        $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
      }
      let eventData = parsed || event;
      if(eventData.sessionId && eventData.sessionId == self.id) {
        self.handleMessage(eventData);
      } else {
        console.error(`['${self.id}'] WS handleMessage error: Invalid or missing session id`, JSON.stringify(eventData,null,4));
      }
    }
  } catch (e) {
    console.error(`['${self.id}'] WS error creating socket`, e.toString())
    return false;
  }
  return self;
}

WebSocketSession.prototype.closeConn = function() {
  this.ws.close(4023, `['${this.id}'] Websocket closed by session`);
}

/*
  This returns a new id for a message.
  Messages from a client (usually the browser) have ids that start with c, 
  messages from a server have ids that starts with s.
*/
WebSocketSession.prototype.getMessageId = function() {
  return this.client? "c" + $tw.Bob.wsManager.clientId++: "s" + $tw.Bob.wsManager.serverId++;
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
  if(message.id && $tw.Bob.wsManager.hasTicket(message.id)) {
    ticket = $tw.Bob.wsManager.getTicket(message.id);
  } else {
    message.id = this.getMessageId();
    ticket = {
      id: message.id,
      message: JSON.stringify(message),
      qtime: Date.now(),
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
  Tests a session's socket connection
*/
WebSocketSession.prototype.isReady = function() {
  return !!this.ws && this.ws.readyState == 1;
}

// This sends a message if the socket is ready.
WebSocketSession.prototype.send = function(message) {
  if(this.isReady()) {
    message = $tw.utils.extend({
      wikiName: this.wikiName,
      sessionId: this.id,
      token: this.token,
      userid: this.userid
    },message);
    if (["ack", "ping", "pong"].indexOf(message.type) == -1) {
      console.log(`['${message.sessionId}'] send-${message.id}:`, message.type);
    }
    this.ws.send(JSON.stringify(message), err => { err != null && this.closeConn() });
  }
}

// This makes sure that the token sent allows the action on the wiki.
// The message.sessionId == session.id has already been checked.
WebSocketSession.prototype.authenticateMessage = function(eventData) {
  let authed = (
    eventData.wikiName == this.wikiName 
    && eventData.userid == this.userid  
    && eventData.token == this.token
    && new Date().getTime() <= this.tokenEOL
  );
  if(authed == false) {
    console.error(`['${this.id}'] WS authentication error: Unauthorized message of type ${eventData.type}`);
  }
  return authed;
}

// The handle message function
WebSocketSession.prototype.handleMessage = function(eventData) {
    // Check authentication
    const authenticated = this.authenticateMessage(eventData);
    if (!authenticated) {
      // Invalid tokens, kill the socket
      this.ws.close(4023, `['${this.id}'] Websocket closed by session`);
      return null;
    }
    let handler = (this.client)? $tw.Bob.wsManager.clientHandlers[eventData.type]: $tw.Bob.wsManager.serverHandlers[eventData.type];
    if(eventData.type == "y") {
      handler = this.yhandlers[eventData.doc];
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
      let instance = $tw;
      if($tw.node && $tw.Bob.Wikis.has(eventData.wikiName)) {
          instance = $tw.Bob.Wikis.get(eventData.wikiName);
      }
      // Call the handler
      handler.call(this,eventData,instance);
    } else {
      console.error(`['${this.id}'] WS handleMessage error: No handler for message of type ${eventData.type}`);
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
    console.log(`['${message.sessionId}'] WS handleMessageAck error: no message found for id ${messageId}`);
    debugger;
  }
}

exports.WebSocketSession = WebSocketSession;

})();