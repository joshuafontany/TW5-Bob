/*\
title: $:/plugins/OokTech/Bob/WSSession.js
type: application/javascript
module-type: library

A Yjs powered websocket session model.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Reference Yjs y-websocket.cjs

Unlike stated in the LICENSE file, it is not necessary to include the copyright notice and permission notice when you copy code from this file.
*/

Object.defineProperty(exports, '__esModule', { value: true });

require('./External/yjs/yjs.cjs');
const time = require('./External/lib0/dist/time.cjs');
const encoding = require('./External/lib0/dist/encoding.cjs');
const decoding = require('./External/lib0/dist/decoding.cjs');
const syncProtocol = require('./External/yjs/y-protocols/sync.cjs');
const authProtocol = require('./External/yjs/y-protocols/auth.cjs');
const awarenessProtocol = require('./External/yjs/y-protocols/awareness.cjs');
const mutex = require('./External/lib0/dist/mutex.cjs');
const observable_js = require('./External/lib0/dist/observable.cjs');
const math = require('./External/lib0/dist/math.cjs');
const random = require('./External/lib0/dist/random.cjs');
const {Base64} = require('./External/js-base64/base64.js');

// Y message handler flags
const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;
const messageQueryAwareness = 3;

/**
 *                       encoder,          decoder,          session,          emitSynced, messageType
 * @type {Array<function(encoding.Encoder, decoding.Decoder, WebsocketSession, boolean,    number):void>}
 */
const messageHandlers = [];

messageHandlers[messageSync] = (encoder, decoder, session, doc, emitSynced, messageType) => {
  encoding.writeVarUint(encoder, messageSync);
  const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, session);
  if (emitSynced && syncMessageType === syncProtocol.messageYjsSyncStep2 && !session.synced) {
    session.synced = true;
  }
};

messageHandlers[messageAwareness] = (encoder, decoder, session, doc, emitSynced, messageType) => {
  awarenessProtocol.applyAwarenessUpdate(session.awareness, decoding.readVarUint8Array(decoder), session);
};

messageHandlers[messageAuth] = (encoder, decoder, session, doc, emitSynced, messageType) => {
  authProtocol.readAuthMessage(decoder, doc, permissionDeniedHandler);
};

messageHandlers[messageQueryAwareness] = (encoder, decoder, session, doc, emitSynced, messageType) => {
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(session.awareness, Array.from(session.awareness.getStates().keys())));
};

/**
 * @param {WebsocketSession} session
 * @param {string} reason
 */
const permissionDeniedHandler = (session, reason) => console.warn(`Permission denied to access ${session.url}.\n${reason}`);

/**
 * @param {WebsocketSession} session
 */
const setupWS = (session) => {
  if (session.shouldConnect && session.ws === null) {
    /**
     * @type {any}
     */
    session.ping = null;
    session.pingTimeout = null;
    /**
     * @type {WebSocket}
     */
    const websocket = new $tw.Bob.ws(session.url.href);
    websocket.binaryType = session.binaryType || 'arraybuffer';
    session.ws = websocket;
    session.connecting = true;
    session.connected = false;
    session.synced = false;

    websocket.onmessage = event => {
      let parsed, eventData;
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
         // If handshake, set the tokenRefresh before acking
         if (session.client && eventData.type == "handshake" && !!eventData.tokenRefresh) {
          session.token = eventData.tokenRefresh;
          session.tokenEOL = eventData.tokenEOL;
        }
        if(eventData.type == "y" ) {
          let eventDoc = eventData.doc == session.wikiName? session.doc : session.getSubDoc(eventData.doc);
          let buf = Base64.toUint8Array(eventData.y);
          const encoder = encoding.createEncoder();
          const decoder = decoding.createDecoder(buf);
          const messageType = decoding.readVarUint(decoder);
          const messageHandler = session.messageHandlers[messageType];
          if (/** @type {any} */ (messageHandler)) {
            messageHandler(encoder, decoder, session, eventDoc, true, messageType);
          } else {
            console.error('Unable to compute message');
          }
          if (encoding.length(encoder) > 1) {
            const buf = encoding.toUint8Array(encoder)
            let message = {
              type: 'y',
              flag: messageType,
              doc: eventData.doc,
              y: Base64.fromUint8Array(buf)
            }
            session.sendMessage(message);
          }
        } else {
          session.emit('message', [eventData, session]);
        }
      }
    };
    websocket.onclose = event => {
      console.log(`['${session.id}'] Closed socket ${websocket.url}`);
      // Clear the ping timers
      clearTimeout(session.pingTimeout);
      clearTimeout(session.ping);
      // Handle the ws
      session.ws = null;
      session.connecting = false;
      if (session.connected) {
        session.connected = false;
        session.synced = false;
        // update awareness (all users except local are null)
        awarenessProtocol.removeAwarenessStates(
          session.awareness,
          Array.from(session.awareness.getStates().keys()).filter(client => client !== session.doc.clientID),
          session);
        session.emit('status', [{ 
          status: 'disconnected', 
          event: event 
        },session]);
      } else {
        session.unsuccessfulReconnects++;
      }
      // Test for reconnect
      if ($tw.Bob.settings.reconnect.auto && session.unsuccessfulReconnects <= $tw.Bob.settings.reconnect.abort) {
        // Start with a very small reconnect timeout and increase timeout by
        // Math.round(Math.random() * (base = 1200) / 2 * Math.pow((decay = 1.5), session.unsuccessfulReconnects))
        let delay = math.min(
          math.round(random.rand() * $tw.Bob.settings.reconnect.base / 2 * math.pow($tw.Bob.settings.reconnect.decay,session.unsuccessfulReconnects)),
          $tw.Bob.settings.reconnect.max
        );
        setTimeout(setupWS,delay,session);
      } else {
        session.emit('status', [{
          status: 'aborted', 
          event: event
        },session]);
      }
    };
    websocket.onerror = error => {
      console.log(`['${session.id}'] socket error:`, error);
      session.emit('status', [{
        status: 'error', 
        error: error
      },session]);
    }
    websocket.onopen = () => {
      console.log(`['${session.id}'] Opened socket ${websocket.url}`);
      // Reset connection state
      session.connecting = false;
      session.connected = true;
      session.unsuccessfulReconnects = 0;
      session.sendMessage(
        { type: 'handshake' }, 
        function() {
          console.log(`['${session.id}'] Handshake ack recieved from ${session.url.href}`);;
        }
      );

      session.emit('status', [{
        status: 'connected'
      },session]);
    };

    session.emit('status', [{
      status: 'connecting'
    },session]);
  }
};

/**
 * @param {WebsocketSession} session
 */
const setupHeartbeat = (session) => {
    // Delay should be equal to the interval at which your server
    // sends out pings plus a conservative assumption of the latency.  
    session.pingTimeout = setTimeout(function() {
      if(session.isReady()) {
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
 *  A Yjs powered websocket session model
 * @extends Observable<string>
 */
 class WebsocketSession extends observable_js.Observable {
  /**
   * @param {UUID_v4} sessionId
   * @param {Y.doc} doc
   * @param {object} [options]
   * @param {string} [options.access] The user-session's access level
   * @param {string} [options.authenticatedUsername] The internal user id
   * @param {boolean} [options.connect]
   * @param {awarenessProtocol.Awareness} [options.awareness]
   * @param {boolean} [options.client] Is this a "client" session?
   * @param {URL} [options.url]
   * @param {'arraybuffer' | 'blob' | null} [opts.binaryType] Set `ws.binaryType`
   * @param {string} [options.ip] The current IP address for the ws connection
   * @param {string} [options.wikiName] The "room" name
   * @param {string} [options.username] The display username
   * @param {boolean} [options.isLoggedIn] The user's login state
   * @param {boolean} [options.isReadOnly] The User-session read-only state
   * @param {boolean} [options.isAnonymous] The User's anon stat
   */
  constructor (sessionId,doc,options) {
    if (!sessionId) {
      throw new Error("WebsocketSession Error: no session id provided in constructor.")
    }
    if (!doc) {
      throw new Error("WebsocketSession Error: no doc provided in constructor.")
    }
    let awareness = options.client? options.awareness || new awarenessProtocol.Awareness(doc): null,
      connect = typeof options.connect !== 'undefined' && typeof options.connect !== 'null' ? options.connect : true;
    super();
    this.id = sessionId;  // Required uuid_4()
    this.awareness = awareness; // Y.doc awareness
    this.doc = null;
    this.ping = null; // heartbeat
    this.pingTimeout = null; // heartbeat timeout
    this.connected = false;
    this.connecting = false;
    this.unsuccessfulReconnects = 0;
    this.messageHandlers = messageHandlers.slice();
    /**
     * @type {boolean}
     */
    this._synced = false;
    /**
     * @type {WebSocket?}
     */
    this.ws = null; // The active websocket
    this.lastMessageReceived = 0;
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = connect;

    // Config
    this.access = options.access;
    this.authenticatedUsername = options.authenticatedUsername;
    this.binaryType = options.binaryType || "arraybuffer";
    this.client = !!options.client;
    this.ip = options.ip;
    this.isAnonymous = options.isAnonymous;
    this.isLoggedIn = options.isLoggedIn;
    this.isReadOnly = options.isReadOnly;
    this.token = options.token || null; // Regenerating uuid_4()
    this.tokenEOL = options.tokenEOL || time.getUnixTime(); // End-of-Life for this.token
    this.url = options.url;
    this.username = options.username;
    this.wikiName = options.wikiName || $tw.wikiName;
    
    if(options.client) {
      this.doc = doc; // Required Y.doc reference
      // Browser features
      if($tw.browser){
        // Awareness
        window.addEventListener('beforeunload',() => {
          awarenessProtocol.removeAwarenessStates(awareness, [this.doc.clientID], 'window unload');
        });
      }

      /**
       * Listens to Yjs updates and sends them to remote peers
       * @param {Uint8Array} update
       * @param {any} origin
       */
      this._updateHandler = (update,origin) => {
        if (origin !== this) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.writeUpdate(encoder, update);
          const buf = encoding.toUint8Array(encoder);
          let message = {
            type: 'y',
            flag: messageSync,
            doc: this.doc.name,
            y: Base64.fromUint8Array(buf)
          }
          this.sendMessage(message);
        }
      };
      this.doc.on('update',this._updateHandler);
      /**
       * @param {any} changed
       * @param {any} origin
       */
      this._awarenessUpdateHandler = ({ added, updated, removed },origin) => {
        const changedClients = added.concat(updated).concat(removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
        const buf = encoding.toUint8Array(encoder);
        let message = {
          type: 'y',
          flag: messageAwareness,
          doc: this.doc.name,
          y: Base64.fromUint8Array(buf)
        }
        this.sendMessage(message);
        
      };
      awareness.on('update', this._awarenessUpdateHandler);

      // Client handshakes treat the session as the doc/awareness provider
      this.on('handshake', function(status,session) {
        // send sync step 1
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeSyncStep1(encoder, session.doc)
        const mbuf = encoding.toUint8Array(encoder)
        let message = {
          type: 'y',
          flag: messageSync,
          doc: session.doc.name,
          y: Base64.fromUint8Array(mbuf)
        }
        session.sendMessage(message);
        // broadcast local awareness state
        if (session.awareness.getLocalState() !== null) {
          const encoderAwarenessState = encoding.createEncoder();
          encoding.writeVarUint(encoderAwarenessState, messageAwareness);
          encoding.writeVarUint8Array(encoderAwarenessState, awarenessProtocol.encodeAwarenessUpdate(session.awareness, [session.doc.clientID]));
          const abuf = encoding.toUint8Array(encoderAwarenessState)
          let message = {
            type: 'y',
            flag: messageAwareness,
            doc: session.doc.name,
            y: Base64.fromUint8Array(abuf)
          }
          session.sendMessage(message);
        }
      })
    } else {
      // Server handshakes treat the doc as the provider
      this.on('handshake', function(status,session) {
        let doc = $tw.Bob.getYDoc(session.wikiName)
        // send sync step 1
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeSyncStep1(encoder, doc)
        const mbuf = encoding.toUint8Array(encoder)
        let message = {
          type: 'y',
          flag: messageSync,
          doc: doc.name,
          y: Base64.fromUint8Array(mbuf)
        }
        session.sendMessage(message);
        const awarenessStates = doc.awareness.getStates()
        if (awarenessStates.size > 0) {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageAwareness)
          encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())))
          const abuf = encoding.toUint8Array(encoder)
          let message = {
            type: 'y',
            flag: messageAwareness,
            doc: doc.name,
            y: Base64.fromUint8Array(abuf)
          }
          session.sendMessage(message);
        }
      })
    }

    if (options.client && connect) {
      this.connect();
    }
  }

  toJSON() {
    return {
      access: this.access,
      authenticatedUsername: this.authenticatedUsername,
      binaryType: this.binaryType,
      client: this.client,
      id: this.id,
      ip: this.ip,
      isAnonymous: this.isAnonymous,
      isLoggedIn: this.isLoggedIn,
      isReadOnly: this.isReadOnly,
      token: this.token,
      tokenEOL: this.tokenEOL,
      url: this.url.href || this.url.toString(),
      username: this.username,
      wikiName: this.wikiName
    };
  }

  /**
   * @type {boolean}
   */
  get synced () {
    return this._synced
  }
  
  set synced (state) {
    if (this._synced !== state) {
      this._synced = state;
      this.emit('synced', [state,this]);
      this.emit('sync', [state,this]);
    }
  }

  destroy () {
    // clear the ping timers
    clearTimeout(this.pingTimeout);
    clearTimeout(this.ping);
    this.disconnect();
    super.destroy();
  }

  disconnect (err) {
    if(this.client){
      this.shouldConnect = false;
      if (this.isReady()) {
        this.ws.close(1000, `['${this.id}'] Websocket closed by the client`, err);
      }
    } else {
      $tw.Bob.closeWSConnection(this,this.doc,err);
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

  isReady () {
    return this.connected && !!this.ws && this.ws.readyState == 1;
  }

  /**
   * @param {any} message mimimum message includes message.type
   */
  send (message) {
    if(this.isReady()) {
      try {
        message = $tw.utils.extend({
          wikiName: this.wikiName,
          sessionId: this.id,
          token: this.token,
          authenticatedUsername: this.authenticatedUsername
        },message);
        if (["ack", "ping", "pong"].indexOf(message.type) == -1) {
          let note;
          if (message.type == "y") {
            note =`${message.type}-${message.flag} ${message.doc}`;
          } else {
            note = message.type;            
          }
          console.log(`['${message.sessionId}'] send-${message.id}:`, note);
        }
        this.ws.send(JSON.stringify(message), err => { err != null && this.disconnect(err) });
      } catch (err) {
        this.disconnect(err);
      }
    }
  }

  /**
   * @param {any} message mimimum message includes message.type
   * @param {function} callback Optional callback
   */
  sendMessage (message,callback) {
    let ticket;
    if(message.id && $tw.Bob.hasTicket(message.id)) {
      ticket = $tw.Bob.getTicket(message.id);
    } else {
      message.id = $tw.Bob.getMessageId(this.client);
      ticket = {
        id: message.id,
        message: JSON.stringify(message),
        qtime: time.getUnixTime(),
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
    $tw.Bob.setTicket(ticket);
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

  /**
   * Authenticates a message
   *
   * @param {obj} eventData - the current event data
   * @return {bool}
   */
  authenticateMessage (eventData) {
    let authed = (
      eventData.sessionId == this.id
      && eventData.wikiName == this.wikiName 
      && eventData.authenticatedUsername == this.authenticatedUsername  
      && eventData.token == this.token
    );
    if(!authed) {
      console.error(`['${this.id}'] WS authentication error: Unauthorized message of type ${eventData.type}`);
      // kill the socket
      this.ws.close(4023, `Unauthorized message`);
    }
    let eol = time.getUnixTime() > this.tokenEOL;
    if(eol) {
      console.error(`['${this.id}'] WS authentication error: Token expired`);
      // kill the socket
      this.ws.close(4023, `Expired token`);
    }
    return authed && !eol;
  }
}

exports.WebsocketSession = WebsocketSession;

})();