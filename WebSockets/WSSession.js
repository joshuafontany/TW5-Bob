/*\
title: $:/plugins/OokTech/Bob/WSSession.js
type: application/javascript
module-type: library

A simple websocket session model.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var observable = require('./External/lib0/dist/observable.cjs');
var time = require('./External/lib0/dist/time.cjs');
var math = require('./External/lib0/dist/math.cjs');

const reconnectTimeoutBase = 1200;
const maxReconnectTimeout = 2500;
// @todo - this should depend on awareness.outdatedTime
const messageReconnectTimeout = 30000;

/**
 * @param {WebSocketSession} session
 */
const setupWS = (session) => {
  if (session.shouldConnect && session.ws === null) {
        /**
     * @type {any}
     */
    session.ping = null;
    session.pingTimeout = null;
    const websocket = new $tw.Bob.ws(session.url.href);
    const binaryType = session.binaryType;
    if (binaryType) {
      websocket.binaryType = binaryType;
    }
    session.ws = websocket;
    session.connecting = true;
    session.connected = false;
    websocket.onmessage = event => {
      session.lastMessageReceived = time.getUnixTime();
      const message;
      try {
        if (typeof event == "string") {
          message = JSON.parse(event);
        } else if (!!event.data && typeof event.data == "string") {
          message = JSON.parse(event.data);
        }        
      } catch (e) {
        $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
      }
      session.emit('message', [message, session]);
      if(message.sessionId && message.sessionId == session.id) {
        session.handleMessage(message);
      } else {
        console.error(`['${session.id}'] WS handleMessage error: Invalid or missing session id`, JSON.stringify(message,null,4));
      }      
    };
    /**
     * @param {any} error
     */
    const onclose = (error,event) => {
      console.log(`['${session.id}'] Closed socket to ${session.url.href}`);
      // Close the Y provider connections
      $tw.Bob.wsManager.closeYProviders(session);
      // Clear the ping timers
      clearTimeout(session.pingTimeout);
      clearTimeout(session.ping);

      if(event && event.code == 4023) {
        // Error code 4023 means that the client session is invalid, and should be discarded
        window.sessionStorage.removeItem("ws-adaptor-session")
        this.sessionId = null;
        // Get the login status
        $tw.syncer.getStatus(function(err,isLoggedIn) {
          if(err) {
            console.log(`['${self.id}'] Error retrieveing status after invalid session request.`)
          } else {
            // Do a sync from the server
            $tw.syncer.syncFromServer();
          }
        });
      } else if(event && event.code > 1000) {
        if( $tw.Bob.settings['ws-client'].reconnect.auto &&
        self.state.reconnecting - self.state.disconnected < $tw.Bob.settings['ws-client'].reconnect.abort) {
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

      if (session.ws !== null) {
        session.ws = null;
        session.connecting = false;
        if (session.connected) {
          session.connected = false;
          session.emit('disconnect', [{ type: 'disconnect', error: error, event: event }, session]);
        } else {
          session.unsuccessfulReconnects++;
        }
        // Start with no reconnect timeout and increase timeout by
        // log10(wsUnsuccessfulReconnects).
        // The idea is to increase reconnect timeout slowly and have no reconnect
        // timeout at the beginning (log(1) = 0)
        let delay = math.min(math.log10(session.unsuccessfulReconnects + 1) * $tw.Bob.settings['ws-client'].reconnect.base * (1+Math.random()*0.5), $tw.Bob.settings['ws-client'].reconnect.max);
        setTimeout(setupWS, delay, session);
      }

    };
    websocket.onclose = event => onclose(null,event);
    websocket.onerror = error => onclose(error);
    websocket.onopen = () => {
      session.lastMessageReceived = time.getUnixTime();
      session.connecting = false;
      session.connected = true;
      session.unsuccessfulReconnects = 0;
      session.emit('connect', [{ type: 'connect' }, session]);
    };
  }
};

const setupHeartbeat = (session) => {
    // clear the ping timers
    clearTimeout(session.pingTimeout);
    clearTimeout(session.ping);
    // Delay should be equal to the interval at which your server
    // sends out pings plus a conservative assumption of the latency.  
    session.pingTimeout = setTimeout(function() {
      if(session.ws) {
        session.ws.close(4000, `['${session.ws.id}'] Websocket closed by session.pingTimeout`);
      }
    }, $tw.Bob.settings['ws-client'].heartbeat.timeout + $tw.Bob.settings['ws-client'].heartbeat.interval);
    // Send the next heartbeat ping after $tw.Bob.settings['ws-client'].heartbeat.interval ms
    session.ping = setTimeout(function() {
      session.send({
        type: 'ping',
        id: 'heartbeat'
      });
    }, $tw.Bob.settings['ws-client'].heartbeat.interval); 
}

/**
 *  A simple websocket session model
 * @extends Observable<string>
 */
 class WebSocketSession extends observable.Observable {
  /**
   * @param {UUID_v4} sessionId
   * @param {URL} url
   * @param {object} [opts]
   * @param {'arraybuffer' | 'blob' | null} [opts.binaryType] Set `ws.binaryType`
   */
  constructor (sessionId, url, { binaryType } = {}) {
    if (!sessionId) {
      throw new Error("WebSocketSession Error: no session id provided in constructor.")
    }
    super();
    this.id = sessionId;  // Required uuid_4()
    this.url = url; // The url obj used to connect via url.href
    /**
     * @type {WebSocket?}
     */
    this.ws = null; // The active websocket
    this.binaryType = binaryType || null;
    this.connected = false;
    this.connecting = false;
    this.unsuccessfulReconnects = 0;
    this.lastMessageReceived = 0;
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = true;
    this.ping = null;
    this.pingTimeout = null;
    this._checkInterval = setInterval(() => {
      if (this.connected && messageReconnectTimeout < time.getUnixTime() - this.lastMessageReceived) {
        // no message received in a long time - not even your own heartbeat
        // (which are sent every 5 seconds by default)
        /** @type {WebSocket} */ (this.ws).close();
      }
    }, messageReconnectTimeout / 2);
    setupWS(this);
  }

  isReady () {
    return !!this.ws && this.ws.readyState == 1;
  }

  /**
   * @param {any} message mimimum message includes message.type
   */
  send (message) {
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
      this.ws.send(JSON.stringify(message), err => { err != null && this.disconnect(err) });
    }
  }

  /**
   * @param {any} message mimimum message includes message.type
   * @param {function} callback Optional callback
   */
  sendMessage (message,callback) {
    let ticket;
    if(message.id && $tw.Bob.wsManager.hasTicket(message.id)) {
      ticket = $tw.Bob.wsManager.getTicket(message.id);
    } else {
      message.id = $tw.Bob.wsManager.getMessageId(this.client);
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

  /**
   * If a heartbeat is not received within $tw.Bob.settings['ws-client'].heartbeat.timeout from
   * the last heartbeat, terminate the given socket. Setup the next heartbeat.
   * @param {any} message mimimum message includes message.type
   */
   heartbeat (data) {
    console.log("heartbeat");
    setupHeartbeat(this);
  }

  destroy () {
    // clear the ping timers
    clearTimeout(this.pingTimeout);
    clearTimeout(this.ping);
    clearInterval(this._checkInterval);
    this.disconnect();
    super.destroy();
  }

  disconnect (err) {
    this.shouldConnect = false;
    if (this.ws !== null) {
      this.ws.close(4023, `['${this.id}'] Websocket closed by session`, err);
    }
  }

  connect () {
    if(!this.client || !this.url) {
      console.error(`['${this.id}'] WSSession connect error: no client url`)
      return;
    }
    this.shouldConnect = true;
    if (!this.connected && this.ws === null) {
      setupWS(this);
    }
  }
}

WebSocketSession.prototype.config = function(options) {
  this.wikiName = options.wikiName || $tw.wikiName; // The name of the wiki for the session
  this.client = !!options.client; // Is this a "client" session?
  this.token = options.token; // Regenerating uuid_4()
  this.tokenEOL = options.tokenEOL; // End-of-Life for this.token
  this.ip = options.ip; // The ip address for the other end of the socket connection
  this.referer = options.referer; // Set by the initial upgrade (auto-set in browsers)
  this.userid = options.userid; // The internal userid
  this.username = options.username; // The display username
  this.access = options.access, // The user-session's access level
  this.isLoggedIn = options.isLoggedIn; // User's login state
  this.isReadOnly = options.isReadOnly; // User-session + Wiki's read-only state
  this.isAnonymous = options.isAnonymous; // User's anon state
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
      alive: true
    };
  }
}

/*
  Client connection methods
*/
WebSocketSession.prototype.openConn = function() {
  let self = this;
  // Create the socket
  try{
    let socket = new $tw.Bob.ws(this.url.href);
    socket.binaryType = "arraybuffer";
    // On Open
    socket.onopen = function(event) {
      console.log(`['${self.id}'] Opened socket to ${self.url.href}`);
      // Reset the state, open any Y provider connections & send a handshake request
      self.initState(this);
      const message = {
        type: 'handshake'
      };
      self.sendMessage(message, function(){
        console.log(`['${self.id}'] Handshake ack recieved from ${self.url.href}`);
        $tw.Bob.wsManager.openYProviders(self);
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
      if(event.code == 4023 && $tw.Bob.sessionId == self.id) {
        // Error code 4023 means that the client session is invalid, and should be refreshed
        window.sessionStorage.removeItem("ws-adaptor-session")
        $tw.Bob.sessionId = null;
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
        self.state.reconnecting - self.state.disconnected < $tw.Bob.settings['ws-client'].reconnect.abort) {
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
      if($tw.Bob.sessionId && $tw.Bob.sessionId == self.id) {
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
    let handler;
    if(eventData.type == "y" ) {
      handler = this.client? $tw.Bob.wsManager.yproviders.get(this.id).get(eventData.doc).handler: $tw.Bob.Ydocs.get(eventData.doc).handlers.get(this.id);
    } else {
      handler = this.client? $tw.Bob.wsManager.clientHandlers[eventData.type]: $tw.Bob.wsManager.serverHandlers[eventData.type];
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
      debugger;
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
    ticket = $tw.Bob.wsManager.getTicket(messageId);debugger;
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