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

const Yutils = require('./External/yjs/y-utils.cjs');
const WebsocketProvider = require('./y-wsbob.cjs').WebsocketProvider
const observable = require('./External/lib0/dist/observable.cjs');
const time = require('./External/lib0/dist/time.cjs');
const math = require('./External/lib0/dist/math.cjs');

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
      let message;
      try {
        if (typeof event == "string") {
          message = JSON.parse(event);
        } else if (!!event.data && typeof event.data == "string") {
          message = JSON.parse(event.data);
        }        
      } catch (e) {
        $tw.Bob.logger.error("WS handleMessage parse error: ", e, {level:1});
      }
      session.handleMessage(message);
      session.emit('message', [message || event, session]);
    };
    /**
     * @param {any} error
     */
    const onclose = (error,event) => {
      console.log(`['${session.id}'] Closed socket to ${session.url.href}`);
      // Clear the ping timers
      clearTimeout(session.pingTimeout);
      clearTimeout(session.ping);
      // Handle the websocket
      if (session.ws !== null) {
        // Test for reconnect
        session.ws = null;
        session.connecting = false;
        if (session.connected) {
          session.connected = false;
          // Close the Y providers when disconnected
          session.yproviders.forEach((provider,docname) => {
            provider.closeConn();
          });
          session.emit('disconnect', [{ type: 'disconnect', error: error, event: event }, session]);
        } else {
          session.unsuccessfulReconnects++;
        }
        if ($tw.Bob.settings.reconnect.auto && session.unsuccessfulReconnects <= $tw.Bob.settings.reconnect.abort) {
          // Start with a very small reconnect timeout and increase timeout by
          // Math.round(Math.random() * (base = 1200) / 2 * Math.pow((decay = 1.5), unsuccessfulReconnects))
          let delay = math.min(math.round(math.random() * $tw.Bob.settings.reconnect.base / 2 * math.pow($tw.Bob.settings.reconnect.decay, session.unsuccessfulReconnects)), $tw.Bob.settings.reconnect.max);
          setTimeout(setupWS, delay, session);
        } else {
          session.emit('abort', [{ type: 'abort', error: error, event: event }, session]);
        }
      }
    };
    websocket.onclose = event => onclose(null,event);
    websocket.onerror = error => onclose(error);
    websocket.onopen = () => {
      // Reset connection state
      session.lastMessageReceived = time.getUnixTime();
      session.connecting = false;
      session.connected = true;
      session.unsuccessfulReconnects = 0;
      // Open Y provider connections
      session.yproviders.forEach((provider,docname) => {
        provider.openConn();
      });
      session.emit('connect', [{ type: 'connect' }, session]);
    };
  }
};

/**
 * @param {WebSocketSession} session
 */
const setupHeartbeat = (session) => {
    // Delay should be equal to the interval at which your server
    // sends out pings plus a conservative assumption of the latency.  
    session.pingTimeout = setTimeout(function() {
      if(session.connected && session.ws) {
        session.ws.close(4000, `['${session.ws.id}'] Websocket closed by heartbeat, last message received ${session.lastMessageReceived}`);
      }
    }, $tw.Bob.settings.heartbeat.timeout + $tw.Bob.settings.heartbeat.interval);
    // Send the next heartbeat ping after $tw.Bob.settings.heartbeat.interval ms
    session.ping = setTimeout(function() {
      session.send({
        type: 'ping',
        id: 'heartbeat'
      });
    }, $tw.Bob.settings.heartbeat.interval); 
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
  constructor (sessionId, options) {
    if (!sessionId) {
      throw new Error("WebSocketSession Error: no session id provided in constructor.")
    }
    super();
    this.id = sessionId;  // Required uuid_4()
    this.token = null; // Regenerating uuid_4()
    this.tokenEOL = null; // End-of-Life for this.token
    // Setup y-wsbob providers map
    this.yproviders = new Map();
    /**
     * @type {WebSocket?}
     */
    this.ws = null; // The active websocket
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
    this.config(options);
  }

  config (options = {}) {
    this.url = options.url; // The url obj used to connect via url.href
    this.binaryType = options.binaryType || "arraybuffer"; // websocket binaryType
    this.client = !!options.client; // Is this a "client" session?
    this.ip = options.ip; // The ip address for the other end of the socket connection
    this.wikiName = options.wikiName || $tw.wikiName; // The name of the wiki for the session
    this.authenticatedUsername = options.authenticatedUsername; // The internal userid
    this.username = options.username; // The display username
    this.access = options.access, // The user-session's access level
    this.isLoggedIn = options.isLoggedIn; // User's login state
    this.isReadOnly = options.isReadOnly; // User-session + Wiki's read-only state
    this.isAnonymous = options.isAnonymous; // User's anon state
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
   * If a heartbeat is not received within $tw.Bob.settings.heartbeat.timeout from
   * the last heartbeat, terminate the given socket. Setup the next heartbeat.
   * @param {any} message mimimum message includes message.type
   */
   heartbeat (data) {
    // clear the ping timers
    clearTimeout(this.pingTimeout);
    clearTimeout(this.ping);
    setupHeartbeat(this);
  }

  destroy () {
    // clear the ping timers
    clearTimeout(this.pingTimeout);
    clearTimeout(this.ping);
    // clear the Y providers
    this.yproviders.forEach((provider,docname) => {
      provider.destroy();
    });
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

  /**
   * Gets a Y.Doc provider
   *
   * @param {string} docname - the name of the Y.Doc provider to link to this session
   * @return {WebsocketProvider}
   */
  getProvider (docname) {
    return map.setIfUndefined(this.yproviders, docname, () => {
      const doc = $tw.Bob.getYDoc(docname)
      const provider = new WebsocketProvider(session,doc)
      this.yproviders.set(docname,provider)
      return provider
    })
  }
}

// This makes sure that the token sent allows the action on the wiki.
WebSocketSession.prototype.authenticateMessage = function(eventData) {
  const authed = (
    eventData.sessionId == this.id
    && eventData.wikiName == this.wikiName 
    && eventData.userid == this.userid  
    && eventData.token == this.token
    && new Date().getTime() <= this.tokenEOL
  );
  if(authed == false) {
    console.error(`['${this.id}'] WS authentication error: Unauthorized message of type ${eventData.type}`);
    // kill the socket
    this.ws.close(4023, `['${this.id}'] Invalid ws message`);
  }
  return authed;
}

// The handle message function
WebSocketSession.prototype.handleMessage = function(eventData) {
    // Check authentication
    const authenticated = this.authenticateMessage(eventData);
    if (authenticated) {
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