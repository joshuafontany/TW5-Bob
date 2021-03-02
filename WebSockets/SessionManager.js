/*\
title: $:/plugins/OokTech/Bob/SessionManager.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const { v4: uuid_v4, NIL: uuid_NIL, validate: uuid_validate } = require('$:/plugins/OokTech/Bob/External/uuid/src/index.js'),
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
    this.admin = new Set(options.admin || []);
    this.sessions = options.sessions || new Map();
    this.anonymousUsers = options.anonymousUsers || new Map();
    this.authorizedUsers = options.authorizedUsers || new Map();
}

SessionManager.prototype.getUserAccess = function(username,wikiName) {
    wikiName = wikiName || 'RootWiki';
    if(!!username) {
        if (this.isAdmin(username)) {
            return "admin";
        } else {
            let wikiSettings = $tw.ServerSide.getWikiSettings(wikiName);
        }
    }
    return null;    //return $tw.Bob.getAccess(username,wikiName);
}

SessionManager.prototype.requestSession = function(state) {
    let userSession, sessionId = state.queryParameters["session"];debugger;
    if(sessionId == uuid_NIL || !this.hasSession(sessionId)  
        || this.getSession(sessionId).username !== state.authenticatedUsername) {
        userSession = this.newSession({
            wikiname: state.wikiName,
            ip: state.ip,
            username: state.username,
            access: this.getUserAccess(state.username,state.wikiName),
            isLoggedIn: !!state.authenticatedUsername,
            isReadOnly: !!state["read_only"],
            isAnonymous: !!state.anonymous
        });
    } else {
        userSession = this.getSession(sessionId);
    }
    // Set a new token and tokenEOL
    let now = new Date();
    userSession.tokenEOL = now.setHours(now.getHours() + 1);
    userSession.token = uuid_v4();
    // Log the session in this.authorizedUsers or this.anonymousUsers
    this.updateUser(userSession);
    return userSession;
}

SessionManager.prototype.newSession = function(sessionData) {
    sessionData.id = uuid_v4();
    let session = new WebSocketSession(sessionData);
    session.initState();
    this.setSession(session);
    return session;
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

/*
    User methods
*/
SessionManager.prototype.updateUser = function(sessionData) {
    let user = null;
    if(!!sessionData.isAnonymous) {
        // Anon users always have a new user object created with a random userid
        sessionData.userid = uuid_v4();
        user = this.newUser(sessionData);
    } else {
        user = this.authorizedUsers.get(sessionData.username) || this.newUser(sessionData);
    }
    user.sessions.set(sessionData.id,sessionData.wikiName)
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
    if (this.authorizedUsers.has(username)) {
        return this.admin.has("(authenticated)") || this.admin.has(username);
    } else {
        return null;
    }
}

SessionManager.prototype.getUsersByAccessLevel = function(level) {
    var usersByAccess = new Map();
    for (let [id,user] of this.authorizedUsers.entries()) {
        if (user.access === level) {
            usersByAccess.add(id,user);
        }
    }
    return usersByAccess;
}

SessionManager.prototype.getUsersWithAccess = function(level) {
    var usersWithAccess = new Map();
    for (let [id,user] of this.authorizedUsers.entries()) {
        if (user.access >= level) {
            usersWithAccess.add(id,user);
        }
    }
    return usersWithAccess;
}

if($tw.node) {
    exports.SessionManager = SessionManager;
}

})();