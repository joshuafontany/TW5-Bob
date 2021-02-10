/*\
title: $:/plugins/OokTech/Bob/SessionManager.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const uuidv4 = require('$:/plugins/OokTech/Bob/External/uuid/uuidv4.js')

/*
    A simple session manager, it currently holds everything in server memory.
    Sessions "should" be stored externally when scaling up the server, 
    but we'll use a Map() for now.
    options: 
*/
function SessionManager(options) {
    this.users = options.users || new Map();
    this.sessions = options.sessions || new Map();
}

SessionManager.prototype.accessLevels = {
    Guest: 0,
    Normal: 1,
    Admin: 2
};

SessionManager.prototype.addUser = function(userData) {
    let userId = userData.id || uuidv4();
    this.users.set(userId,userData);
}

SessionManager.prototype.removeUser = function(userId) {
    if (this.users.has(userId)) {
        this.users.delete(userId);
    }
}

SessionManager.prototype.getUser = function(userId) {
    if (this.users.has(userId)) {
       return this.users.get(userId);
    }
}

SessionManager.prototype.isAdmin = function(userId) {
    if (this.users.has(userId)) {
        return this.users.get(userId).access == this.accessLevels.Admin;
    }
    return null;
}

SessionManager.prototype.getUsersByAccessLevel = function(level,loggedIn) {
    var usersByAccess = new Map();
    for (let [id,user] of this.users.entries()) {
        if (user.access === level && (!!loggedIn && user.loggedIn)) {
            usersByAccess.add(id,user);
        }
    }
    return usersByAccess;
}

SessionManager.prototype.getUsersWithAccess = function(level,loggedIn) {
    var usersByAccess = new Map();
    for (let [id,user] of this.users.entries()) {
        if (user.access >= level && (!!loggedIn && user.loggedIn)) {
            usersByAccess.add(id,user);
        }
    }
    return usersByAccess;
}

SessionManager.prototype.addSession = function(sessionData) {
    let sessionId = sessionData.id || uuidv4();
    this.sessions.set(sessionId,sessionData);
}

SessionManager.prototype.removeSession = function(sessionId) {
    if (this.sessions.has(sessionId)) {
        this.sessions.delete(sessionId);
    }
}

SessionManager.prototype.getSession = function(sessionId) {
    if (this.sessions.has(sessionId)) {
       return this.sessions.get(sessionId);
    }
}

SessionManager.prototype.getSessionsByUserId = function(userId) {
    var usersSessions = new Map();
    for (let [id,session] of this.sessions.entries()) {
        if (session.userId === userId) {
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


exports.SessionManager = SessionManager;
});