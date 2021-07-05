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
  const { uniqueNamesGenerator, adjectives, colors, animals, names } = require('./External/unique-names-generator/dist/index.js');

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
          "timeout":10000 // default 10 second heartbeat timeout
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

      // YDocs
      this.Yversion = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob/External/yjs/yjs.cjs').fields.version;
      this.YDocs = new Map();
      // disable gc when using snapshots!
      this.gcEnabled = $tw.node? (process.env.GC !== 'false' && process.env.GC !== '0'): true;
      /**
       * @type {{bindState: function(string,WSSharedDoc):void, writeState:function(string,WSSharedDoc):Promise<any>, provider: any}|null}
       */
      this.persistence = null;

      // Sessions
      this.sessions = new Map();

      // Messages
      this.clientId = 0; // The current client message id

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

    // Create a new session
    createSession (options) {
      if(!options.client){
        if(options.id == uuid_NIL || !this.hasSession(options.id) || (
          this.hasSession(options.id) && time.getUnixTime() > this.getSession(options.id).expires
        )) {
          options.id = uuid_v4();
        }
      }
      if(!this.hasSession(options.id)) {
        let session = new WebsocketSession(options);
        session.on('message', this.handleMessage);
        this.sessions.set(options.id, session);
        return session;
      } else {
        return this.sessions.get(options.id); 
      }      
    }

    getSession (sessionId) {
      if(this.hasSession(sessionId)) {
        return this.sessions.get(sessionId);
      }
    }

    hasSession (sessionId) {
      return this.sessions.has(sessionId);
    }

    deleteSession (sessionId) {
      if (this.hasSession(sessionId)) {
        this.sessions.delete(sessionId);
      }
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
      return "c" + this.clientId++;
    }

    handleMessage (eventData,session) {
      let handler = session.client? $tw.Bob.clientHandlers[eventData.type]: $tw.Bob.serverHandlers[eventData.type];
      // Make sure we have a handler for the message type
      if(typeof handler === 'function') {
        // Determine the wiki
        let wiki = $tw.wiki;
        if($tw.node && $tw.Bob.Wikis.has(eventData.wikiName)) {
            wiki = $tw.Bob.Wikis.get(eventData.wikiName);
        }
        // Call the handler
        handler.call(session,eventData,wiki);
      } else {
        debugger;
        console.error(`['${session.id}'] WS handleMessage error: No handler for message of type ${eventData.type}`);
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

    loadWiki (wikiName = $tw.wiki.getTiddlerText("$:/status/WikiName", $tw.wiki.getTiddlerText("$:/SiteTitle", "")),cb) { 
      if(wikiName && !this.Wikis.has(wikiName)) {
        try{
          // Get the name for this wiki for websocket messages
          $tw.wikiName = wikiName;

          // Setup the YDoc for the wiki
          let wikiDoc = this.getYDoc(wikiName);
          let wikiMap = wikiDoc.getMap("wiki");
          let wikiTitles = wikiDoc.getArray("titles");
          let wikiTiddlers = wikiDoc.getArray("tiddlers");
          //Attach the persistence provider here

          // Attach a y-tiddlywiki provider here
          // This leaves each wiki's syncadaptor free to sync to disk or other storage

          // Setup the wikiTiddlers yarray deepObserver
          wikiTiddlers.observeDeep((events,transaction) => {
            wikiDoc.emit('tiddlers',[events,transaction])
          })

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
      return map.setIfUndefined(this.YDocs, docname, () => {
        const doc = new Y.Doc(docname);
        doc.gc = gc;
        doc.name = docname;
        if (this.persistence !== null) {
          this.persistence.bindState(docname, doc);
        }
        this.YDocs.set(docname, doc);
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
        type: 'y'+messageSync,
        doc: doc.name,
        y: Base64.fromUint8Array(mbuf)
      }
      s.send(message);
    })
    debugger;
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
            type: 'y'+messageAwareness,
            doc: this.name,
            y: Base64.fromUint8Array(abuf)
          }
          s.send(message);
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

      // Messages
      this.serverId = 0; // The current server message id

      // Users
      this.anonId = 0; // Incremented when an anonymous userid is created
      this.anonUsers = new Map();

      // 

      // YDocs
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

    setAnonUsername (state,session) {
      // Query the request state server for the anon username parameter
      let anon = state.server.get("anon-username")
      session.username = (anon || '') + uniqueNamesGenerator({
        dictionaries: [colors, adjectives, animals, names],
        style: 'capital',
        separator: '',
        length: 3,
        seed: $tw.Bob.anonId++
      });
    }

    getSessionsByUser (authenticatedUsername) {
      let usersSessions = new Map();
      for (let [id,session] of this.sessions.entries()) {
        if (session.authenticatedUsername === authenticatedUsername) {
          usersSessions.add(id,session);
        }
      }
      return usersSessions;
    }

    getSessionsByWiki (wikiName) {
      let wikiSessions = new Map();
      for (let [id, session] of this.sessions.entries()) {
        if (session.wikiName === wikiName) {
          wikiSessions.add(id, session);
        }
      }
      return wikiSessions;
    }

    /**
     * @param {WebsocketSession} session
     * @param {int} timeout
     */
    refreshSession (session,timeout) {
      if($tw.node && $tw.Bob.wsServer) {
        let eol = new Date(session.expires).getTime() + timeout;
        session.expires = new Date(eol).getTime();
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
    
        let doc = $tw.Bob.getYDoc(session.wikiName);
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
            if(eventData.type.startsWith('y')) {
              let eventDoc = eventData.doc == session.wikiName? doc : session.getSubDoc(eventData.doc);
              let message = Base64.toUint8Array(eventData.y);
              const encoder = encoding.createEncoder()
              const decoder = decoding.createDecoder(message)
              const messageType = decoding.readVarUint(decoder)
              switch (messageType) {
                case messageSync: {
                  encoding.writeVarUint(encoder, messageSync)
                  //syncProtocol.readSyncMessage(decoder, encoder, eventDoc, null)
                  // Implement Read-Only Sessions
                  const messageSyncType = decoding.readVarUint(decoder);
                  switch (messageSyncType) {
                    case syncProtocol.messageYjsSyncStep1:
                      syncProtocol.readSyncStep1(decoder, encoder, doc)
                      break
                    case syncProtocol.messageYjsSyncStep2:
                      if (!session.isReadOnly) syncProtocol.readSyncStep2(decoder, doc, null)
                      break
                    case syncProtocol.messageYjsUpdate:
                      if (!session.isReadOnly) syncProtocol.readUpdate(decoder, doc, null)
                      break
                    default:
                      throw new Error('Unknown message type')
                  }
                  if (encoding.length(encoder) > 1) {
                    const buf = encoding.toUint8Array(encoder)
                    let message = {
                      type: 'y'+messageSync,
                      doc: eventDoc.name,
                      y: Base64.fromUint8Array(buf)
                    }
                    session.send(message);
                  }
                  break
                }
                case messageAwareness: {
                  awarenessProtocol.applyAwarenessUpdate(eventDoc.awareness, decoding.readVarUint8Array(decoder), session)
                  break
                }
                case messageAuth : {
                  break
                }
                case messageQueryAwareness : {
                  break
                }
              }
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
          session.emit('status', [{ 
            status: 'disconnected', 
            event: event 
          },session]);
        });
        socket.on("error", function(error) {
          console.log(`['${session.id}'] socket error:`, error);
          session.emit('status', [{
            status: 'error', 
            error: error
          },session]);
        })

        session.emit('status', [{
          status: 'connected'
        },session]);
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
      return map.setIfUndefined(this.YDocs, docname, () => {
        const doc = new WSSharedDoc(docname);
        doc.gc = gc;
        if (this.persistence !== null) {
          this.persistence.bindState(docname, doc);
        }
        this.YDocs.set(docname, doc);
        return doc;
      })
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
    createStateTiddlers (data,wiki) {
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
      if (typeof wiki.wikiInfo === 'object') {
        // Get plugin list
        const fieldsPluginList = {
          title: '$:/state/Bob/ActivePluginList',
          list: $tw.utils.stringifyList(wiki.wikiInfo.plugins)
        }
        pluginTiddlers['$:/state/Bob/ActivePluginList'] = fieldsPluginList;
        
        const fieldsThemesList = {
          title: '$:/state/Bob/ActiveThemesList',
          list: $tw.utils.stringifyList(wiki.wikiInfo.themes)
        }
        pluginTiddlers['$:/state/Bob/ActiveThemesList'] = fieldsThemesList;
        
        const fieldsLanguagesList = {
          title: '$:/state/Bob/ActiveLanguagesList',
          list: $tw.utils.stringifyList(wiki.wikiInfo.languages)
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
      //this.getSession(data.sessionId).send(message);
    }

    // Wiki methods

    /*
      This function loads a tiddlywiki wiki and calls any callback.
    */
    loadWiki (wikiName,cb) {
      const settings = this.getWikiSettings(wikiName);
      let wikiPath = this.wikiExists(settings.path);
      // Make sure it isn't loaded already
      if(!!wikiPath && !this.Wikis.has(wikiName)) {
        try {
          //setup the tiddlywiki $instance
          let $i = (wikiName == 'RootWiki') ? $tw : Object.create(null);
          if (wikiName == 'RootWiki') {
            // We have already booted
          } else {
            //Create a new Wiki object
            $i.wiki = new $tw.Wiki();
            // Record boot info
            $i.boot.wikiPath = wikiPath;
            // Load the boot tiddlers (from $tw.loadTiddlersNode)
            $tw.utils.each($tw.loadTiddlersFromPath($tw.boot.bootPath),function(tiddlerFile) {
              $i.wiki.addTiddlers(tiddlerFile.tiddlers);
            });
            // Load the core tiddlers
            $i.wiki.addTiddler($tw.loadPluginFolder($tw.boot.corePath));
            // Load any required plugins
            // Set up http(s) server as $tw.Bob.server.httpServer
            $tw.utils.each($tw.Bob.settings["required-plugins"],function(name) {
              if(name.charAt(0) === "+") { // Relative path to plugin
                let pluginFields = $tw.loadPluginFolder(name.substring(1));
                if(pluginFields) {
                  $i.wiki.addTiddler(pluginFields);
                }
              } else {
                let parts = name.split("/"),
                  type = parts[0];
                if(parts.length  === 3 && ["plugins","themes","languages"].indexOf(type) !== -1) {
                  this.loadPlugins($i,[parts[1] + "/" + parts[2]],$tw.config[type + "Path"],$tw.config[type + "EnvVar"]);
                }
              }
            });
            // Load the tiddlers from the wiki directory
            $i.boot.wikiInfo = this.loadWikiTiddlers($i,wikiPath);
          }
          // Name the wiki
          $i.wikiName = wikiName;
          const fields = {
            title: '$:/status/WikiName',
            text: wikiName
          };
          $i.wiki.addTiddler(new $tw.Tiddler(fields));

          // Setup the YDoc for the wiki
          let wikiDoc = this.getYDoc(wikiName);
          let wikiMap = wikiDoc.getMap("wiki");
          let wikiTitles = wikiDoc.getArray("titles");
          let wikiTiddlers = wikiDoc.getArray("tiddlers");
          //Attach the persistence provider here

          // Attach a y-tiddlywiki provider here
          // This leaves each wiki's syncadaptor free to sync to disk or other storage

          // Log the titles of all tiddlers we are syncing
          let allTitles = $i.wiki.compileFilter($i.wiki.getTiddlerText("$:/config/SyncFilter")).call($i.wiki);
          wikiDoc.transact(() => {
            wikiMap.set("titles", allTitles);
          });

          // Setup the wikiTiddlers yarray deepObserver
          wikiTiddlers.observeDeep((events,transaction) => {
            console.log(events,transaction);debugger;
            if (transaction.origin !== $i && !!$i.syncer) {
              events.forEach(event => {
                if(event.currentTarget !== wikiTiddlers) {
                  // A tiddler map has updated
                  console.log(event);
                  let tiddlerFields = event.target.toJSON();
                  $i.syncer.storeTiddler(tiddlerFields);
                } else {
                  // A tiddler was added or removed
                  console.log(event);
                  let title = event.delta.removed;
                  console.log("Deleting tiddler:",title);
                  delete self.tiddlerInfo[title];
                  $i.wiki.deleteTiddler(title);
                }
              });
            }
          })

          // Setup the Wiki change event listener
          $i.wiki.addEventListener("change",function(changes) {
            let standardFields = [
              "title",
              "text",
              "modified",
              "modifier",
              "created",
              "creator",
              "tags",
              "type",
              "list",
              "caption"
            ];
            // Filter the changes to match the syncer settings
            let filteredChanges = $i.syncer.getSyncedTiddlers(function(callback) {
              $tw.utils.each(changes,function(change,title) {
                let tiddler = $i.wiki.tiddlerExists(title) && $i.wiki.getTiddler(title);
                callback(change,title,tiddler);
              });
            });
            $tw.utils.each(filteredChanges,function(change,title,tiddler) {
              let index = wikiTitles.toArray().indexOf(title);
              if(tiddler && change.modified) {
                let tiddlerFields = tiddler.getFieldStrings();
                wikiDoc.transact(() => {
                  let tiddlerMap = index == -1? ydoc.getMap(title): wikiTiddlers.get(index);
                  standardFields.forEach(field => {
                    if (tiddlerFields[field]) {
                      tiddlerMap.set(field,fieldStrings[field]);
                      delete tiddlerFields[field];
                    }
                  });
                  tiddlerMap.set("fields",fieldStrings);
                  tiddlerMap.set("revision",$i.wiki.getChangeCount(title).toString());
                  if(index == -1){
                    wikiTiddlers.push(tiddlerMap);
                    wikiTitles.push(title);
                  }
                  wikiMap.set("titles", $i.syncer.getSyncedTiddlers());
                },$i);                                
              }else if(change.deleted && index !== -1) {
                wikiDoc.transact(() => {
                  wikiTiddlers.delete(index,1);
                  wikiTitles.delete(index,1);
                  wikiMap.set("titles", $i.syncer.getSyncedTiddlers());
                },$i);
              }
            });
          });
          
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
          this.Wikis.set(wikiName,$i);
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
      $i: a Bob tiddlywiki instance  
      path: path of wiki directory
      options:
        parentPaths: array of parent paths that we mustn't recurse into
        readOnly: true if the tiddler file paths should not be retained
    */
    loadWikiTiddlers ($i,wikiPath,options) {
      options = options || {};
      let parentPaths = options.parentPaths || [],
        wikiInfoPath = path.resolve(wikiPath,$tw.config.wikiInfo),
        wikiInfo,
        pluginFields;
      // Bail if we don't have a wiki info file
      if(fs.existsSync(wikiInfoPath)) {
        wikiInfo = JSON.parse(fs.readFileSync(wikiInfoPath,"utf8"));
      } else {
        return null;
      }
      // Save the path to the tiddlers folder for the filesystemadaptor
      let config = wikiInfo.config || {};
      if($i.boot.wikiPath == wikiPath) {
        $i.boot.wikiTiddlersPath = path.resolve($i.boot.wikiPath,config["default-tiddler-location"] || $tw.config.wikiTiddlersSubDir);
      }
      // Load any included wikis
      if(wikiInfo.includeWikis) {
        parentPaths = parentPaths.slice(0);
        parentPaths.push(wikiPath);
        $tw.utils.each(wikiInfo.includeWikis,function(info) {
          if(typeof info === "string") {
            info = {path: info};
          }
          let resolvedIncludedWikiPath = path.resolve(wikiPath,info.path);
          if(parentPaths.indexOf(resolvedIncludedWikiPath) === -1) {
            let subWikiInfo = $tw.loadWikiTiddlers($i,resolvedIncludedWikiPath,{
              parentPaths: parentPaths,
              readOnly: info["read-only"]
            });
            // Merge the build targets
            wikiInfo.build = $tw.utils.extend([],subWikiInfo.build,wikiInfo.build);
          } else {
            $tw.utils.error("Cannot recursively include wiki " + resolvedIncludedWikiPath);
          }
        });
      }
      // Load any plugins, themes and languages listed in the wiki info file
      this.loadPlugins($i,wikiInfo.plugins,$tw.config.pluginsPath,$tw.config.pluginsEnvVar);
      this.loadPlugins($i,wikiInfo.themes,$tw.config.themesPath,$tw.config.themesEnvVar);
      this.loadPlugins($i,wikiInfo.languages,$tw.config.languagesPath,$tw.config.languagesEnvVar);
      // Load the wiki files, registering them as writable
      let resolvedWikiPath = path.resolve(wikiPath,$tw.config.wikiTiddlersSubDir);
      $tw.utils.each($tw.loadTiddlersFromPath(resolvedWikiPath),function(tiddlerFile) {
        if(!options.readOnly && tiddlerFile.filepath) {
          $tw.utils.each(tiddlerFile.tiddlers,function(tiddler) {
            $i.boot.files[tiddler.title] = {
              filepath: tiddlerFile.filepath,
              type: tiddlerFile.type,
              hasMetaFile: tiddlerFile.hasMetaFile,
              isEditableFile: config["retain-original-tiddler-path"] || tiddlerFile.isEditableFile || tiddlerFile.filepath.indexOf($i.boot.wikiTiddlersPath) !== 0
            };
          });
        }
        $i.wiki.addTiddlers(tiddlerFile.tiddlers);
      });
      if($i.boot.wikiPath == wikiPath) {
        // Save the original tiddler file locations if requested
        let output = {}, relativePath, fileInfo;
        for(let title in $i.boot.files) {
          fileInfo = $i.boot.files[title];
          if(fileInfo.isEditableFile) {
            relativePath = path.relative($i.boot.wikiTiddlersPath,fileInfo.filepath);
            fileInfo.originalpath = relativePath;
            output[title] =
              path.sep === "/" ?
              relativePath :
              relativePath.split(path.sep).join("/");
          }
        }
        if(Object.keys(output).length > 0){
          $i.wiki.addTiddler({title: "$:/config/OriginalTiddlerPaths", type: "application/json", text: JSON.stringify(output)});
        }
      }
      // Load any plugins within the wiki folder
      let wikiPluginsPath = path.resolve(wikiPath,$tw.config.wikiPluginsSubDir);
      if(fs.existsSync(wikiPluginsPath)) {
        let pluginFolders = fs.readdirSync(wikiPluginsPath);
        for(let t=0; t<pluginFolders.length; t++) {
          pluginFields = $tw.loadPluginFolder(path.resolve(wikiPluginsPath,"./" + pluginFolders[t]));
          if(pluginFields) {
            $i.wiki.addTiddler(pluginFields);
          }
        }
      }
      // Load any themes within the wiki folder
      let wikiThemesPath = path.resolve(wikiPath,$tw.config.wikiThemesSubDir);
      if(fs.existsSync(wikiThemesPath)) {
        let themeFolders = fs.readdirSync(wikiThemesPath);
        for(let t=0; t<themeFolders.length; t++) {
          pluginFields = $tw.loadPluginFolder(path.resolve(wikiThemesPath,"./" + themeFolders[t]));
          if(pluginFields) {
            $i.wiki.addTiddler(pluginFields);
          }
        }
      }
      // Load any languages within the wiki folder
      let wikiLanguagesPath = path.resolve(wikiPath,$tw.config.wikiLanguagesSubDir);
      if(fs.existsSync(wikiLanguagesPath)) {
        let languageFolders = fs.readdirSync(wikiLanguagesPath);
        for(let t=0; t<languageFolders.length; t++) {
          pluginFields = $tw.loadPluginFolder(path.resolve(wikiLanguagesPath,"./" + languageFolders[t]));
          if(pluginFields) {
            $i.wiki.addTiddler(pluginFields);
          }
        }
      }
      return wikiInfo;
    };

    /*
      $i: a Bob tiddlywiki instance
      plugins: Array of names of plugins (eg, "tiddlywiki/filesystemadaptor")
      libraryPath: Path of library folder for these plugins (relative to core path)
      envVar: Environment variable name for these plugins
    */
    loadPlugins ($i,plugins,libraryPath,envVar) {
      if(plugins) {
        var pluginPaths = $tw.getLibraryItemSearchPaths(libraryPath,envVar);
        for(var t=0; t<plugins.length; t++) {
          $tw.loadPlugin($i,plugins[t],pluginPaths);
        }
      }
    };

    /*
      $i: a Bob tiddlywiki instanc
      name: Name of the plugin to load
      paths: array of file paths to search for it
    */
    loadPlugin ($i,name,paths) {
      var pluginPath = $tw.findLibraryItem(name,paths);
      if(pluginPath) {
        var pluginFields = $tw.loadPluginFolder(pluginPath);
        if(pluginFields) {
          $i.wiki.addTiddler(pluginFields);
          return;
        }
      }
      console.log("Warning: Cannot find plugin '" + name + "'");
    };

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
      let wikiPath = this.getWikiSettings(wikiName).path || undefined;
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
        wikiSettings.admin = this.settings["ws-server"].admin,
        wikiSettings.readers = wikiSettings.readers || this.settings["ws-server"].readers,
        wikiSettings.writers = wikiSettings.writers || this.settings["ws-server"].writers,
        wikiSettings.syncadaptor = wikiSettings.syncadaptor || this.settings["ws-server"].syncadaptor;
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