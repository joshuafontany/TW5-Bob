/*\
title: $:/plugins/OokTech/Bob/Bob.js
type: application/javascript
module-type: library

A core prototype to hand everything else onto.

\*/
(function () {

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";

  const WebsocketSession = require('./WSSession.js').WebsocketSession;
  const Y = require('./External/yjs/yjs.cjs');
  const syncProtocol = require('./External/yjs/y-protocols/sync.cjs');
  const authProtocol = require('./External/yjs/y-protocols/auth.cjs');
  const awarenessProtocol = require('./External/yjs/y-protocols/awareness.cjs');
  const time = require('./External/lib0/dist/time.cjs');
  const encoding = require('./External/lib0/dist/encoding.cjs');
  const decoding = require('./External/lib0/dist/decoding.cjs');
  const mutex = require('./External/lib0/dist/mutex.cjs');
  const map = require('./External/lib0/dist/map.cjs');
  const observable_js = require('./External/lib0/dist/observable.cjs');
  const {Base64} = require('./External/js-base64/base64.js');
  const { v4: uuid_v4, NIL: uuid_NIL, validate: uuid_validate } = require('./External/uuid/index.js');

  // Polyfill because IE uses old javascript
  if(!String.prototype.startsWith) {
    String.prototype.startsWith = function(search, pos) {
      return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
    };
  }

  /*
    "Bob 2.0" is a Yjs and websocket module for both server and client/browser. 
  */
  class Bob extends observable_js.Observable {
    constructor () {
      super();
      // Access levels
      this.accessLevels = {
        Reader: "reader",
        Writer: "writer",
        Admin: "admin"
      }
      // Settings
      this.settings = {    // Setup the heartbeat settings placeholders (filled in by the 'handshake')
        "heartbeat": {
          "interval":1000, // default 1 sec heartbeats
          "timeout":5000 // default 5 second heartbeat timeout
        },
        "reconnect": {
          "auto": true,
          "initial": 1200, // small initial increment
          "decay": 1.5, // exponential decay d^n (number-of-retries)
          "max": 1000000, // maximum retry increment
          "abort": 20 // failure after this many tries
        }
      };
      this.version = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob').fields.version;
      this.ExcludeFilter = $tw.wiki.getTiddlerText('$:/plugins/OokTech/Bob/ExcludeSync');

      // Logger
      this.logger = {};

      // Wikis
      this.Wikis = new Map();

      // Ydocs
      this.Yversion = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob/External/yjs/yjs.cjs').fields.version;
      this.Ydocs = new Map();
      // disable gc when using snapshots!
      this.gcEnabled = $tw.node? (process.env.GC !== 'false' && process.env.GC !== '0'): true;
      /**
       * @type {{bindState: function(string,WSSharedDoc):void, writeState:function(string,WSSharedDoc):Promise<any>, provider: any}|null}
       */
      this.persistence = null;

      // Sessions
      this.sessions = new Map();

      // Setup a Message Queue
      this.clientId = 0; // The current client message id
      this.serverId = 0; // The current server message id
      this.tickets = new Map(); // The message ticket queue

      // Load the client-messagehandlers
      this.clientHandlers = {};
      $tw.modules.applyMethods("client-messagehandlers", this.clientHandlers);
      // Reserve the server-messagehandlers
      this.serverHandlers = null;

      // Setup Websocket library
      if($tw.node){
        this.ws = require('./External/ws/ws.js');
        this.url = require('url').URL;
      } else if($tw.browser) {
        this.ws = WebSocket;
        this.url = URL;
      }
    }

    /*
      Websocket Session methods
    */

    getHost (host) {
      host = new this.url(host || (!!document.location && document.location.href));
      // Websocket host
      let protocol = null;
      if(host.protocol == "http:") {
        protocol = "ws:";
      } else if(host.protocol == "https:") {
        protocol = "wss:";
      }
      host.protocol = protocol
      return host.toString();
    }

    // Create or get a new session
    getSession (sessionId,doc,options = {}) {
      if($tw.node && !options.client && (sessionId == uuid_NIL || !this.hasSession(sessionId))) {
          sessionId = uuid_v4()
      }
      return map.setIfUndefined(this.sessions, sessionId, () => {
        let session = new WebsocketSession(sessionId,doc,options);
        session.on('message', this.handleMessage);
        this.sessions.set(sessionId, session);
        return session;
      })
    }

    hasSession (sessionId) {
      return this.sessions.has(sessionId);
    }

    deleteSession (sessionId) {
      if (this.hasSession(sessionId)) {
        this.sessions.delete(sessionId);
      }
    }

    getSessionsByUser (authenticatedUsername) {
      var usersSessions = new Map();
      for (let [id,session] of this.sessions.entries()) {
        if (session.authenticatedUsername === authenticatedUsername) {
          usersSessions.add(id,session);
        }
      }
      return usersSessions;
    }

    getSessionsByWiki (wikiName) {
      var wikiSessions = new Map();
      for (let [id, session] of this.sessions.entries()) {
        if (session.wikiName === wikiName) {
          wikiSessions.add(id, session);
        }
      }
      return wikiSessions;
    }

    /*
      Message methods
    */

    /*
      This returns a new id for a message.
      Messages from a client (usually the browser) have ids that start with c, 
      messages from a server have ids that starts with s.
    */
    getMessageId (client) {
      return !!client ? "c" + this.clientId++: "s" + this.serverId++;
    }

    handleMessage (eventData,session) {
      let handler = session.client? $tw.Bob.clientHandlers[eventData.type]: $tw.Bob.serverHandlers[eventData.type];
      // Make sure we have a handler for the message type
      if(typeof handler === 'function') {
        // The following messages do not need to be acknowledged
        let noAck = ['ack', 'ping', 'pong'];
        if(eventData.id && noAck.indexOf(eventData.type) == -1) {
          console.log(`['${eventData.sessionId}'] handle-${eventData.id}:`, eventData.type);
          // Acknowledge the message
          session.send({
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
        handler.call(session,eventData,instance);
      } else {
        debugger;
        console.error(`['${session.id}'] WS handleMessage error: No handler for message of type ${eventData.type}`);
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
    handleMessageAck (message,instance) {
      let messageId = message.id.slice(3),
        ticket = $tw.Bob.getTicket(messageId);
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

    /*
      Ticket methods
    */
    hasTicket (messageId) {
      return this.tickets.has(messageId);
    }

    getTicket (messageId) {
      if (this.hasTicket(messageId)) {
        return this.tickets.get(messageId);
      } else {
        return null;
      }
    }

    setTicket (ticketData) {
      if (ticketData.id) {
        this.tickets.set(ticketData.id, ticketData);
      }
    }

    deleteTicket (messageId) {
      if (this.hasTicket(messageId)) {
        this.tickets.delete(messageId);
      }
    }

    getViewableSettings (sessionId) {
      const tempSettings = {};
      if (this.hasSession(sessionId)) {
        let session = this.getSession(sessionId);
        // section visible to anyone
        tempSettings.API = $tw.Bob.settings.API;
        tempSettings.heartbeat = $tw.Bob.settings.heartbeat;
        tempSettings.reconnect = $tw.Bob.settings.reconnect;
        // Federation stuff is visible because you don't have to login to want to see
        // if federation is possible with a server
        tempSettings.enableFederation = $tw.Bob.settings.enableFederation;
        if (tempSettings.enableFederation == "yes") {
          tempSettings.federation = $tw.Bob.settings.federation;
        }
        // Section visible by logged in people
        if (session.isLoggedIn) {
          tempSettings.backups = $tw.Bob.settings.backups;
          tempSettings.disableBrowserAlerts = $tw.Bob.settings.disableBrowserAlerts;
          tempSettings.editionLibrary = $tw.Bob.settings.editionLibrary;
          tempSettings.enableFileServer = $tw.Bob.settings.enableFileServer;
          tempSettings.excludePluginList = $tw.Bob.settings.excludePluginList;
          tempSettings.fileURLPrefix = $tw.Bob.settings.fileURLPrefix;
          tempSettings.includePluginList = $tw.Bob.settings.includePluginList;
          tempSettings.mimeMap = $tw.Bob.settings.mimeMap;
          tempSettings.namespacedWikis = $tw.Bob.settings.namespacedWikis;
          tempSettings.perWikiFiles = $tw.Bob.settings.perWikiFiles;
          tempSettings.pluginLibrary = $tw.Bob.settings.pluginLibrary;
          tempSettings.profileOptions = $tw.Bob.settings.profileOptions;
          tempSettings.saveMediaOnServer = $tw.Bob.settings.saveMediaOnServer;
          tempSettings.themeLibrary = $tw.Bob.settings.themeLibrary;
          tempSettings.tokenTTL = $tw.Bob.settings.tokenTTL;
        }
        // advanced section only visible to admins
        if (session.isLoggedIn && session.access === 'admin') {
          tempSettings.actions = $tw.Bob.settings.actions;
          tempSettings.admin = $tw.Bob.settings.admin;
          tempSettings.advanced = $tw.Bob.settings.advanced;
          tempSettings.certPath = $tw.Bob.settings.certPath;
          tempSettings.disableFileWatchers = $tw.Bob.settings.disableFileWatchers;
          tempSettings.editions = $tw.Bob.settings.editions;
          tempSettings.editionsPath = $tw.Bob.settings.editionsPath;
          tempSettings.enableBobSaver = $tw.Bob.settings.enableBobSaver;
          tempSettings.filePathRoot = $tw.Bob.settings.filePathRoot;
          tempSettings['fed-wss'] = $tw.Bob.settings['fed-wss'];
          tempSettings.httpsPort = $tw.Bob.settings.httpsPort;
          tempSettings.languages = $tw.Bob.settings.languages;
          tempSettings.languagesPath = $tw.Bob.settings.languagesPath;
          tempSettings.logger = $tw.Bob.settings.logger;
          tempSettings.plugins = $tw.Bob.settings.plugins;
          tempSettings.pluginsPath = $tw.Bob.settings.pluginsPath;
          tempSettings.profiles = $tw.Bob.settings.profiles;
          tempSettings.reverseProxy = $tw.Bob.settings.reverseProxy;
          tempSettings.rootWikiName = $tw.Bob.settings.rootWikiName;
          tempSettings.saltRounds = $tw.Bob.settings.saltRounds;
          tempSettings.saver = $tw.Bob.settings.saver;
          tempSettings.scripts = $tw.Bob.settings.scripts;
          tempSettings.servingFiles = $tw.Bob.settings.servingFiles;
          tempSettings.server = $tw.Bob.settings.server;
          tempSettings.serverInfo = $tw.Bob.settings.serverInfo;
          tempSettings.serverKeyPath = $tw.Bob.settings.serverKeyPath;
          tempSettings.serveWikiOnRoot = $tw.Bob.settings.serveWikiOnRoot;
          tempSettings.suppressBrowser = $tw.Bob.settings.suppressBrowser;
          tempSettings.themes = $tw.Bob.settings.themes;
          tempSettings.themesPath = $tw.Bob.settings.themesPath;
          tempSettings.tokenPrivateKeyPath = $tw.Bob.settings.tokenPrivateKeyPath;
          tempSettings.useHTTPS = $tw.Bob.settings.useHTTPS;
          tempSettings.wikiPathBase = $tw.Bob.settings.wikiPathBase;
          tempSettings.wikiPermissionsPath = $tw.Bob.settings.wikiPermissionsPath;
          tempSettings.wikisPath = $tw.Bob.settings.wikisPath;
          tempSettings['ws-server'] = $tw.Bob.settings['ws-server'];
        }
        tempSettings.advanced = tempSettings.avanced || {};
        tempSettings['ws-server'] = tempSettings['ws-server'] || {};
        tempSettings['fed-wss'] = tempSettings['fed-wss'] || {};
      }
      return tempSettings;
    }

    /*
      Sync methods
    */

    syncToServer (sessionId) {
      /*
      // The process here should be:
    
        Send the full list of changes from the browser to the server in a
        special message
        The server determines if any conflicts exist and marks the tiddlers as appropriate
        If there are no conflicts than it just applies the changes from the browser/server
        If there are than it marks the tiddler as needing resolution and both versions are made available
        All connected browsers now see the tiddlers marked as in conflict and resolution is up to the people
    
        This message is sent to the server, once the server receives it it respons with a special ack for it, when the browser receives that it deletes the unsent tiddler
    
        What is a conflict?
    
        If both sides say to delete the same tiddler there is no conflict
        If one side says save and the other delete there is a conflict
        if both sides say save there is a conflict if the two saved versions
        aren't the same.
      */
      // Get the tiddler with the info about local changes
      const tiddler = this.wiki.getTiddler(`$:/plugins/OokTech/Bob/Sockets/${connectionIndex}/Unsent`);
      let tiddlerHashes = {};
      const allTitles = this.wiki.allTitles()
      const list = this.wiki.filterTiddlers($tw.Bob.ExcludeFilter);
      allTitles.forEach(function(tidTitle) {
        if(list.indexOf(tidTitle) === -1) {
          const tid = this.wiki.getTiddler(tidTitle);
          tiddlerHashes[tidTitle] = $tw.utils.getTiddlerHash(tid);
        }
      })
      // Ask the server for a listing of changes since the browser was disconnected
      const message = {
        type: 'syncChanges',
        since: tiddler.fields.start,
        changes: tiddler.fields.text,
        hashes: tiddlerHashes,
        wiki: $tw.wikiName
      };
      $tw.Bob.sendToServer(connectionIndex, message);
      //this.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Sockets/${connectionIndex}/Unsent`);
    }

    /*
      Wiki methods
    */

    loadWiki (wikiName,cb) {
      if(wikiName && !this.Wikis.has(wikiName)) {
        try{
          // Get the name for this wiki for websocket messages
          $tw.wikiName = wikiName;
          // Setup the Ydocs for the wiki
          let wikiDoc = this.getYDoc($tw.wikiName);

          // Attach the providers 

          // Awareness
              
          // Initialize the wiki subdocs


          // Set this wiki as loaded
          this.Wikis.set($tw.wikiName,$tw);
          $tw.hooks.invokeHook('wiki-loaded',wikiName);
        } catch (err) {
          if (typeof cb === 'function') {
            cb(err);
          } else {
            console.error(err);
            return err;
          }
        }
      }
      if (typeof cb === 'function') {
        cb(null, true);
      } else {
        return true;
      }
    };

    /*
      Yjs methods
    */

    /**
     * Gets a Y.Doc by name, whether in memory or on disk
     *
     * @param {string} docname - the name of the Y.Doc to find or create
     * @param {boolean} gc - whether to allow gc on the doc (applies only when created)
     * @return {Y.Doc}
     */
    getYDoc (docname, gc = this.gcEnabled) {
      return map.setIfUndefined(this.Ydocs, docname, () => {
        const doc = new Y.Doc(docname);
        doc.gc = gc;
        doc.name = docname;
        if (this.persistence !== null) {
          this.persistence.bindState(docname, doc);
        }
        this.Ydocs.set(docname, doc);
        return doc;
      })
    }

  }

  exports.Bob = Bob;

/*
 * Node classes
 */ 
if($tw.node) {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  // A polyfilL to make this work with older node installs

  // START POLYFILL
  const reduce = Function.bind.call(Function.call, Array.prototype.reduce);
  const isEnumerable = Function.bind.call(Function.call, Object.prototype.propertyIsEnumerable);
  const concat = Function.bind.call(Function.call, Array.prototype.concat);
  const keys = Reflect.ownKeys;

  if (!Object.values) {
    Object.values = function values(O) {
      return reduce(keys(O), (v, k) => concat(v, typeof k === 'string' && isEnumerable(O, k) ? [O[k]] : []), []);
    };
  }
  // END POLYFILL

  // Y message handler flags
  const messageSync = 0;
  const messageAwareness = 1;
  const messageAuth = 2;
  const messageQueryAwareness = 3;
  const messageSyncSubdoc = 4;

  /**
 * @param {Uint8Array} update
 * @param {WSSession} origin
 * @param {WSSharedDoc} doc
 */
  const updateHandler = (update, origin, doc) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, update)
    const mbuf = encoding.toUint8Array(encoder)
    doc.sessions.forEach((_, s) => {
      let message = {
        type: 'y',
        flag: messageSync,
        doc: s.doc.name,
        y: Base64.fromUint8Array(mbuf)
      }
      s.sendMessage(message);
    })
  }

  class WSSharedDoc extends Y.Doc {
    /**
     * @param {string} name
     */
    constructor (name) {
      super({ gc: $tw.Bob.gcEnabled })
      this.name = name
      this.mux = mutex.createMutex()
      /**
       * Maps from session to set of controlled user ids & session/doc specific handlers. Delete all user ids from awareness, and clear handlers when this session is closed
       * @type {Map<Object, Set<number>>}
       */
      this.sessions = new Map()
      this.handlers = new Map()
      /**
       * @type {awarenessProtocol.Awareness}
       */
      this.awareness = new awarenessProtocol.Awareness(this)
      this.awareness.setLocalState(null)
      /**
       * @param {{ added: Array<number>, updated: Array<number>, removed: Array<number> }} changes
       * @param {Object | null} origin Origin is the connection that made the change
       */
      const awarenessChangeHandler = ({ added, updated, removed }, origin) => {
        const changedClients = added.concat(updated, removed)
        if (origin !== null) {
          const connControlledIDs = /** @type {Set<number>} */ (this.sessions.get(origin))
          if (connControlledIDs !== undefined) {
            added.forEach(clientID => { connControlledIDs.add(clientID) })
            removed.forEach(clientID => { connControlledIDs.delete(clientID) })
          }
        }
        // broadcast awareness update
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageAwareness)
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients))
        const abuf = encoding.toUint8Array(encoder)
        this.sessions.forEach((_, s) => {
          let message = {
            type: 'y',
            flag: messageAwareness,
            doc: s.doc.name,
            y: Base64.fromUint8Array(abuf)
          }
          s.sendMessage(message);
        })
      }
      this.awareness.on('update', awarenessChangeHandler)
      this.on('update', updateHandler)
    }
  }

  class BobServer extends Bob {
    constructor () {
      super();
      // Initialise the scriptQueue objects ???
      this.scriptQueue = {};
      this.scriptActive = {};
      this.childproc = false;

      // Initialise the $tw.Bob.settings object & load the user settings
      this.settings = JSON.parse($tw.wiki.getTiddler('$:/plugins/OokTech/Bob/DefaultSettings').fields.text || "{}");
      this.loadSettings(this.settings,$tw.boot.wikiPath);

      // Ydocs
      if (typeof persistenceDir === 'string') {
        console.info('Persisting Y documents to "' + persistenceDir + '"')
        // @ts-ignore
        const LeveldbPersistence = require('y-leveldb').LeveldbPersistence
        const ldb = new LeveldbPersistence(persistenceDir)
        this.persistence = {
          provider: ldb,
          bindState: async (docName, ydoc) => {
            const persistedYdoc = await ldb.getYDoc(docName)
            const newUpdates = Y.encodeStateAsUpdate(ydoc)
            ldb.storeUpdate(docName, newUpdates)
            Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc))
            ydoc.on('update', update => {
              ldb.storeUpdate(docName, update)
            })
          },
          writeState: async (docName, ydoc) => {}
        }
      }

      // Load the server-messagehandlers modules
      this.serverHandlers = {};
      $tw.modules.applyMethods("server-messagehandlers", this.serverHandlers);
    }

    /*
      Session methods
    */
    /**
     * @param {WebsocketSession} session
     * @param {int} timeout
     */
    refreshSession (session,timeout) {
      if($tw.node && $tw.Bob.wsServer) {
        let eol = new Date(session.tokenEOL).getTime() + timeout;
        session.tokenEOL = new Date(eol).getTime();
        session.token = uuid_v4();
      }
    }

    /**
     * @param {WebSocket} socket
     * @param {UPGRADE} request
     * @param {$tw server state} state
      This function handles incomming connections from client sessions.
      It can support multiple client sessions, each with a unique sessionId.

      Session objects are defined in $:/plugins/OokTech/Bob/WSSession.js
     */
    handleWSConnection (socket,request,state) {
      if($tw.Bob.hasSession(state.sessionId)) {
        let session = $tw.Bob.getSession(state.sessionId);
        // Reset the connection state
        session.ip = state.ip;
        session.url = state.urlInfo;
        session.ws = socket;
        session.connecting = false;
        session.connected = true;
        session.synced = false;
    
        let doc = session.doc;
        doc.sessions.set(session, new Set())
    
        console.log(`['${state.sessionId}'] Opened socket ${socket._socket._peername.address}:${socket._socket._peername.port}`);
        // Event handlers
        socket.on('message', function(event) {
          let parsed, eventData;
          try {
            if (typeof event == "string") {
              parsed = JSON.parse(event);
            } else if (!!event.data && typeof event.data == "string") {
              parsed = JSON.parse(event.data);
            }        
          } catch (e) {
            consoler.error("WS handleMessage parse error: ", e, {level:1});
          }
          eventData = parsed||event;
          if(session.authenticateMessage(eventData)) {
            session.lastMessageReceived = time.getUnixTime();
            if(eventData.type == "y" ) {
              $tw.Bob.messageListener(session,eventData);debugger;
            } else {
              session.emit('message', [eventData, session]);
            }
          }
        });
        socket.on('close', function(event) {
          console.log(`['${session.id}'] Closed socket ${socket._socket._peername.address}:${socket._socket._peername.port}  (code ${socket._closeCode})`);
          session.connecting = false;
          session.connected = false;
          session.synced = false;
          // Close the WSSharedDoc session when disconnected
          $tw.Bob.closeWSConnection(doc,session,event);
          session.emit('disconnect', [{ type: 'disconnect' }, session]);
        });
        socket.on("error", function(error) {
          console.log(`['${session.id}'] socket error:`, JSON.toString(error));
        })

        session.emit('connect', [{ type: 'connect' }, session]);
      }
    }

    /**
     * @param {WSSharedDoc} doc
     * @param {WebsocketSession} session
     */
    closeWSConnection (doc,session,event) {
      if (doc.sessions.has(session)) {
        /**
         * @type {Set<number>}
         */
        // @ts-ignore
        const controlledIds = doc.sessions.get(session)
        doc.sessions.delete(session)
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)
        if (doc.sessions.size === 0 && this.persistence !== null) {
          // if persisted, we store state and destroy ydocument
          this.persistence.writeState(doc.name, doc).then(() => {
            doc.destroy()
          })
          this.ydocs.delete(doc.name)
        }
      }
      if (session.isReady()) {
        session.ws.close(1000, `['${this.id}'] Websocket closed by the server`,event);
      }
    }

    /*
      Yjs methods
    */

    /**
     * Gets a Y.Doc by name, whether in memory or on disk
     *
     * @param {string} docname - the name of the Y.Doc to find or create
     * @param {boolean} gc - whether to allow gc on the doc (applies only when created)
     * @return {WSSharedDoc}
     */
    getYDoc (docname,gc = this.gcEnabled) {
      return map.setIfUndefined(this.Ydocs, docname, () => {
        const doc = new WSSharedDoc(docname);
        doc.gc = gc;
        if (this.persistence !== null) {
          this.persistence.bindState(docname, doc);
        }
        this.Ydocs.set(docname, doc);
        return doc;
      })
    }

    /**
     * @param {any} session
     * @param {Websocket Message} eventData
     */
    messageListener (session,eventData) {
      let doc = eventData.doc == session.wikiName? session.doc : session.getSubDoc(eventData.doc);
      let message = Base64.toUint8Array(eventData.y);
      const encoder = encoding.createEncoder()
      const decoder = decoding.createDecoder(message)
      const messageType = decoding.readVarUint(decoder)
      switch (messageType) {
        case messageSync:
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.readSyncMessage(decoder, encoder, doc, null)
          if (encoding.length(encoder) > 1) {
            const buf = encoding.toUint8Array(encoder)
            let message = {
              type: 'y',
              flag: messageSync,
              doc: session.doc.name,
              y: Base64.fromUint8Array(buf)
            }
            session.sendMessage(message);
          }
          break
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), session)
          break
        }
        case messageAuth : {
          break
        }
        case messageQueryAwareness : {
          break
        }
      }
    }

    // Settings Methods

    /*
      Parse the default settings file and the normal user settings file
      This function modifies the input settings object with the properties in the
      json file at newSettingsPath
    */
    loadSettings (settings,bootPath) {
      const newSettingsPath = path.join(bootPath, 'settings', 'settings.json');
      let newSettings;
      if (typeof $tw.ExternalServer !== 'undefined') {
        newSettings = require(path.join(process.cwd(), 'LoadConfig.js')).settings;
      } else {
        if ($tw.node && !fs) {
          const fs = require('fs')
        }
        let rawSettings;
        // try/catch in case defined path is invalid.
        try {
          rawSettings = fs.readFileSync(newSettingsPath);
        } catch (err) {
          console.log('NodeSettings - No settings file, creating one with default values.');
          rawSettings = '{}';
        }
        // Try to parse the JSON after loading the file.
        try {
          newSettings = JSON.parse(rawSettings);
          console.log('NodeSettings - Parsed raw settings.');
        } catch (err) {
          console.log('NodeSettings - Malformed user settings. Using empty default.');
          console.log('NodeSettings - Check settings. Maybe comma error?');
          // Create an empty default settings.
          newSettings = {};
        }
      }
      // Extend the default with the user settings & normalize the wiki objects
      this.updateSettings(settings, newSettings);
      this.updateSettingsWikiPaths(settings.wikis);
      // Get the ip address to make it easier for other computers to connect.
      const ip = require('./External/IP/ip.js');
      const ipAddress = ip.address();
      settings.serverInfo = {
        name: settings.serverName,
        ipAddress: ipAddress,
        protocol: !!settings["tls-key"] && !!!settings["tls-cert"]? "https": "http",
        port: settings['ws-server'].port || "8080",
        host: settings['ws-server'].host || "127.0.0.1"
      }
    }

    /*
      Given a local and a global settings, this returns the global settings but with
      any properties that are also in the local settings changed to the values given
      in the local settings.
      Changes to the settings are later saved to the local settings.
    */
    updateSettings (globalSettings,localSettings) {
      /*
      Walk though the properties in the localSettings, for each property set the global settings equal to it, 
      but only for singleton properties. Don't set something like 
      GlobalSettings.Accelerometer = localSettings.Accelerometer, instead set 
      GlobalSettings.Accelerometer.Controller = localSettings.Accelerometer.Contorller
      */
      let self = this;
      Object.keys(localSettings).forEach(function (key, index) {
        if (typeof localSettings[key] === 'object') {
          if (!globalSettings[key]) {
            globalSettings[key] = {};
          }
          //do this again!
          self.updateSettings(globalSettings[key], localSettings[key]);
        } else {
          globalSettings[key] = localSettings[key];
        }
      });
    }

    /*
      This allows people to add wikis using name: path in the settings.json and
      still have them work correctly with the name: {path: path} setup.

      It takes the wikis section of the settings and changes any entries that are
      in the form name: path and puts them in the form name: {path: path}, and
      recursively walks through all the wiki entries.
    */
    updateSettingsWikiPaths (inputObj) {
      let self = this;
      Object.keys(inputObj).forEach(function (entry) {
        if (typeof inputObj[entry] === 'string') {
          inputObj[entry] = { 'path': inputObj[entry] }
        } else if (typeof inputObj[entry] === 'object' && !!inputObj[entry].wikis) {
          self.updateSettingsWikiPaths(inputObj[entry].wikis)
        }
      })
    }

    /*
      Creates initial settings tiddlers for the wiki.
    */
    createStateTiddlers (data,instance) {
      // Create the $:/ServerIP tiddler
      let pluginTiddlers = {
        "$:/state/Bob/ServerIP": {
          title: "$:/state/Bob/ServerIP",
          text: this.settings.serverInfo.ipAddress,
          protocol: this.settings.serverInfo.protocol,
          port: this.settings.serverInfo.port,
          host: this.settings.serverInfo.host
        }
      }
      if (typeof instance.wikiInfo === 'object') {
        // Get plugin list
        const fieldsPluginList = {
          title: '$:/state/Bob/ActivePluginList',
          list: $tw.utils.stringifyList(instance.wikiInfo.plugins)
        }
        pluginTiddlers['$:/state/Bob/ActivePluginList'] = fieldsPluginList;
        
        const fieldsThemesList = {
          title: '$:/state/Bob/ActiveThemesList',
          list: $tw.utils.stringifyList(instance.wikiInfo.themes)
        }
        pluginTiddlers['$:/state/Bob/ActiveThemesList'] = fieldsThemesList;
        
        const fieldsLanguagesList = {
          title: '$:/state/Bob/ActiveLanguagesList',
          list: $tw.utils.stringifyList(instance.wikiInfo.languages)
        }
        pluginTiddlers['$:/state/Bob/ActiveLanguagesList'] = fieldsLanguagesList;
      }
      const message = {
        type: 'saveTiddler',
        wiki: data.wiki,
        tiddler: {
          fields: {
            title: "$:/state/Bob",
            type: "application/json",
            "plugin-type": "plugin",
            text: JSON.stringify({tiddlers: pluginTiddlers}) 
          }
        }
      };
      //this.getSession(data.sessionId).sendMessage(message);
    }

    // Wiki methods

    /*
      This function loads a tiddlywiki instance, starts the given wiki and calls any callback.
    */
    loadWiki (wikiName,cb) {
      const settings = this.getWikiSettings(wikiName);
      let wikiPath = this.wikiExists(settings.path);
      // Make sure it isn't loaded already
      if(!!wikiPath && !this.Wikis.has(wikiName)) {
        try {
          let instance = (wikiName == 'RootWiki') ? $tw : require("./boot.js").TiddlyWiki();
          if (wikiName == 'RootWiki') {
            // We've already booted
          } else {
              // Pass the command line arguments to the boot kernel
              instance.boot.argv = ["+plugins/" + settings.syncadaptor, wikiPath];
              // Boot the TW5 app
              instance.boot.boot();
          }
          // Name the wiki
          instance.wikiName = wikiName;
          const fields = {
            title: '$:/WikiName',
            text: wikiName
          };
          instance.wiki.addTiddler(new $tw.Tiddler(fields));

          // Setup the Ydocs for the wiki
          let wikiDoc = this.getYDoc(wikiName);
          
          // Setup the FileSystemMonitors
          /*
          // Make sure that the tiddlers folder exists
          const error = $tw.utils.createDirectory($tw.Bob.Wikis[wikiName].wikiTiddlersPath);
          if(error){
            $tw.Bob.logger.error('Error creating wikiTiddlersPath', error, {level:1});
          }
          // Recursively build the folder tree structure
          $tw.Bob.Wikis[wikiName].FolderTree = buildTree('.', $tw.Bob.Wikis[wikiName].wikiTiddlersPath, {});
          if($tw.Bob.settings.disableFileWatchers !== 'yes') {
            // Watch the root tiddlers folder for chanegs
            $tw.Bob.WatchAllFolders($tw.Bob.Wikis[wikiName].FolderTree, wikiName);
          }
          */
          // Set the wiki as loaded
          this.Wikis.set(wikiName,instance);
          $tw.hooks.invokeHook('wiki-loaded',wikiName);
        } catch (err) {
          if (typeof cb === 'function') {
            cb(err);
          } else {
            console.error(err);
            return err;
          }
        }
      }
      if (typeof cb === 'function') {
        cb(null, this.getWikiPath(wikiName));
      } else {
        return this.getWikiPath(wikiName);
      }
    }

    /*
      Return the resolved filePathRoot
    */
    getFilePathRoot () {
      const currPath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      let basePath = '';
      this.settings.filePathRoot = this.settings.filePathRoot || './files';
      if (this.settings.filePathRoot === 'cwd') {
        basePath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      } else if (this.settings.filePathRoot === 'homedir') {
        basePath = os.homedir();
      } else {
        basePath = path.resolve(currPath, this.settings.filePathRoot);
      }
    }

    /*
      Return the resolved basePath
    */
    getBasePath () {
      const currPath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      let basePath = '';
      this.settings.wikiPathBase = this.settings.wikiPathBase || 'cwd';
      if (this.settings.wikiPathBase === 'homedir') {
        basePath = os.homedir();
      } else if (this.settings.wikiPathBase === 'cwd' || !this.settings.wikiPathBase) {
        basePath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      } else {
        basePath = path.resolve(currPath, this.settings.wikiPathBase);
      }
      return basePath;
    }

    /*
      Given a wiki name this generates the path for the wiki.
    */
    generateWikiPath (wikiName) {
      const basePath = this.getBasePath();
      return path.resolve(basePath, this.settings.wikisPath, wikiName);
    }

    /*
      Given a wiki name this gets the wiki path if one is listed, if the wiki isn't
      listed this returns undefined.
      This can be used to determine if a wiki is listed or not.
    */
    getWikiPath (wikiName) {
      let wikiSettings = this.getWikiSettings(wikiName), wikiPath = undefined;
      if (wikiSettings) {
        wikiPath = wikiSettings.path;
      }
      // If the wikiPath exists convert it to an absolute path
      if (typeof wikiPath !== 'undefined') {
        const basePath = this.getBasePath()
        wikiPath = path.resolve(basePath, this.settings.wikisPath, wikiPath);
      }
      return wikiPath;
    }

    /*
      Given a wiki name this gets the wiki settings object if one is listed, 
      if the wiki isn't listed this returns undefined.
      This can be used to determine if a wiki is listed or not.
    */
    getWikiSettings (wikiName) {
      let wikiSettings = undefined;
      if (wikiName == 'RootWiki') {
        wikiSettings = {
          path: path.resolve($tw.boot.wikiPath),
          admin: this.settings["ws-server"].admin,
          readers: this.settings["ws-server"].readers,
          writers: this.settings["ws-server"].writers,
          syncadaptor: this.settings["ws-server"].syncadaptor
        }
      } else if (typeof this.settings.wikis[wikiName] === 'object') {
        wikiSettings = this.settings.wikis[wikiName];
      } else {
        const parts = wikiName.split('/');
        let settings, obj = this.settings.wikis;
        for (let i = 0; i < parts.length; i++) {
          if (obj[parts[i]]) {
            if (i === parts.length - 1 && typeof obj[parts[i]] === 'object') {
              settings = obj[parts[i]];
            } else if (!!obj[parts[i]].wikis) {
              obj = obj[parts[i]].wikis;
            }
          } else {
            break;
          }
        }
        if (!!settings) {
          wikiSettings = settings;
        }
      }
      if (!wikiSettings.syncadaptor) {
        // Set the default syncadaptor
        wikiSettings.syncadaptor = this.settings["ws-server"].syncadaptor;
      }
      return wikiSettings;
    }

    /*
      This checks to make sure there is a tiddlwiki.info file in a wiki folder
      If so, the full wikipath is returned, else false is returned.
    */
    wikiExists (wikiFolder) {
      let exists = false;
      // Make sure that the wiki actually exists
      if (wikiFolder) {
        const basePath = this.getBasePath()
        // This is a bit hacky to get around problems with loading the root wiki
        // This tests if the wiki is the root wiki and ignores the other pathing
        // bits
        if (wikiFolder === $tw.boot.wikiPath) {
          wikiFolder = path.resolve($tw.boot.wikiPath)
        } else {
          // Get the correct path to the tiddlywiki.info file
          wikiFolder = path.resolve(basePath, this.settings.wikisPath, wikiFolder);
          // Make sure it exists
        }
        exists = fs.existsSync(path.resolve(wikiFolder, 'tiddlywiki.info'));
      }
      return exists? wikiFolder: false;
    }

  }
  
  exports.BobServer = BobServer;
}

})();