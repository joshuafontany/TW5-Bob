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
        // Test the token and tokenEOL
        let now = new Date();
        if (
            state.username == userSession.displayUsername
            && state.ip == userSession.ip
            && state.wikiName == userSession.wikiName
            && state.token == userSession.token
            && now < userSession.tokenEOL
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
        socket.destroy();
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

    exports.SessionManager = SessionManager;
}

})();