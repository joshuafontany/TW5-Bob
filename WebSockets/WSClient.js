/*\
title: $:/plugins/OokTech/Bob/WSClient.js
type: application/javascript
module-type: library

A simple websocket client. On the server-side, these methods
are split among the SessionManager and the WebSocketServer.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const CONFIG_HOST_TIDDLER = "$:/config/bob/host",
  DEFAULT_HOST_TIDDLER = "$protocol$//$host$/",
  WebSocketSession = require('$:/plugins/OokTech/Bob/WSSession.js').WebSocketSession;

/*
  A simple websocket client
  options: 
*/
function WebSocketClient(options) {
  options = options || {};
  this.wiki = options.wiki || $tw.wiki;
  this.wikiName = this.wiki.getTiddlerText('$:/WikiName','');
  this.sessions = options.sessions || new Map();
  // Load the browser-messagehandlers modules
  this.messageHandlers = {};
  $tw.modules.applyMethods("browser-messagehandlers",this.messageHandlers);
  // Setup the heartbeat settings RE-DO ALL OF THIS
  this.settings = options.settings || {};
  this.settings.heartbeat = {
    "interval":1000, // default 1 sec heartbeats
    "timeout":5000 // default 5 second heartbeat timeout
  };
  this.settings.reconnect = {
    "auto": true,
    "initial": 100, // small initial increment
    "decay": 1.5, // exponential decay d^n (number-of-retries)
    "max": 10000, // maximum retry increment
    "abort": 60000 // failure after this long
  }

}

WebSocketClient.prototype.getHost = function() {
  // Websocket host
  let text = this.wiki.getTiddlerText(CONFIG_HOST_TIDDLER,DEFAULT_HOST_TIDDLER),
    substitutions = [
      {name: "protocol", value: ""},
      {name: "host", value: document.location.host}
    ];
  if (document.location.protocol === "http:") {
    substitutions["protocol"] = "ws://";
  } else if (document.location.protocol === "https:") {
    substitutions["protocol"] = "wss://";
  }
  for(let t=0; t<substitutions.length; t++) {
    let s = substitutions[t];
    text = $tw.utils.replaceString(text,new RegExp("\\$" + s.name + "\\$","mg"),s.value);
  }
  if (!!$tw.wikiName && $tw.wikiName !== "RootWiki") {
    let regxName = new RegExp($tw.wikiName + "\\/?$");
    text = text.replace(regxName,'');
  }
  return text;
}

// Tests a session's socket connection
WebSocketClient.prototype.isReady = function(sessionId) {
  let state = false;
  if (this.sessions.has(sessionId)) {
    state = this.sessions.get(sessionId).socket.readyState === WebSocket.OPEN;
  }
  return state;
}

// This handles the WSAdaptor's getSession() call and refreshes 
// the given session data from the wsserver (or the passed url). Even anon & 
// write-only clients get a session - to start a heartbeat, recieve alerts, etc.
WebSocketClient.prototype.initSession = function(options){
  let session = new WebSocketSession(options);
  this.sessions.set(session.id,session);
  return session.id;
}

WebSocketClient.prototype.connect = function(clientId) {
  let session = this.sessions.get(clientId);
  if(!session || !session.url) {
    console.error(`WebSocketClient.connect error: no url`)
    return false;
  }
  // Create the socket
  try{
    session.socket = new WebSocket(session.url);
    session.socket.onopen = this.openSocket;
    session.socket.onclose = this.closeSocket;
    session.socket.onmessage = this.handleMessage;
    session.socket.binaryType = "arraybuffer";
    session.socket.id = clientId;
  } catch (e) {
    //console.error(e)
    throw new Error(e);
  }
}

WebSocketClient.prototype.reconnect = function(clientId) {
  let session = this.sessions.get(clientId);
  if(!session || !session.url) {
    console.error(`WebSocketClient.reconnect error: no url`)
    return false;
  }
  // Clear the socket
  session.socket = null;
  // Timestamp the start time on reconnect attempts
  if(!session.state.reconnecting){
    session.state.reconnecting = new Date();
  }
  // Log the attempt
  session.state.attempts++;
  // Calculate the next exponential backoff delay
  let delay = (Math.random()+0.5) * this.settings.reconnect.initial * Math.pow(this.settings.reconnect.decay, session.state.attempts);
  // Use the delay or the $tw.Bob.settings.reconnect.max value
  session.state.delay = Math.min(delay, this.settings.reconnect.max);
  // Recreate the socket
  this.connect(clientId);
}

/*
  When the socket is opened the heartbeat timer starts. This lets us know
  if the connection to the server gets interrupted. The state is reset, 
  and any unacknowledged messages are sent by "syncing" to the server.
*/
 WebSocketClient.prototype.openSocket = function(event) {
  // Determine which session generated the event
  let session = this.sessions.get(this.id);
  console.log(`Opened socket to ${session.url}`, JSON.stringify(event));
  // Set the WS Session id to sessionStorage here
  if($tw.syncadaptor.session && $tw.syncadaptor.session == session.id) {
    window.sessionStorage.setItem("ws-adaptor-session",session.id)
  }
  // Clear the server warning
  if(this.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Socket Warning/${this.id}`)) {
    this.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Socket Warning/${this.id}`);
  }
  // Reset the state object
  session.initState();
  // Start a heartbeat
  this.heartbeat({id: session.id});
  // Sync to the server
  if(this.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Sockets/${this.id}/Unsent`)) {
    this.syncToServer(this.id);
  }

  // get settings here???
  /*
  $tw.Bob.wsClient.getSettings();
  */
}

/*
  The heartbeat process will terminate the socket if it fails. This lets us know when to
  use a reconnect algorithm with exponential back-off and a maximum retry window.
*/
WebSocketClient.prototype.closeSocket = function(event) {
  // Determine which session generated the event
  let session = this.sessions.get(this.id);
  console.log(`Closed socket to ${session.url}`, JSON.stringify(event));
  // Clear the ping timers
  clearTimeout(session.state.pingTimeout);
  clearTimeout(session.state.ping);
  // log the disconnection time & handle the message queue
  session.state.disconnected = Date.now();

  // Error code <= 1000 means that the connection was closed normally.
  if(!event.wasClean && event.code > 1000 && this.settings.reconnect.auto &&
      Date.now() - session.state.reconnecting < this.settings.reconnect.abort) {
    // Display the socket warning after the 3rd reconnect attempt
    if (session.state.attempts > 3) {
      let text = `<div style='width:100%;background-color:red;height:1.5em;max-height:100px;text-align:center;vertical-align:center;color:white;'>''WARNING: You are no longer connected to the websocket ${session.url}. Reconnecting (attempt ${session.state.attempts})...''</div>`;
      const tiddler = {
        title: `$:/plugins/OokTech/Bob/Socket Warning/${this.id}`,
        text: text,
        component: `$tw.Bob.wsClient.sessions[${this.id}]`,
        tags: '$:/tags/Alert'
      };
      this.wiki.addTiddler(new $tw.Tiddler(
        this.wiki.getCreationFields(),
        tiddler,
        this.wiki.getModificationFields()
      ));
    }
    // Reconnect here
    session.state.retryTimeout = setTimeout(function(){
        this.reconnect(session);
      }, session.state.delay);
  } else {
    text = `<div style='width:100%;background-color:red;height:1.5em;max-height:100px;text-align:center;vertical-align:center;color:white;'>''WARNING: You are no longer connected to the websocket ${session.url}.''<$button style='color:black;'>Reconnect ${session.url}<$action-reconnectwebsocket/><$action-navigate $to='$:/plugins/Bob/ConflictList'/></$button></div>`;
    const tiddler = {
      title: `$:/plugins/OokTech/Bob/Socket ${self.index}/Warning`,
      text: text,
      component: `$tw.Bob.wsClient.sessions ${self.index}`,
      tags: '$:/tags/Alert'
    };
    this.wiki.addTiddler(new $tw.Tiddler(
      this.wiki.getCreationFields(),
      tiddler,
      this.wiki.getModificationFields()
    ));
  }
}

/*
  This is a wrapper function, each message from the websocket server has a
  message type and if that message type matches a handler that is defined
  then the data is passed to the handler function.
*/
WebSocketClient.prototype.handleMessage = function(event) {
  try {
    let eventData = JSON.parse(event.data);
    if(eventData.type) {
      if(eventData.type !== "ping" && eventData.type !== "pong") {
        console.log(`Received websocket message ${eventData.id}:`, event.data);
      }
      if(typeof this.messageHandlers[eventData.type] === 'function') {
        // Acknowledge the message, then call handler
        $tw.utils.sendMessageAck(eventData);
        this.messageHandlers[eventData.type](eventData);
      } else {
        console.log('No handler for message of type ', eventData.type);
      }
    }
  } catch (e) {
    console.log("WS handleMessage error:", JSON.stringify(e), JSON.stringify(eventData));
    //throw new Error(e);???
  }
}
 
/*
  If a heartbeat is not received within $tw.Bob.settings.heartbeat.timeout from
  the last heartbeat, terminate the given socket. Setup the next heartbeat.
*/
WebSocketClient.prototype.heartbeat = function(data){
  if (data.clientId) {
    console.log("heartbeat");
    let session = this.sessions.get(data.clientId);
    // clear the ping timers
    clearTimeout(session.state.pingTimeout);
    clearTimeout(session.state.ping);
    // Delay should be equal to the interval at which your server
    // sends out pings plus a conservative assumption of the latency.  
    session.state.pingTimeout = setTimeout(function() {
      // Use `WebSocket#terminate()`, which immediately destroys the connection,
      // instead of `WebSocket#close()`, which waits for the close timer.
      session.socket.terminate();
    }, this.settings.heartbeat.timeout + this.settings.heartbeat.interval);
    // Send the next heartbeat ping after $tw.Bob.settings.heartbeat.interval ms
    session.state.ping = setTimeout(function() {
      session.socket.send(JSON.stringify({
        type: 'ping',
        id: 'heartbeat',
        clientId: data.clientId,
        serverId: data.serverId,
        wiki: $tw.wikiName
      }));
    }, this.settings.heartbeat.interval);
  }
}

/*
  Send a message to the server id
*/
WebSocketClient.prototype.send = function(message) {
  let response = JSON.stringify(message);
  let session = this.sessions.get(message.clientId)
  if(session.socket.readyState === WebSocket.OPEN) {
    session.socket.send(response);
  } else {
    // Message Queue logic here?
  }
}

/*
  Send a message to the server id
*/
WebSocketClient.prototype.sendToServer = function(connectionIndex,message,callback) {
  connectionIndex = connectionIndex || 0;
  let messageData = {};
  // If the connection is open, send the message
  if($tw.Bob.sessions[connectionIndex].socket.readyState === 1 && $tw.readOnly !== 'yes') {
    messageData = $tw.utils.sendMessage(message, 0);
  } else {
    // If the connection is not open than store the message in the queue
    const tiddler = this.wiki.getTiddler(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`);
    let queue = [];
    let start = Date.now();
    if(tiddler) {
      if(typeof tiddler.fields.text === 'string') {
        queue = JSON.parse(tiddler.fields.text);
      }
      if(tiddler.fields.start) {
        start = tiddler.fields.start;
      }
    }
    // Check to make sure that the current message is eligible to be saved
    messageData = $tw.utils.createMessageData(message)
    if($tw.utils.messageIsEligible(messageData, 0, queue)) {
      // Prune the queue and check if the current message makes any enqueued
      // messages redundant or overrides old messages
      queue = $tw.utils.removeRedundantMessages(messageData, queue);
      // Don't save any messages that are about the unsent list or you get
      // infinite loops of badness.
      if(messageData.title !== `$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`) {
        queue.push(messageData);
      }
      const tiddler2 = {
        title: `$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`,
        text: JSON.stringify(queue, '', 2),
        type: 'application/json',
        start: start
      };
      this.wiki.addTiddler(new $tw.Tiddler(
        this.wiki.getCreationFields(),
        tiddler2,
        this.wiki.getModificationFields()
      ));
    }
  }
  if(messageData.id) {
    if(typeof callback === "function") {
      callback(null, messageData.id)
    } else {
      return messageData.id;
    }
  } else {
    if(typeof callback === "function") {
      callback(new Error("BroswerWSAdaptor Error - sendToServer failed to generate messageData.id."))
    } else {
      return null;
    }
  }
}
  
WebSocketClient.prototype.syncToServer = function(connectionIndex) {
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
  const tiddler = this.wiki.getTiddler(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`);
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
  //this.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`);
}
  
WebSocketClient.prototype.getSettings = function() {
  // Ask the server for its status
  fetch('/api/status', {credentials: 'include', headers: {'x-wiki-name': $tw.wikiName}})
  .then(response => response.json())
  .then(function(data) {
    function doThisLevel (inputObject, currentName) {
      let currentLevel = {};
      Object.keys(inputObject).forEach( function(property) {
        if(typeof inputObject[property] === 'object') {
          // Call recursive function to walk through properties, but only if
          // there are properties
          if(Object.keys(inputObject[property])) {
            doThisLevel(inputObject[property], currentName + '/' + property, data);
            currentLevel[property] = currentName + '/' + property;
          }
        } else {
          // Add it to this one.
          currentLevel[property] = inputObject[property];
        }
      });
      const tiddlerFields = {
        title: currentName,
        text: JSON.stringify(currentLevel, "", 2),
        type: 'application/json'
      };
      this.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
    }

    const fields = {};

    const viewableWikiList = Object.keys(data['available_wikis']).filter(function(wikiName) {
      return data['available_wikis'][wikiName].indexOf('view') > -1
    })
    const editableWikiList = Object.keys(data['available_wikis']).filter(function(wikiName) {
      return data['available_wikis'][wikiName].indexOf('edit') > -1
    })
    // Set available wikis
    fields.title = '$:/state/ViewableWikis';
    fields.list = $tw.utils.stringifyList(viewableWikiList);
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));

    // Set available wikis
    fields.title = '$:/state/EditableWikis';
    fields.list = $tw.utils.stringifyList(editableWikiList);
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));

    const editions_out = {}
    Object.keys(data['available_editions']).map(function(curr, ind) {
      editions_out[curr] = data['available_editions'][curr]['description'];
    })
    fields.list = '';
    // Set available editions
    fields.title = '$:/Bob/AvailableEditionList';
    fields.text = JSON.stringify(editions_out, "", 2);
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));

    // Set available languages
    fields.title = '$:/Bob/AvailableLanguageList';
    fields.text = JSON.stringify(Object.keys(data['available_languages']));
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));

    const plugins_out = {}
    Object.keys(data['available_plugins']).map(function(curr, ind) {
      plugins_out[curr] = data['available_plugins'][curr]['description'];
    })
    // Set available plugins
    fields.title = '$:/Bob/AvailablePluginList';
    fields.text = JSON.stringify(plugins_out, "", 2);
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));

    const themes_out = {}
    Object.keys(data['available_themes']).map(function(curr, ind) {
      themes_out[curr] = data['available_themes'][curr]['description'];
    })
    // Set available themes
    fields.title = '$:/Bob/AvailableThemeList';
    fields.text = JSON.stringify(themes_out, "", 2);
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));

    // Save settings for the wiki
    fields.title = '$:/WikiSettings';
    fields.text = JSON.stringify(data['settings'], "", 2);
    fields.type = 'application/json';
    this.wiki.addTiddler(new $tw.Tiddler(fields));
    $tw.Bob.settings = data['settings']

    doThisLevel(data['settings'], '$:/WikiSettings/split');

    this.wiki.addTiddler(new $tw.Tiddler({title:'$:/ServerIP', text: (data.settings.serverInfo ? data.settings.serverInfo.ipAddress : window.location.protocol + '//' + window.location.hostname), port: window.location.port, host: data.settings['ws-server'].host, proxyprefix: data.settings.proxyprefix}))

    this.wiki.addTiddler(new $tw.Tiddler({title:'$:/status/IsLoggedIn', text:data.logged_in}));

    this.wiki.addTiddler(new $tw.Tiddler({title:'$:/status/IsReadOnly', text:data.read_only}));
    $tw.readOnly = data.read_only;

    // Delete any info about owned wikis, this is here to clear the list if
    // you log out
    this.wiki.filterTiddlers('[prefix[$:/Bob/OwnedWikis]]').forEach(function(tidName) {
      this.wiki.deleteTiddler(tidName);
    })
    if(data.owned_wikis) {
      // save any info about owned wikis for the currently logged in person
      Object.keys(data.owned_wikis).forEach(function(wikiName) {
        const tidFields = {
          title: "$:/Bob/OwnedWikis/" + wikiName,
          visibility: data.owned_wikis[wikiName].visibility,
          editors: $tw.utils.stringifyList(data.owned_wikis[wikiName].editors),
          viewers: $tw.utils.stringifyList(data.owned_wikis[wikiName].viewers),
          fetchers: $tw.utils.stringifyList(data.owned_wikis[wikiName].fetchers),
          pushers: $tw.utils.stringifyList(data.owned_wikis[wikiName].pushers),
          guest_access: $tw.utils.stringifyList(data.owned_wikis[wikiName].access ? data.owned_wikis[wikiName].access.Guest : ''),
          normal_access: $tw.utils.stringifyList(data.owned_wikis[wikiName].access ? data.owned_wikis[wikiName].access.Normal : ''),
          admin_access: $tw.utils.stringifyList(data.owned_wikis[wikiName].access ? data.owned_wikis[wikiName].access.Admin : ''),
          wiki_name: wikiName,
          text: "{{||$:/plugins/OokTech/Bob/Templates/WikiAccessManager}}",
          tags: "$:/Bob/OwnedWikis"
        }
        this.wiki.addTiddler(new $tw.Tiddler(tidFields));
      });
    }
    // Delete any listing for visible profiles, this makes sure they aren't
    // left when you log out.
    this.wiki.filterTiddlers('[prefix[$:/status/VisibleProfile/]]').forEach(function(tidName) {
      this.wiki.deleteTiddler(tidName);
    })
    if(data.visible_profiles) {
      Object.keys(data.visible_profiles).forEach(function(profileName) {
        const tidFields = {
          title: '$:/status/VisibleProfile/' + profileName,
          visibility: data.visible_profiles[profileName].visibility,
          text: this.wiki.renderText('text/html', "text/vnd.tiddlywiki", data.visible_profiles[profileName].about),
          level: data.visible_profiles[profileName].level
        };
        this.wiki.addTiddler(new $tw.Tiddler(tidFields));
      })
    }
    if(data.username) {
      data.visible_profiles = data.visible_profiles || {};
      data.visible_profiles[data.username] = data.visible_profiles[data.username] || {};
      // This is only here with the secure server, add username and profile
      // info
      this.wiki.addTiddler(new $tw.Tiddler({title: '$:/status/UserName', text: data.username, visibility: data.visible_profiles[data.username].visibility, level: data.visible_profiles[data.username].level}));
      this.wiki.addTiddler(new $tw.Tiddler({title: '$:/status/UserName/About', text: data.visible_profiles[data.username].about}));
    } else if(data['settings'].persistentUsernames === "yes") {
      // In non-secure version load the username from
      const savedName = $tw.utils.getCookie(document.cookie, "userName");
      if(savedName) {
        this.wiki.addTiddler(new $tw.Tiddler({title: "$:/status/UserName", text: savedName}));
        this.wiki.deleteTiddler('$:/status/UserName/About');
      }
    } else {
      this.wiki.deleteTiddler('$:/status/UserName/About');
    }
  });
}

exports.WebSocketClient = WebSocketClient;

})();