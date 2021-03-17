/*\
title: $:/plugins/OokTech/Bob/WSManager.js
type: application/javascript
module-type: library TEST


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

if ($tw.node) {
    const  { URL } = require('url');
}
const WebSocketSession = require('$:/plugins/OokTech/Bob/WSSession.js').WebSocketSession,
    WebSocketUser = require('$:/plugins/OokTech/Bob/WSUser.js').WebSocketUser;

/*
    A simple session manager, it currently holds everything in server memory.
    Sessions "should" be stored externally when scaling up the server, 
    but we'll use a Map() for now.
    options: 
*/
function WebSocketManager(options) {
    options = options || {};
    this.sockets = options.sockets || new Map();
    this.sessions = options.sessions || new Map();
    this.anonymousUsers = options.anonymousUsers || new Map();
    this.authorizedUsers = options.authorizedUsers || new Map();
    // Setup a Message Queue
    this.messageId = 0; // The current message id
    this.tickets = new Map(options.tickets || []); // The message ticket queue
    // Load the client-messagehandlers modules
    this.clientHandlers = {};
    $tw.modules.applyMethods("client-messagehandlers",this.clientHandlers);
    if($tw.node) {
        // Load the server-messagehandlers modules
        this.serverHandlers = {};
        $tw.modules.applyMethods("server-messagehandlers",this.serverHandlers);
    }
}

// Tests a session's socket connection
WebSocketManager.prototype.isReady = function(sessionId) {
    return this.hasSocket(sessionId) && this.getSocket(sessionId).readyState === WebSocket.OPEN;
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
    if(this.hasSession(sessionId)) {
       return this.sessions.get(sessionId);
    } else {
        return null;
    }
}

WebSocketManager.prototype.setSession = function(sessionData) {
    if(sessionData.id) {
        this.sessions.set(sessionData.id,sessionData);
    }
}

WebSocketManager.prototype.deleteSession = function(sessionId) {
    if(this.hasSession(sessionId)) {
        this.sessions.delete(sessionId);
    }
}

WebSocketManager.prototype.getSessionsByUserId = function(userid) {
    var usersSessions = new Map();
    for (let [id,session] of this.sessions.entries()) {
        if(session.userid === userid) {
            usersSessions.add(id,session);
        }
    }
    return usersSessions;
}

WebSocketManager.prototype.getSessionsByWiki = function(wikiName) {
    var wikiSessions = new Map();
    for (let [id,session] of this.sessions.entries()) {
        if(session.wikiName === wikiName) {
            wikiSessions.add(id,session);
        }
    }
    return wikiSessions;
}

WebSocketManager.prototype.hasSocket = function(sessionId) {
    return this.sockets.has(sessionId);
}

WebSocketManager.prototype.getSocket = function(sessionId) {
    if(this.hasSocket(sessionId)) {
       return this.sockets.get(sessionId);
    } else {
        return null;
    }
}

WebSocketManager.prototype.setSocket = function(socket) {
    if(socket.id) {
        this.sockets.set(socket.id,socket);
    }
}

WebSocketManager.prototype.deleteSocket = function(sessionId) {
    if(this.hasSocket(sessionId)) {
        let socket = this.getSocket(sessionID);
        socket.terminate();
        this.sockets.delete(sessionId);
    }
}

/*
    Ticket methods
*/
WebSocketManager.prototype.hasTicket = function(messageId) {
    return this.tickets.has(messageId);
}

WebSocketManager.prototype.getTicket = function(messageId) {
    if(this.hasTicket(messageId)) {
       return this.tickets.get(messageId);
    } else {
        return null;
    }
}

WebSocketManager.prototype.setTicket = function(ticketData) {
    if(ticketData.message.id) {
        this.tcikets.set(ticketData.message.id,ticketData);
    }
}

WebSocketManager.prototype.deleteTicket = function(messageId) {
    if(this.hasTicket(messageId)) {
        this.tickets.delete(messageId);
    }
}

/*
    User methods
*/
WebSocketManager.prototype.updateUser = function(sessionData) {
    let user = null;
    if(!!sessionData.isAnonymous) {
        user = this.anonymousUsers.get(sessionData.userid) || this.newUser(sessionData);
    } else {
        user = this.authorizedUsers.get(sessionData.userid) || this.newUser(sessionData);
    }
    user.sessions.add(sessionData.id)
}

WebSocketManager.prototype.newUser = function(sessionData) {
    let user = new WebSocketUser(sessionData);
    if(user.isAnonymous) {
        this.anonymousUsers.set(user.id,user);
    } else {
        this.authorizedUsers.set(user.id,user);
    }
    return user;
}

WebSocketManager.prototype.getUsersByAccessType = function(type,wikiName) {
    var usersByAccess = new Map();
    for (let [id,user] of this.authorizedUsers.entries()) {
        if(this.getUserAccess(user.userid,wikiName) == type) {
            usersByAccess.add(id,user);
        }
    }
    return usersByAccess;
}

WebSocketManager.prototype.getUsersWithAccess = function(type,wikiName) {
    let usersWithAccess = new Map(),
        types = [null, "readers", "writers", "admin"];
    for (let [id,user] of this.authorizedUsers.entries()) {
        let access = this.getUserAccess(user.userid,wikiName);
        if(types.indexOf(access) >= types.indexOf(type)) {
            usersWithAccess.add(id,user);
        }
    }
    return usersWithAccess;
}

WebSocketManager.prototype.getViewableSettings = function(sessionId) {
    const tempSettings = {};
    if(this.hasSession(sessionId)) {
        let session = this.getSession(sessionId);
        // section visible to anyone
        tempSettings.API = $tw.Bob.settings.API;
        tempSettings.heartbeat = $tw.Bob.settings.heartbeat;
        tempSettings.reconnect = $tw.Bob.settings.reconnect;
        // Federation stuff is visible because you don't have to login to want to see
        // if federation is possible with a server
        tempSettings.enableFederation = $tw.Bob.settings.enableFederation;
        if(tempSettings.enableFederation == "yes") {
            tempSettings.federation = $tw.Bob.settings.federation;    
        }
        // Section visible by logged in people
        if(session.isLoggedIn) {
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
        if(session.isLoggedIn && session.access === 'admin') {
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
    Message methods
*/ 
// The handle message function
WebSocketManager.prototype.handleMessage = function(eventData) {
  // Check authentication
  const authenticated = this.sessions.get(eventData.sessionId).authenticateMessage(eventData);
  // Make sure we have a handler for the message type
  if(!!authenticated && typeof this.messageHandlers[eventData.type] === 'function') {
      // Acknowledge the message
      $tw.utils.sendMessageAck(eventData);
      // Determine the wiki instance
      if(eventData.wikiname == "RootWiki") {
          eventData.instance = $tw;
      } else if($tw.Bob.Wikis.has(eventData.eventName)) {
          eventData.instance = $tw.Bob.Wikis.get(eventData.wikiName);
      }
      // Call the handler(s)
      $tw.Bob.wsServer.messageHandlers[eventData.type](eventData);
  } else {
      $tw.Bob.logger.error('WS handleMessage error: No handler for message of type ', eventData.type, {level:3});
  }
}

exports.WebSocketManager = WebSocketManager;

})();