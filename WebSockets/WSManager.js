/*\
title: $:/plugins/OokTech/Bob/WSManager.js
type: application/javascript
module-type: library TEST


\*/
(function() {

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";

  let Yutils = require('./External/yjs/y-utils.cjs'),
    WebSocketSession = require('./WSSession.js').WebSocketSession,
    WebSocketUser = require('./WSUser.js').WebSocketUser;

  /*
      A simple session manager, it currently holds everything in server memory.
      Sessions "should" be stored externally when scaling up the server, 
      but we'll use a Map() for now.
      options: 
  */
  function WebSocketManager(options) {
    options = options || {};
    // Init
    this.sessions = options.sessions || new Map();
    this.anonymousUsers = options.anonymousUsers || new Map();
    this.authorizedUsers = options.authorizedUsers || new Map();
    // Setup Y-wsbob providers map
    this.yproviders = new Map();
    // Setup a Message Queue
    this.clientId = 0; // The current client message id
    this.serverId = 0; // The current server message id
    this.tickets = new Map(options.tickets || []); // The message ticket queue
    // Load the client-messagehandlers modules
    this.clientHandlers = {};
    $tw.modules.applyMethods("client-messagehandlers", this.clientHandlers);
    if ($tw.node) {
      // Load the server-messagehandlers modules
      this.serverHandlers = {};
      $tw.modules.applyMethods("server-messagehandlers", this.serverHandlers);
    }
  }

  WebSocketManager.prototype.getHost = function(host) {
    host = new $tw.Bob.url(host || (!!document.location && document.location.href));
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

  WebSocketManager.prototype.verifyUpgrade = function(state) {
    let userSession = this.getSession(state.sessionId);
    // username, ip, & wikiName must match (token is tested in the 'handshake')
    if(userSession 
      && state.username == userSession.username
      && state.ip == userSession.ip
      && state.wikiName == userSession.wikiName
    ) {
      return state;
    } else {
      return null;
    }
  }

  // Tests a session's socket connection
  WebSocketManager.prototype.isReady = function(sessionId) {
    return this.hasSocket(sessionId) && this.getSession(sessionId).ws.readyState == 1;
  }

  // Create a new session (serverside)
  WebSocketManager.prototype.newSession = function(sessionData) {
    let session = new WebSocketSession(sessionData);
    this.setSession(session);
    return session;
  }

  WebSocketManager.prototype.hasSession = function(sessionId) {
    return this.sessions.has(sessionId);
  }

  WebSocketManager.prototype.getSession = function(sessionId) {
    if (this.hasSession(sessionId)) {
      return this.sessions.get(sessionId);
    } else {
      return null;
    }
  }

  WebSocketManager.prototype.setSession = function(sessionData) {
    if (sessionData.id) {
      this.sessions.set(sessionData.id, sessionData);
    }
  }

  WebSocketManager.prototype.deleteSession = function(sessionId) {
    if (this.hasSession(sessionId)) {
      this.sessions.delete(sessionId);
    }
  }

  WebSocketManager.prototype.getSessionsByUserId = function(userid) {
    var usersSessions = new Map();
    for (let [id, session] of this.sessions.entries()) {
      if (session.userid === userid) {
        usersSessions.add(id, session);
      }
    }
    return usersSessions;
  }

  WebSocketManager.prototype.getSessionsByWiki = function(wikiName) {
    var wikiSessions = new Map();
    for (let [id, session] of this.sessions.entries()) {
      if (session.wikiName === wikiName) {
        wikiSessions.add(id, session);
      }
    }
    return wikiSessions;
  }

  /*
      Ticket methods
  */
  WebSocketManager.prototype.hasTicket = function(messageId) {
    return this.tickets.has(messageId);
  }

  WebSocketManager.prototype.getTicket = function(messageId) {
    if (this.hasTicket(messageId)) {
      return this.tickets.get(messageId);
    } else {
      return null;
    }
  }

  WebSocketManager.prototype.setTicket = function(ticketData) {
    if (ticketData.id) {
      this.tickets.set(ticketData.id, ticketData);
    }
  }

  WebSocketManager.prototype.deleteTicket = function(messageId) {
    if (this.hasTicket(messageId)) {
      this.tickets.delete(messageId);
    }
  }

  /*
    Y methods
  */
  WebSocketManager.prototype.initYProvider = function(session,docname) {
    docname = docname || session.wikiName
    return Yutils.getProvider(session,docname);
  }

  WebSocketManager.prototype.openYProviders = function(session) {
    if(this.yproviders.has(session.id)) {
      let docs = this.yproviders.get(session.id);
      docs.forEach(docname,provider => {
        provider.openConn();
      });
    }   
  }

  WebSocketManager.prototype.closeYProviders = function(session) {
    if(this.yproviders.has(session.id)) {
      let docs = this.yproviders.get(session.id);
      docs.forEach(docname,provider => {
        provider.closeConn();
      });
    }  
  }

  WebSocketManager.prototype.initYConnection = function(session,docname) {
    docname = docname || session.wikiName;
    Yutils.openConn(session,docname);
  }

  WebSocketManager.prototype.openYConnections = function(session) {
    $tw.Bob.Ydocs.forEach(docname,doc => {
      Yutils.openConn(session,docname);
    });
  }

  WebSocketManager.prototype.closeYConnections = function(session) {
    $tw.Bob.Ydocs.forEach(docname,doc => {
      Yutils.closeConn(session,docname);
    });
  }

  /*
      User methods
  */
  WebSocketManager.prototype.updateUser = function(sessionData) {
    let user = null;
    if (!!sessionData.isAnonymous) {
      user = this.anonymousUsers.get(sessionData.userid) || this.newUser(sessionData);
    } else {
      user = this.authorizedUsers.get(sessionData.userid) || this.newUser(sessionData);
    }
    user.sessions.add(sessionData.id)
  }

  WebSocketManager.prototype.newUser = function(sessionData) {
    let user = new WebSocketUser(sessionData);
    if (user.isAnonymous) {
      this.anonymousUsers.set(user.id, user);
    } else {
      this.authorizedUsers.set(user.id, user);
    }
    return user;
  }

  WebSocketManager.prototype.getUsersByAccessType = function(type, wikiName) {
    var usersByAccess = new Map();
    for (let [id, user] of this.authorizedUsers.entries()) {
      if (this.getUserAccess(user.userid, wikiName) == type) {
        usersByAccess.add(id, user);
      }
    }
    return usersByAccess;
  }

  WebSocketManager.prototype.getUsersWithAccess = function(type, wikiName) {
    let usersWithAccess = new Map(),
      types = [null, "readers", "writers", "admin"];
    for (let [id, user] of this.authorizedUsers.entries()) {
      let access = this.getUserAccess(user.userid, wikiName);
      if (types.indexOf(access) >= types.indexOf(type)) {
        usersWithAccess.add(id, user);
      }
    }
    return usersWithAccess;
  }

  WebSocketManager.prototype.getViewableSettings = function(sessionId) {
    const tempSettings = {};
    if (this.hasSession(sessionId)) {
      let session = this.getSession(sessionId);
      // section visible to anyone
      tempSettings.API = $tw.Bob.settings.API;
      tempSettings['ws-client'] = $tw.Bob.settings['ws-client'];
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
  
  /*
    If a heartbeat is not received within $tw.Bob.settings['ws-client'].heartbeat.timeout from
    the last heartbeat, terminate the given socket. Setup the next heartbeat.
  */
  WebSocketManager.prototype.heartbeat = function(data){
    if(data.sessionId) {
      console.log("heartbeat");
      let session = this.getSession(data.sessionId);
      if(session) {
        // clear the ping timers
        clearTimeout(session.state.pingTimeout);
        clearTimeout(session.state.ping);
        // Delay should be equal to the interval at which your server
        // sends out pings plus a conservative assumption of the latency.  
        session.state.pingTimeout = setTimeout(function() {
          if(session.ws && session.ws.readyState == 1) {
            session.ws.close(4000, `['${session.ws.id}'] Websocket closed by session.state.pingTimeout`);
          }
        }, $tw.Bob.settings['ws-client'].heartbeat.timeout + $tw.Bob.settings['ws-client'].heartbeat.interval);
        // Send the next heartbeat ping after $tw.Bob.settings['ws-client'].heartbeat.interval ms
        session.state.ping = setTimeout(function() {
          session.send({
            type: 'ping',
            id: 'heartbeat'
          });
        }, $tw.Bob.settings['ws-client'].heartbeat.interval); 
      }
    }
  }

  WebSocketManager.prototype.syncToServer = function(sessionId) {
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

exports.WebSocketManager = WebSocketManager;

})();