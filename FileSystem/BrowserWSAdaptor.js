/*\
title: $:/plugins/OokTech/Bob/BrowserWSAdaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor for syncing changes using websockets with Bob

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Import shared commands
$tw.Bob.Shared = require('$:/plugins/OokTech/Bob/SharedFunctions.js');

$tw.Bob.init = function() {
  // Ensure that the needed objects exist
  $tw.Bob = $tw.Bob || {};
  $tw.Bob.ExcludeFilter = this.wiki.getTiddlerText('$:/plugins/OokTech/Bob/ExcludeSync');  
  $tw.browserMessageHandlers = $tw.browserMessageHandlers || {};
  $tw.connections = $tw.connections || [];
  $tw.settings = $tw.settings || {};
  $tw.settings.heartbeat = $tw.settings.heartbeat || {
    "interval":1000, // default 1 sec heartbeats
    "timeout":5000 // default 5 second heartbeat timeout
  };
  $tw.settings.reconnect = $tw.settings.reconnect || {
    "auto": true,
    "initial": 100, // small initial increment
    "decay": 1.5, // exponential decay d^n (number-of-retries)
    "max": 10000, // maximum retry increment
    "abort": 60000 // failure after this long
  }
  // Get the name for this wiki for websocket messages
  $tw.wikiName = $tw.wikiName || this.wiki.getTiddlerText("$:/WikiName", "");
  
  // Define the methods
  $tw.Bob.Connect = function(connectionIndex, url) {
    if(!connectionIndex || !url) {
      console.error(`$tw.Bob.Connect error: connectionIndex=${connectionIndex} url=${url}`)
      return false;
    }
    // Setup the connection
    $tw.connections[connectionIndex] = $tw.connections[connectionIndex] || {};
    $tw.connections[connectionIndex].index = connectionIndex;
    $tw.connections[connectionIndex].url = url;
    $tw.connections[connectionIndex].wiki = $tw.wikiName;
    $tw.connections[connectionIndex].disconnected = $tw.connections[connectionIndex].disconnected || null;
    $tw.connections[connectionIndex].reconnect = $tw.connections[connectionIndex].reconnect || 
      {count: 0 , start: null, delay: $tw.settings.reconnect.initial, timeout: null};
    // Create the socket
    try{
      $tw.connections[connectionIndex].socket = new WebSocket($tw.connections[connectionIndex].url);
      $tw.connections[connectionIndex].socket.onopen = this.openSocket;
      $tw.connections[connectionIndex].socket.onclose = this.closeSocket;
      $tw.connections[connectionIndex].socket.onmessage = this.handleMessage;
      $tw.connections[connectionIndex].socket.binaryType = "arraybuffer";
    } catch (e) {
      //console.error(e)
      throw new Error(e);
    }
  }

  $tw.Bob.Reconnect = function(connectionIndex) {
    sync = !!sync || false;
    // Clear the socket
    $tw.connections[connectionIndex].socket = null;
    // Timestamp the start time
    if(!$tw.connections[connectionIndex].reconnect.start){
      $tw.connections[connectionIndex].reconnect.start = new Date();
    }
    // Log the attempt
    $tw.connections[connectionIndex].reconnect.count++;
    // Calculate the next exponential backoff delay
    let delay = (Math.random()+1) * $tw.settings.reconnect.initial * Math.pow($tw.connections[connectionIndex].reconnect.decay, $tw.connections[connectionIndex].reconnect.count);
    // Use delay or the $tw.settings.reconnect.max value
    $tw.connections[connectionIndex].reconnect.delay = Math.min(delay, $tw.settings.reconnect.max);
    // Recreate the socket
    $tw.Bob.Connect(connectionIndex, $tw.connections[connectionIndex].url);
  }

  /*
    When the socket is opened the heartbeat process starts. This lets us know
    if the connection to the server gets interrupted.
  */
  $tw.Bob.openSocket = function(event) {
    // Determine which connection generated the event
    let self = this;
    let connectionIndex = $tw.connections.findIndex(function(connection) {return connection.socket === self;});  
    console.log(`Opened socket ${connectionIndex} to ${$tw.connections[connectionIndex].url}`, JSON.stringify(event));
    // Clear the reconnect object
    $tw.connections[connectionIndex].reconnect = null;
    // Start a heartbeat
    let ping = {
        type: 'ping',
        id: 'heartbeat',
        token: $tw.Bob.Shared.getMessageToken(),
        wiki: $tw.wikiName
      };
    $tw.connections[connectionIndex].socket.send(JSON.stringify(ping));
    // Clear the server warning
    if(this.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Warning`)) {
      this.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Warning`);
    }
    // Sync to the server
    if(this.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`)) {
      $tw.Bob.syncToServer(connectionIndex);
    }

    //login here???
    /*
    // Login with whatever credentials you have
    const login = {
      type: 'setLoggedIn',
      wiki: $tw.wikiName
    };
    $tw.Bob.sendToServer(login);
    $tw.Bob.getSettings();
    */
  }

  /*
    The heartbeat process will terminate the socket if it fails. This lets us know when to
    use a reconnect algorithm with exponential back-off and a maximum retry window.
  */
  $tw.Bob.closeSocket = function(event) {
    // Determine which connection generated the event
    let self = this;
    let connectionIndex = $tw.connections.findIndex(function(connection) {return connection.socket === self;});
    console.log(`Closed socket ${connectionIndex} to ${$tw.connections[connectionIndex].url}`, JSON.stringify(event));
    // log the disconnection time
    $tw.connections[connectionIndex].disconnected = Date.now();
    // clear the ping timers
    clearTimeout($tw.connections[connectionIndex].pingTimeout);
    clearTimeout($tw.connections[connectionIndex].ping);
    // Error code 1000 means that the connection was closed normally.
    if(event.code != 1000 && $tw.settings.reconnect.auto &&
        Date.now() - $tw.connections[connectionIndex].reconnect.start < $tw.settings.reconnect.abort) {
      // Reconnect here
      $tw.connections[connectionIndex].reconnect.timeout = setTimeout(function(){
          $tw.Bob.Reconnect(connectionIndex);
          let text = `<div style='width:100%;background-color:red;height:1.5em;max-height:100px;text-align:center;vertical-align:center;color:white;'>''WARNING: You are no longer connected to the server on socket ${connectionIndex}. Reconnecting (attempt ${$tw.connections[connectionIndex].reconnect.count})...''</div>`;
          const tiddler = {
            title: `$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Warning`,
            text: text,
            component: `$tw.connections[${connectionIndex}]`,
            tags: '$:/tags/Alert'
          };
          this.wiki.addTiddler(new $tw.Tiddler(
            this.wiki.getCreationFields(),
            tiddler,
            this.wiki.getModificationFields()
          ));
        }, 
        $tw.connections[connectionIndex].reconnect.delay
      );
    } else {
      text = `<div style='width:100%;background-color:red;height:1.5em;max-height:100px;text-align:center;vertical-align:center;color:white;'>''WARNING: You are no longer connected to the server on socket ${connectionIndex}.''<$button style='color:black;'>Reconnect<$action-reconnectwebsocket/><$action-navigate $to='$:/plugins/Bob/ConflictList'/></$button></div>`;
      const tiddler = {
        title: `$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Warning`,
        text: text,
        component: `$tw.connections[${connectionIndex}]`,
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
  $tw.Bob.handleMessage = function(event) {
    // Determine which connection generated the event
    let self = this;
    let connectionIndex = $tw.connections.findIndex(function(connection) {return connection.socket === self;});
    try {
      let eventData = JSON.parse(event.data);
      // Add the source to the eventData object so it can be used later.
      eventData.source_connection = connectionIndex;
      if(eventData.type) {
        if(eventData.type !== "ping" && eventData.type !== "pong") {
          console.log(`Received websocket message ${eventData.id}:`, event.data);
        }
        if(typeof $tw.browserMessageHandlers[eventData.type] === 'function') {
          // Acknowledge the message, then call handler
          $tw.Bob.Shared.sendAck(eventData);
          $tw.browserMessageHandlers[eventData.type](eventData);
          //debugger;
          this.handledMessages = this.handledMessages || {};
          if(!this.handledMessages[eventData.id]) this.handledMessages[eventData.id] = 0;
          this.handledMessages[eventData.id] = this.handledMessages[eventData.id]++;
        } else {
          console.log('No handler for message of type ', eventData.type);
        }
      }
    } catch (e) {
      console.log("WS handleMessage error:", JSON.stringify(e), JSON.stringify(eventData));
      //throw new Error(e);???
    }
  }

  /* REQUIRED MESSAGE HANDLER
    This handles a ping from the server. The server and browser make sure they
    are connected by sending pings periodically. Pings from servers are not
    used in the heartbeat. The pong response echos back whatever was sent.
  */
  $tw.browserMessageHandlers.ping = function(data) {
    let message = {};
    Object.keys(data).forEach(function(key) {
      message[key] = data[key];
    })
    message.type = 'pong';
    message.token = $tw.Bob.Shared.getMessageToken();;
    message.wiki = $tw.wikiName;
    let response = JSON.stringify(message);
    // Send the response
    $tw.connections[data.source_connection].socket.send(response);
  }

  /* REQUIRED MESSAGE HANDLER
    This handles the pong response of a client ping. It is used as the heartbeat
    to ensure that the connection to the server is still live.
  */
  $tw.browserMessageHandlers.pong = function(data) {
    // If this pong is part of a heartbeat then send another heartbeat
    if(data.id == "heartbeat") {
      $tw.Bob.heartbeat(data);
    }
  }

  /*
    If a heartbeat is not received within $tw.settings.heartbeat.timeout from
    the last heartbeat, terminate the given socket. Setup the next heartbeat.
  */
  $tw.Bob.heartbeat = function(data){
    let connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
    if (connectionIndex) {
      // clear the ping timers
      clearTimeout($tw.connections[connectionIndex].pingTimeout);
      clearTimeout($tw.connections[connectionIndex].ping);
      // Delay should be equal to the interval at which your server
      // sends out pings plus a conservative assumption of the latency.  
      $tw.connections[connectionIndex].pingTimeout = setTimeout(function() {
        // Use `WebSocket#terminate()`, which immediately destroys the connection,
        // instead of `WebSocket#close()`, which waits for the close timer.
        $tw.connections[connectionIndex].socket.terminate();
      }, $tw.settings.heartbeat.timeout + $tw.settings.heartbeat.interval);
      // Send the next heartbeat ping after $tw.settings.heartbeat.interval ms
      $tw.connections[connectionIndex].ping = setTimeout(function() {
        let token = $tw.Bob.Shared.getMessageToken();//localStorage.getItem('ws-token')
        $tw.connections[connectionIndex].socket.send(JSON.stringify({
          type: 'ping',
          id: 'heartbeat',
          token: token,
          wiki: $tw.wikiName
        }));
      }, $tw.settings.heartbeat.interval);
    }
  }

  $tw.Bob.sendToServer = function(message, callback) {
    const connectionIndex = 0;
    let messageData = {};
    // If the connection is open, send the message
    if($tw.connections[connectionIndex].socket.readyState === 1 && $tw.readOnly !== 'yes') {
      messageData = $tw.Bob.Shared.sendMessage(message, 0);
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
      messageData = $tw.Bob.Shared.createMessageData(message)
      if($tw.Bob.Shared.messageIsEligible(messageData, 0, queue)) {
        // Prune the queue and check if the current message makes any enqueued
        // messages redundant or overrides old messages
        queue = $tw.Bob.Shared.removeRedundantMessages(messageData, queue);
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

  $tw.Bob.syncToServer = function(connectionIndex) {
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
        tiddlerHashes[tidTitle] = $tw.Bob.Shared.getTiddlerHash(tid);
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
    $tw.Bob.sendToServer(message);
    //this.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Socket ${connectionIndex}/Unsent`);
  }

  /*
    This adds actions for the different event hooks. Each hook sends a
    message to the node process.

    Some unused hooks have commented out skeletons for adding those hooks in
    the future if they are needed.
  */
  $tw.Bob.addHooks = function() {
    if(!$tw.wikiName) {
      $tw.wikiName = '';
    }
    $tw.hooks.addHook("th-editing-tiddler", function(event) {
      // Special handling for unedited shadow tiddlers
      if(this.wiki.isShadowTiddler(event.tiddlerTitle) && !this.wiki.tiddlerExists(event.tiddlerTitle)) {
        // Wait for the document to have focus again and then check for the existence of a draft tiddler for the shadow, if one doesn't exist cancel the edit lock
        setTimeout(function(tid) {
          if(document.hasFocus()) {
            if(!this.wiki.findDraft(tid)) {
              // Cancel the edit lock
              const message = {
                type: 'cancelEditingTiddler',
                tiddler:{
                  fields:{
                    title: tid
                  }
                },
                wiki: $tw.wikiName
              };
              $tw.Bob.sendToServer(message);
            }
          }
        }, 200, event.tiddlerTitle)
      }
      const message = {
        type: 'editingTiddler',
        tiddler: {
          fields: {
            title: event.tiddlerTitle
          }
        },
        wiki: $tw.wikiName
      };
      $tw.Bob.sendToServer(message);
      // do the normal editing actions for the event
      return true;
    });
    $tw.hooks.addHook("th-cancelling-tiddler", function(event) {
      const draftTitle = event.param || event.tiddlerTitle;
      const draftTiddler = this.wiki.getTiddler(draftTitle);
      const originalTitle = draftTiddler && draftTiddler.fields["draft.of"];
      const message = {
        type: 'cancelEditingTiddler',
        tiddler:{
          fields:{
            title: originalTitle
          }
        },
        wiki: $tw.wikiName
      };
      $tw.Bob.sendToServer(message);
      // Do the normal handling
      return event;
    });
    /*
      Below here are skeletons for adding new actions to existing hooks.
      None are needed right now but the skeletons may help later.

      Other available hooks are:
      th-importing-tiddler
      th-relinking-tiddler
      th-renaming-tiddler
    */
    /*
      This handles the hook for importing tiddlers.
    */
    $tw.hooks.addHook("th-importing-tiddler", function(tiddler) {
      if(this.wiki.getTextReference('$:/WikiSettings/split##saveMediaOnServer') !== 'no' && this.wiki.getTextReference('$:/WikiSettings/split##enableFileServer') === 'yes') {
        function updateProgress(e) {
          try {
            // TODO make this work in different browsers
            if(e.lengthComputable) {
              var percentComplete = e.loaded/e.total*100;
            } else {
              var percentComplete = -1;
            }
            console.log(percentComplete);
          } catch (e) {
            console.log("No progress updates!")
          }
        }
        function transferComplete(e) {
          console.log('Complete!!');
        }
        function transferFailed(e) {
          console.log('Failed!');
        }
        function transferCanceled(e) {
          console.log('Cancelled!')
        }
        // Figure out if the thing being imported is something that should be
        // saved on the server.
        //const mimeMap = $tw.settings.mimeMap || {
        const mimeMap = $tw.settings.mimeMap || {
          '.aac': 'audio/aac',
          '.avi': 'video/x-msvideo',
          '.csv': 'text/csv',
          '.doc': 'application/msword',
          '.epub': 'application/epub+zip',
          '.gif': 'image/gif',
          '.html': 'text/html',
          '.htm': 'text/html',
          '.ico': 'image/x-icon',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.mp3': 'audio/mpeg',
          '.mpeg': 'video/mpeg',
          '.oga': 'audio/ogg',
          '.ogv': 'video/ogg',
          '.ogx': 'application/ogg',
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.weba': 'audio/weba',
          '.webm': 'video/webm',
          '.wav': 'audio/wav'
        };
        if(Object.values(mimeMap).indexOf(tiddler.fields.type) !== -1 && !tiddler.fields._canonical_uri) {
          // Check if this is set up to use HTTP post or websockets to save the
          // image on the server.
          const request = new XMLHttpRequest();
          request.upload.addEventListener('progress', updateProgress);
          request.upload.addEventListener('load', transferComplete);
          request.upload.addEventListener('error', transferFailed);
          request.upload.addEventListener('abort', transferCanceled);

          let wikiPrefix = this.wiki.getTiddlerText('$:/WikiName') || '';
          const uploadURL = '/api/upload';
          request.open('POST', uploadURL, true);
          // cookies are sent with the request so the authentication cookie
          // should be there if there is one.
          const thing = {
            tiddler: tiddler,
            wiki: this.wiki.getTiddlerText('$:/WikiName')
          }
          request.setRequestHeader('x-wiki-name',wikiPrefix);
          request.onreadystatechange = function() {
            if(request.readyState === XMLHttpRequest.DONE) {
              if(request.status === 200) {
                // Things should be ok
                // The server should send a browser message saying that the
                // upload was successful.
              } else {
                // There is a problem
                // Make a tiddler that has the tag $:/tags/Alert that has the text of
                // the alert.
                const fields = {
                  component: 'Server Message',
                  title: "Upload Error",
                  text: "File failed to upload to server with status code " + request.status + ". Try quitting and restarting Bob."+"<br/><$button>Clear Alerts<$action-deletetiddler $filter='[tag[$:/tags/Alert]component[Server Message]]'/></$button>",
                  tags: '$:/tags/Alert'
                }
                this.wiki.addTiddler(new $tw.Tiddler(
                  this.wiki.getCreationFields(),
                  fields,
                  this.wiki.getModificationFields()
                ));
              }
            }
          }
          request.send(JSON.stringify(thing));
          // Change the tiddler fields and stuff
          const fields = {};
          wikiPrefix = this.wiki.getTiddlerText('$:/WikiName') || '';
          wikiPrefix = wikiPrefix === '' ? '' : '/' + wikiPrefix;
          $tw.settings.fileURLPrefix = $tw.settings.fileURLPrefix || 'files';
          const uri = wikiPrefix + '/' + $tw.settings.fileURLPrefix + '/' + tiddler.fields.title;
          fields.title = tiddler.fields.title;
          fields.type = tiddler.fields.type;
          fields._canonical_uri = uri;
          return new $tw.Tiddler(fields);
        } else {
          return tiddler;
        }
      } else {
        return tiddler;
      }
    });
  }

  $tw.Bob.getSettings = function() {
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
      $tw.settings = data['settings']

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
        const savedName = $tw.Bob.getCookie(document.cookie, "userName");
        if(savedName) {
          this.wiki.addTiddler(new $tw.Tiddler({title: "$:/status/UserName", text: savedName}));
          this.wiki.deleteTiddler('$:/status/UserName/About');
        }
      } else {
        this.wiki.deleteTiddler('$:/status/UserName/About');
      }
    });
  }
}

function BrowserWSAdaptor(options) {
  this.wiki = options.wiki;
  this.idList = [];
  // In the browser there is only one connection, so set the connection index & url
  this.connectionIndex = 0;
  const WSDomain = window.location.hostname;
  const WSSPort = window.location.port;
  const regxName = new RegExp("\\/"+ $tw.wikiName + "\\/?$");
  const WSPath = decodeURI(window.location.pathname).replace(regxName,'');
  this.url = "wss://" + WSDomain +":" + WSSPort + WSPath;
  // Do all actions on startup.
  $tw.Bob.init();
  $tw.Bob.Connect(this.connectionIndex, this.url);
  $tw.Bob.addHooks();
}

// Syncadaptor properties

// REQUIRED
// The name of the syncadaptor
BrowserWSAdaptor.prototype.name = "browserwsadaptor";

BrowserWSAdaptor.prototype.supportsLazyLoading = true;

/*
  Get the current status of the Bob WS conection (called by the syncer)
*/
BrowserWSAdaptor.prototype.getStatus = function(callback) {
  console.log('Getting status');

  //callback(null,isLoggedIn,json.username,isReadOnly,isAnonymous,isPollingDisabled);
}


// REQUIRED
// Tiddler info, can be left like this but must be present
BrowserWSAdaptor.prototype.getTiddlerInfo = function(tiddler, options) {
  /* Bag stuff here?
  options = options || {};
  return {
		bag: tiddler.fields.bag
  };
  */
  return {};
}

// REQUIRED
// This does whatever is necessary to actually store a tiddler
BrowserWSAdaptor.prototype.saveTiddler = function(tiddler, options, callback) {
  // Starting with 5.1.24, all syncadptor method signatures follow the node.js
	// standard of callback as last argument. This catches the previous signature:
  options = options || {};
  if(!!callback && typeof callback !== "function"){
    var optionsArg = callback;
  }
  if(typeof options === "function"){
    callback = options;
    options = optionsArg || {};
  }
  if(!tiddler || !tiddler.fields.title){
    callback(new Error("No tiddler or title given."));
  } else {
    let adaptorInfo = options.tiddlerInfo.adaptorInfo || this.getTiddlerInfo({fields: {title: title}}) || {};
    if(!this.shouldSync(tiddler.fields.title)) {
      callback(null, adaptorInfo);
    }
    //Keeping track of "bags" and things would go here?
    let tempTid = {fields:{}};
    Object.keys(tiddler.fields).forEach(function(field) {
        if(field !== 'created' && field !== 'modified') {
          tempTid.fields[field] = tiddler.fields[field];
        } else {
          tempTid.fields[field] = $tw.utils.stringifyDate(tiddler.fields[field]);
        }
      }
    );
    const message = {
      type: 'saveTiddler',
      tiddler: tempTid,
      wiki: $tw.wikiName,
      changeCount: options.changeCount,
      tiddlerInfo: options.tiddlerInfo
    };
    $tw.Bob.sendToServer(message, function(err, id){
      if(err){
        callback(err);
      }
      adaptorInfo.lastMessageId = id;
      callback(null, adaptorInfo);
    });
  }
}

// REQUIRED
// This does whatever is necessary to load a tiddler.
// Used for lazy loading
BrowserWSAdaptor.prototype.loadTiddler = function(title, options, callback) {
  // Starting with 5.1.24, all syncadptor method signatures follow the node.js
	// standard of callback as last argument. This catches the previous signature:
  options = options || {};
  if(!!callback && typeof callback !== "function"){
    var optionsArg = callback;
  }
  if(typeof options === "function"){
    callback = options;
    options = optionsArg || {};
  }
  let adaptorInfo = options.tiddlerInfo.adaptorInfo || this.getTiddlerInfo({fields: {title: title}}) || {};
  //Keeping track of "bags" and things would go here?
  //Why prevent loading of system tiddlers?
  if(title.slice(0,3) === '$:/') {
    callback(null, null, adaptorInfo);
  } else {
    const message = {
      type:'getFullTiddler',
      title: title,
      wiki: $tw.wikiName,
      changeCount: options.changeCount,
      tiddlerInfo: options.tiddlerInfo
    }
    $tw.Bob.sendToServer(message, function(err, id){
      if(err){
        callback(err);
      }
      adaptorInfo.lastMessageId = id;
      callback(null, null, adaptorInfo);
    });
  }
}

// REQUIRED
// This does whatever is necessary to delete a tiddler
BrowserWSAdaptor.prototype.deleteTiddler = function(title, options, callback) {
  // Starting with 5.1.24, all syncadptor method signatures follow the node.js
	// standard of callback as last argument. This catches the previous signature:
  options = options || {};
  if(!!callback && typeof callback !== "function"){
    var optionsArg = callback;
  }
  if(typeof options === "function"){
    callback = options;
    options = optionsArg || {};
  }
  let adaptorInfo = options.tiddlerInfo.adaptorInfo || this.getTiddlerInfo({fields: {title: title}}) || {};
  //Keeping track of "bags" and things would go here?
  if(!this.shouldSync(title)) {
    callback(null, adaptorInfo);
  } else {
    // We have an additional check for tiddlers that start with
    // $:/state because popups get deleted before the check is done.
    // Without this than every time there is a popup the dirty
    // indicator turns on
    const message = {
      type: 'deleteTiddler',
      tiddler:{
        fields:{
          title:title
        }
      },
      wiki: $tw.wikiName,
      changeCount: options.changeCount,
      tiddlerInfo: options.tiddlerInfo
    };
    $tw.Bob.sendToServer(message, function(err, id){
      if(err){
        callback(err);
      }
      adaptorInfo.lastMessageId = id;
      callback(null, adaptorInfo);
    });
  }
}

BrowserWSAdaptor.prototype.shouldSync = function(tiddlerTitle) {
  // assume that we are never syncing state and temp tiddlers.
  // This may change later.
  if(tiddlerTitle.startsWith('$:/state/') || tiddlerTitle.startsWith('$:/temp/')) {
    return false;
  }
  // If the changed tiddler is the one that holds the exclude filter
  // than update the exclude filter.
  if(tiddlerTitle === '$:/plugins/OokTech/Bob/ExcludeSync') {
    $tw.Bob.ExcludeFilter = this.wiki.getTiddlerText('$:/plugins/OokTech/Bob/ExcludeSync');
  }
  const list = this.wiki.filterTiddlers($tw.Bob.ExcludeFilter);
  if(list.indexOf(tiddlerTitle) === -1) {
    return true;
  } else {
    return false;
  }
}

/*
BrowserWSAdaptor.prototype.getUpdatedTiddlers = function() {

}
*/

// OPTIONAL
// Returns true if the syncer` is ready, otherwise false
// This can be updated at any time, it gets checked when a syncing task is
// being run so its value can change over time.
BrowserWSAdaptor.prototype.isReady = function() {
  let readyState = (!!$tw.browserMessageHandlers
    && this.connectionIndex == $tw.connections[this.connectionIndex].index
    && $tw.connections[this.connectionIndex].socket.readyState == WebSocket.OPEN);
  return readyState;
  const tid = this.wiki.getTiddler('$:/state/EditableWikis');
  if(tid){
    if(tid.fields.list.indexOf($tw.wikiName) > -1) {
      return true;
    }
  } else {
    return false;
  }
}
/*
// OPTIONAL
// This checks the login state
// it can be used to give an async way to check the status and update the
// isReady state. The tiddlyweb adaptor does this.
BrowserWSAdaptor.prototype.getStatus = function(callback) {

}*/

// OPTIONAL
// A login thing, need specifics
BrowserWSAdaptor.prototype.login = function(username, password, callback) {
debugger;
}

// OPTIONAL
// A logout thing, need specifics
BrowserWSAdaptor.prototype.logout = function(callback) {
debugger;
}


// OPTIONAL
/*
// Loads skinny tiddlers, need specifics
let thisTimerTemp = undefined
function setupSkinnyTiddlerLoading() {
  if(!this.wiki.getTiddler('$:/WikiSettings/split/ws-server')) {
    clearTimeout(thisTimerTemp)
    thisTimerTemp = setTimeout(function() {
      setupSkinnyTiddlerLoading()
    }, 100)
  } else {
    clearTimeout(thisTimerTemp)
    if(this.wiki.getTiddlerDataCached('$:/WikiSettings/split/ws-server').rootTiddler === '$:/core/save/lazy-all') {
      BrowserWSAdaptor.prototype.getSkinnyTiddlers = function(callback) {
        function handleSkinnyTiddlers(e) {
          callback(null, e)
        }
        function sendThing() {
          function setSendThingTimeout() {
            setTimeout(function() {
              if($tw.connections) {
                if($tw.connections[0].socket.readyState === 1) {
                  id = $tw.Bob.sendToServer(message)
                  $tw.rootWidget.addEventListener('skinny-tiddlers', function(e) {
                    handleSkinnyTiddlers(e.detail)
                  })
                } else {
                  setSendThingTimeout()
                }
              } else {
                setSendThingTimeout()
              }
            }, 100)
          }
          if($tw.connections) {
            if($tw.connections[0].socket.readyState === 1) {
              id = $tw.Bob.sendToServer(message)
              $tw.rootWidget.addEventListener('skinny-tiddlers', function(e) {
                handleSkinnyTiddlers(e.detail)
              })
            } else {
              setSendThingTimeout()
            }
          } else {
            setSendThingTimeout()
          }
        }
        const message = {
          type: 'getSkinnyTiddlers',
          wiki: $tw.wikiName
        }
        let id
        sendThing()
      }
      $tw.syncer.syncFromServer()
    }
  }
}*/

// Only set up the websockets if we aren't in an iframe or opened as a file.
if($tw.browser && window.location === window.parent.location && window.location.hostname) {
  //setupSkinnyTiddlerLoading()
  exports.adaptorClass = BrowserWSAdaptor
}

})();
