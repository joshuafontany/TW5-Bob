/*\
title: $:/plugins/OokTech/Bob/SessionManager.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

if ($tw.node) {

const url = require('url'),
{ v4: uuid_v4, NIL: uuid_NIL, validate: uuid_validate } = require('$:/plugins/OokTech/Bob/External/uuid/src/index.js'),
    WebSocketSession = require('$:/plugins/OokTech/Bob/WSSession.js').WebSocketSession,
    WebSocketUser = require('$:/plugins/OokTech/Bob/WSUser.js').WebSocketUser;

/*
    A simple session manager, it currently holds everything in server memory.
    Sessions "should" be stored externally when scaling up the server, 
    but we'll use a Map() for now.
    options: 
*/
function SessionManager(options) {
    options = options || {};
    this.sockets = options.sockets || new Map();
    this.sessions = options.sessions || new Map();
    this.anonymousUsers = options.anonymousUsers || new Map();
    this.authorizedUsers = options.authorizedUsers || new Map();
}

SessionManager.prototype.requestSession = function(state) {
    let userSession, 
        wikiName = state.queryParameters["wiki"],
        sessionId = state.queryParameters["session"];
    if(sessionId == uuid_NIL || !this.hasSession(sessionId)  
        || this.getSession(sessionId).displayUsername !== state.authenticatedUsername) {
        // Anon users always have a new random userid created
        userSession = this.newSession({
            ip: state.ip,
            referer: state.referer,
            wikiName: wikiName,
            userid: !state.anonymous? state.authenticatedUsername: uuid_v4(),
            displayUsername: state.username,
            access: this.getUserAccess(state.authenticatedUsername,state.wikiName),
            isLoggedIn: !!state.authenticatedUsername,
            isReadOnly: !!state["read_only"],
            isAnonymous: !!state.anonymous
        });
    } else {
        userSession = this.getSession(sessionId);
    }
    // Set a new login token and login tokenEOL. Only valid for 60 seconds.
    // These will be replaced with a session token during the "handshake".
    let eol = new Date();
    userSession.tokenEOL = eol.setMinutes(eol.getMinutes() + 1);
    userSession.token = uuid_v4();
    // Log the session in this.authorizedUsers or this.anonymousUsers
    this.updateUser(userSession);
    return userSession;
}

SessionManager.prototype.newSession = function(sessionData) {
    sessionData.id = uuid_v4();
    let session = new WebSocketSession(sessionData);
    this.setSession(session);
    return session;
}

SessionManager.prototype.verifyUpgrade = function(state) {
    let userSession;
    if (this.hasSession(state.sessionId)) {
        userSession = this.getSession(state.sessionId);
        // username, ip, & wikiName must match (token is tested in the 'handshake')
        if (
            state.username == userSession.displayUsername
            && state.ip == userSession.ip
            && state.wikiName == userSession.wikiName
        ) {
            return state;
        } else {
            return false;
        };
    } else {
        return false;
    }
}

SessionManager.prototype.refreshSession = function(sessionId) {
    let test = new Date(),
        session = this.getSession(sessionId);
    test.setMinutes(test.getMinutes() + 5);
    if (session.tokenEOL <= test) {
        let eol = new Date(session.tokenEOL);
        session.tokenEOL = eol.setHours(eol.getHours() + 1);
        session.token = uuid_v4();
    }
}

SessionManager.prototype.hasSession = function(sessionId) {
    return this.sessions.has(sessionId);
}

SessionManager.prototype.getSession = function(sessionId) {
    if (this.hasSession(sessionId)) {
       return this.sessions.get(sessionId);
    } else {
        return null;
    }
}

SessionManager.prototype.setSession = function(sessionData) {
    if (sessionData.id) {
        this.sessions.set(sessionData.id,sessionData);
    }
}

SessionManager.prototype.deleteSession = function(sessionId) {
    if (this.hasSession(sessionId)) {
        this.sessions.delete(sessionId);
    }
}

SessionManager.prototype.getSessionsByUserId = function(userid) {
    var usersSessions = new Map();
    for (let [id,session] of this.sessions.entries()) {
        if (session.userid === userid) {
            usersSessions.add(id,session);
        }
    }
    return usersSessions;
}

SessionManager.prototype.getSessionsByWiki = function(wikiName) {
    var wikiSessions = new Map();
    for (let [id,session] of this.sessions.entries()) {
        if (session.wikiName === wikiName) {
            wikiSessions.add(id,session);
        }
    }
    return wikiSessions;
}

SessionManager.prototype.hasSocket = function(sessionId) {
    return this.sockets.has(sessionId);
}

SessionManager.prototype.getSocket = function(sessionId) {
    if (this.hasSocket(sessionId)) {
       return this.sockets.get(sessionId);
    } else {
        return null;
    }
}

SessionManager.prototype.setSocket = function(socket) {
    if (socket.id) {
        this.sockets.set(socket.id,socket);
    }
}

SessionManager.prototype.deleteSocket = function(sessionId) {
    if (this.hasSocket(sessionId)) {
        let socket = this.getSocket(sessionID);
        socket.terminate();
        this.sockets.delete(sessionId);
    }
}

/*
    User methods
*/
SessionManager.prototype.updateUser = function(sessionData) {
    let user = null;
    if(!!sessionData.isAnonymous) {
        user = this.anonymousUsers.get(sessionData.userid) || this.newUser(sessionData);
    } else {
        user = this.authorizedUsers.get(sessionData.userid) || this.newUser(sessionData);
    }
    user.sessions.add(sessionData.id)
}

SessionManager.prototype.newUser = function(sessionData) {
    let user = new WebSocketUser(sessionData);
    if (user.isAnonymous) {
        this.anonymousUsers.set(user.id,user);
    } else {
        this.authorizedUsers.set(user.id,user);
    }
    return user;
}

SessionManager.prototype.isAdmin = function(username) {
    return $tw.Bob.server.isAuthorized("admin",username);
}

SessionManager.prototype.getUserAccess = function(username,wikiName) {
    wikiName = wikiName || 'RootWiki';
    if(!!username) {
        let type, accessPath = (wikiName == 'RootWiki')? "" : wikiName+'/';
        type = ($tw.Bob.server.isAuthorized(accessPath+"readers",username))? "readers" : null;
        type = ($tw.Bob.server.isAuthorized(accessPath+"writers",username))? "writers" : type;
        type = ($tw.Bob.server.isAuthorized("admin",username))? "admin" : type;
        return type;
    }
    return null;
}

SessionManager.prototype.getUsersByAccessType = function(type,wikiName) {
    var usersByAccess = new Map();
    for (let [id,user] of this.authorizedUsers.entries()) {
        if (this.getUserAccess(user.userid,wikiName) == type) {
            usersByAccess.add(id,user);
        }
    }
    return usersByAccess;
}

SessionManager.prototype.getUsersWithAccess = function(type,wikiName) {
    let usersWithAccess = new Map(),
        types = [null, "readers", "writers", "admin"];
    for (let [id,user] of this.authorizedUsers.entries()) {
        let access = this.getUserAccess(user.userid,wikiName);
        if (types.indexOf(access) >= types.indexOf(type)) {
            usersWithAccess.add(id,user);
        }
    }
    return usersWithAccess;
}

SessionManager.prototype.getViewableSettings = function(sessionId) {
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
SessionManager.prototype.sendMessage = function(sessionId,message,callback) {
    if (this.hasSession(sessionId)) {
      message = this.getSession(sessionId).prepareMessage(message);
      if (this.hasSocket(sessionId) && this.getSocket(sessionId).readyState === WebSocket.OPEN) {
        this.getSocket(sessionId).send(JSON.stringify(message));
      }
      if(!!callback && typeof callback === "function") {
        callback(null, {session: sessionId, message: message.id})
      } else {
        return message.id;
      }
    }  else {
      callback(`Error: no session found for id ${sessionId}`, {session: sessionId, message: null})
    }
  }

exports.SessionManager = SessionManager;
}

})();