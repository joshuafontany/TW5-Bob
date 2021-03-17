/*\
title: $:/plugins/OokTech/Bob/ClientMessageHandlers.js
type: application/javascript
module-type: client-messagehandlers

This handles messages sent to the wsClient (mostly in the browser).

These are message handlers for messages sent to the client. If you want to
add more functions the easiest way is to use this file as a template and make a
new file that adds the files you want. To do this you need should copy
everything until the line

exports.synchronous = true;

Remember that the file has to end with

})();

to close the function that wraps the contents.
Also change the title of the tiddler in the second line of the file, otherwise
it will overwrite this file.
\*/
(function() {

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";

  /* REQUIRED
    When the handshake is confirmed the heartbeat timer starts. This tells us
    if the connection to the server gets interrupted. The state is reset, 
    and any unacknowledged messages are sent by "syncing" to the server.
    This message handler updates the session token and client settings.
    It is called directly after logging in, and then once an hour to
    update the client access token.
  */
  exports.handshake = function(data) {debugger;
    console.log(JSON.stringify(data, null, 4));
    let session = $tw.Bob.wsClient.getSession(data.sessionId);
    // Update the session token and tokenEOL
    session.token = data.tokenRefresh;
    session.tokenEOL = data.tokenEOL;
    // Update the settings
    $tw.Bob.settings = data.settings;
    $tw.Bob.wsClient.settings.heartbeat = $tw.Bob.settings.heartbeat;
    $tw.Bob.wsClient.settings.reconnect = $tw.Bob.settings.reconnect;
    // Set the WS Session id to sessionStorage here
    if($tw.syncadaptor.sessionId && $tw.syncadaptor.sessionId == session.id) {
      window.sessionStorage.setItem("ws-adaptor-session",session.id);
      // Clear the server warning
      if($tw.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Server Warning`)) {
        $tw.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Server Warning`);
      }
    }
    if($tw.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Session Warning/${session.id}`)) {
      $tw.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Session Warning/${session.id}`);
    }
    // Start a heartbeat
    $tw.Bob.wsClient.heartbeat(session.id);
    // Sync to the server
    if(session.messages.entries().length > 0) {
      $tw.Bob.wsClient.syncToServer(session.id);
    }
    // This is an array of tiddler titles, each title is a string.
    const response = $tw.wiki.allTitles();
    // Send the response JSON as a string.
    let message = {
      type: 'browserTiddlerList',
      titles: response
    };
    console.log("handler-listTiddlers: should send list here")
    $tw.Bob.wsClient.sendMessage(session.id,message);
  }

  /* REQUIRED MESSAGE HANDLER
    This handles a ping from the server. The server and browser make sure they
    are connected by sending pings periodically. Pings from servers are not
    used in the heartbeat. The pong response echos back whatever was sent.
  */
  exports.ping = function(data) {
    let message = {};
    Object.keys(data).forEach(function(key) {
      message[key] = data[key];
    })
    message.type = 'pong';
    message.token = $tw.utils.getMessageToken();
    message.wiki = $tw.wikiName;
    // Send the response
    $tw.Bob.wsClient.send(message);
  }
    
  /* REQUIRED MESSAGE HANDLER
    This handles the pong response of a client's ping. It is used as the 
    heartbeat to ensure that the session to the server is still live.
  */
  exports.pong = function(data) {
    // If this pong is part of a heartbeat then send another heartbeat
    if(data.id == "heartbeat") {
      $tw.Bob.wsClient.heartbeat(data);
    }
  }

  /*
    TODO - determine if we should sanitise the tiddler titles and field names

    This message handler takes care of saveTiddler messages going to the
    browser.
    It creates a tiddler out of the supplied JSON object that lists the fields.

    JSON structure of data (the function input):
    {
      "fields": {
        "title": "Some title",
        "other": "field thingy",
        "text": "lots of text and stuff here because why not"
      }
    }
  */
  exports.saveTiddler = function(data) {
    // Ignore the message if it isn't for this wiki
    if(data.wiki === $tw.wikiName) {
      if(data.tiddler) {
        // The title must exist and must be a string, everything else is optional
        if(data.tiddler.fields) {
          if(typeof data.tiddler.fields.title === 'string') {
            // if the tiddler exists already only update it if the update is
            // different than the existing one.
            const changed = $tw.utils.TiddlerHasChanged(data.tiddler, $tw.wiki.getTiddler(data.tiddler.fields.title));
            if(changed) {
              $tw.wiki.addTiddler(new $tw.Tiddler(data.tiddler.fields));
              /* Not needed as we are using a syncer for each wiki?
              // Set the change count in the syncer so that the syncer doesn't save the tiddler again.
              if($tw.syncer.tiddlerInfo[data.tiddler.fields.title]) {
                $tw.syncer.tiddlerInfo[data.tiddler.fields.title].changeCount = $tw.wiki.getChangeCount(data.tiddler.fields.title);
								$tw.syncer.tiddlerInfo[data.tiddler.fields.title].timestampLastSaved = new Date();
              } else {
                $tw.syncer.tiddlerInfo[data.tiddler.fields.title] = {
									changeCount: $tw.wiki.getChangeCount(data.tiddler.fields.title),
									adaptorInfo: "",
									revision: undefined
								}
              }
              */
            }
          } else {
            console.log('Invalid tiddler title');
          }
        } else {
          console.log("No tiddler fields given");
        }
      } else {
        console.log('No tiddler')
      }
    }
  }

  /*
    When the browser receive a loaded tiddler from the server,
    it is handled by the syncer.
  */
  exports.loadTiddler = function(data) {
    // Update the info stored about this tiddler
    if(data.tiddler.fields) {
      $tw.syncer.storeTiddler(data.tiddler.fields);
    }
  }

  /*
    This message handles the deleteTiddler message for the browser. Note that
    this removes the tiddler from the wiki in the browser, but it does not
    delete the .tid file from the node server if you are running tiddlywiki in
    node. If you are running without node than this function is equavalient to
    deleting the tiddler.
  */
  exports.deleteTiddler = function(data) {
    if(data.wiki === $tw.wikiName) {
      data.tiddler = data.tiddler || {};
      data.tiddler.fields = data.tiddler.fields || {};
      const title = data.tiddler.fields.title;
      if(title) {
        $tw.wiki.deleteTiddler(title);
      }
    }
  }

  /*
    When the browser receives skinny tiddlers from the server dispatch the
    'skinny-tiddlers' event with the received tiddlers.
    It is handled by the syncadaptor.
  */
  exports.skinnyTiddlers = function(data) {
    const skinnyTiddlers = new CustomEvent('skinny-tiddlers', {bubbles: true, detail: data.tiddlers || []})
    $tw.rootWidget.dispatchEvent(skinnyTiddlers)
  }

  /*
    This is for updating the tiddlers currently being edited. It needs a
    special handler to support multi-wikis.
  */
  exports.updateEditingTiddlers = function(data) {
    // make sure there is actually a list sent
    if(data.list) {
        const listField = $tw.utils.stringifyList(data.list);
        // Make the tiddler fields
        const tiddlerFields = {
          title: "$:/state/Bob/EditingTiddlers",
          list: listField
        };
        // Add the tiddler
        $tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
    } else {
      console.log("No tiddler list given", {level:2});
    }
  }

  /*
    This message asks the browser to send a list of all tiddlers back to the
    node process.
    This is useful for when you are trying to sync the browser and the file
    system or if you only want a sub-set of existing tiddlers in the browser.
  */
  exports.listTiddlers = function(data) {
    const connectionIndex = data.source_connection;
    // This is an array of tiddler titles, each title is a string.
    const response = $tw.wiki.allTitles();
    // Send the response JSON as a string.
    const token = $tw.utils.getMessageToken();//localStorage.getItem('ws-token')
    let message = {
      type: 'browserTiddlerList',
      titles: response,
      token: token,
      wiki: $tw.wiki.getTiddlerText('$:/WikiName')
    };
    console.log("handler-listTiddlers: should send list here")
    //$tw.Bob.sendToServer(connectionIndex, message);
  }

  /*
    This message handles conflicts between the server and browser after
    reconnecting

    It saves the server version under the normal title and saves the in-browser
    version with the prefix $:/state/Bob/Conflicts/
  */
  exports.conflict = function(data) {
    if(data.tiddler) {
      if(data.tiddler.fields) {
        data.tiddler.fields.created = $tw.utils.stringifyDate(new Date(data.tiddler.fields.created))
        data.tiddler.fields.modified = $tw.utils.stringifyDate(new Date(data.tiddler.fields.modified))
        let wikiTiddler = $tw.wiki.getTiddler(data.tiddler.fields.title);
        if(wikiTiddler) {
          wikiTiddler = JSON.parse(JSON.stringify(wikiTiddler));
          wikiTiddler.fields.modified = $tw.utils.stringifyDate(new Date(wikiTiddler.fields.modified))
          wikiTiddler.fields.created = $tw.utils.stringifyDate(new Date(wikiTiddler.fields.created))
          // Only add the tiddler if it is different
          if($tw.utils.TiddlerHasChanged(data.tiddler, wikiTiddler)) {
            const newTitle = '$:/state/Bob/Conflicts/' + data.tiddler.fields.title;
            $tw.wiki.importTiddler(new $tw.Tiddler(wikiTiddler.fields, {title: newTitle}));
            // we have conflicts so open the conflict list tiddler
            let storyList = $tw.wiki.getTiddler('$:/StoryList').fields.list
            storyList = "$:/plugins/OokTech/Bob/ConflictList " + $tw.utils.stringifyList(storyList)
            $tw.wiki.addTiddler({title: "$:/StoryList", text: "", list: storyList},$tw.wiki.getModificationFields());
          }
        } else {
          // If the tiddler doesn't actually have a conflicting version than
          // just add the tiddler.
          $tw.wiki.importTiddler(new $tw.Tiddler(data.tiddler.fields));
        }
      }
    }
  }

  /*
    Import as a temporary tiddler so it can be saved or deleted by the person
    using the wiki
  */
  exports.import = function(data) {
    console.log('import', data.tiddler.fields.title, {level:2})
    data.tiddler.fields.created = $tw.utils.stringifyDate(new Date(data.tiddler.fields.created))
    data.tiddler.fields.modified = $tw.utils.stringifyDate(new Date(data.tiddler.fields.modified))
    const newTitle = '$:/state/Bob/Import/' + data.tiddler.fields.title;
    $tw.wiki.importTiddler(new $tw.Tiddler(data.tiddler.fields, {title: newTitle}));
    // we have conflicts so open the conflict list tiddler
    let storyList = $tw.wiki.getTiddler('$:/StoryList').fields.list
    storyList = "$:/plugins/OokTech/Bob/ImportList " + $tw.utils.stringifyList(storyList)
    $tw.wiki.addTiddler({
      title: "$:/StoryList",
      text: "",
      list: storyList
    },$tw.wiki.getModificationFields());
  }

  /*
    Download the file in the message data
  */
  exports.downloadFile = function(data) {
    if(data) {
      const text = $tw.wiki.renderTiddler("text/plain", "$:/core/save/all", {});
      let a = document.createElement('a');
      a.download = 'index.html';
      const thisStr = 'data:text/html;base64,'+window.btoa(unescape(encodeURIComponent(text)));
      a.setAttribute('href', thisStr);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  /*
    Set the viewable wikis
  */
  exports.setViewableWikis = function(data) {
    if(data.list) {
      const fields = {
        title: '$:/state/ViewableWikis',
        list: data.list
      }
      $tw.wiki.addTiddler(new $tw.Tiddler(fields));
    }
  }

  /*
    This takes an alert from the server and displays it in the browser.
    And appends it to a message history list.
  */
  exports.browserAlert = function(data) {
    const serverMessagesTid = $tw.wiki.getTiddler('$:/settings/Bob/ServerMessageHistoryLimit');
    let hideAlerts = false;
    if(serverMessagesTid) {
      hideAlerts = serverMessagesTid.fields.hide_messages === 'true'?true:false;
    }
    if(!hideAlerts) {
      if(data.alert) {
        // Update the message history
        let tiddler = $tw.wiki.getTiddler('$:/Bob/AlertHistory');
        let tidObj = {
          title:'$:/Bob/AlertHistory',
          type:'application/json',
          text: '{}'
        };
        if(tiddler) {
          tidObj = JSON.parse(JSON.stringify(tiddler.fields))
        }
        const newNumber = Object.keys(JSON.parse(tidObj.text)).map(function(item) {
          return Number(item.replace(/^\$:\/temp\/Server Alert /, ''))
        }).sort(function(a,b){return a-b}).slice(-1)[0] + 1 || 0;
        const AlertTitle = '$:/temp/Server Alert ' + newNumber;
        tidObj.text = JSON.parse(tidObj.text);
        tidObj.text[AlertTitle] = data.alert + ' - ' + $tw.utils.formatDateString(new Date(),"0hh:0mm, 0DD/0MM/YY");
        tidObj.text = JSON.stringify(tidObj.text);
        $tw.wiki.addTiddler(tidObj);

        // Make a tiddler that has the tag $:/tags/Alert that has the text of
        // the alert.
        const fields = {
          component: 'Server Message',
          title: AlertTitle,
          text: data.alert+"<br/><$button>Clear Alerts<$action-deletetiddler $filter='[tag[$:/tags/Alert]component[Server Message]]'/></$button>",
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

  /*
    This is used to update the current list of connections the server has to
    other servers
    These are used to pick which server to send messages to.
  */
  exports.updateConnections = function(data) {
    if(data.connections) {
      const fields = {
        title: '$:/Bob/ActiveConnections',
        list: $tw.utils.stringifyList(Object.keys(data.connections))
      };
      $tw.wiki.addTiddler(new $tw.Tiddler(fields));
      Object.keys(data.connections).forEach(function(connectionUrl) {
        if(data.connections[connectionUrl].name) {
          const connectionFields = {
            title: '$:/Bob/KnownServers/' + data.connections[connectionUrl].name,
            tags: '[[Remote Server]]',
            url: connectionUrl,
            staticurl: data.connections[connectionUrl].staticUrl,
            available_wikis: Object.keys(data.connections[connectionUrl].available_wikis).join(' '),
            available_chats: data.connections[connectionUrl].available_chats.join(' '),
            publickey: data.connections[connectionUrl].publicKey,
            allows_login: data.connections[connectionUrl].allows_login,
            name: data.connections[connectionUrl].name,
            local_name: data.connections[connectionUrl].local_name,
            active: data.connections[connectionUrl].active
          }
          $tw.wiki.addTiddler(new $tw.Tiddler(connectionFields));
          Object.keys(data.connections[connectionUrl].available_wikis).forEach(function(thisWikiName) {
            const theTid = $tw.wiki.getTiddler('$:/Bob/KnownServers/' + data.connections[connectionUrl].name + '/wikis/' + thisWikiName) || {fields: {}};
            $tw.wiki.addTiddler(new $tw.Tiddler({
              title: '$:/Bob/KnownServers/'+ data.connections[connectionUrl].name + '/wikis/' + thisWikiName,
              sync: data.connections[connectionUrl].available_wikis[thisWikiName].sync || 'no',
              sync_type: data.connections[connectionUrl].available_wikis[thisWikiName].sync_type || '',
              auto_sync: data.connections[connectionUrl].available_wikis[thisWikiName].auto_sync || 'no',
              sync_filter: data.connections[connectionUrl].available_wikis[thisWikiName].sync_filter || '',
              public: data.connections[connectionUrl].available_wikis[thisWikiName].public || 'yes',
              conflict_type: data.connections[connectionUrl].available_wikis[thisWikiName].conflict_type || 'manual',
              allows_login: data.connections[connectionUrl].available_wikis[thisWikiName].allows_login || 'no',
              name: thisWikiName,
              server_name: connectionUrl,
              local_name: data.connections[connectionUrl].available_wikis[thisWikiName].local_name,
              previous_sync: data.connections[connectionUrl].available_wikis[thisWikiName].previous_sync || 0
            }))
          })
          data.connections[connectionUrl].available_chats.forEach(function(thisChatName) {
            $tw.wiki.addTiddler(new $tw.Tiddler({
              title: '$:/Bob/KnownServers/' + data.connections[connectionUrl].name + '/chats/' + thisChatName,
              public: 'yes',
              relay: 'no',
              name: thisChatName
            }))
          })
        }
      })
    }
  }

	/*
		The server tells the browser to check if there are new settings
	*/
	exports.updateSettings = function(data) {
		$tw.Bob.wsClient.getSettings();
	}

	/*
		Receive a list of visible profiles from the server
	*/
	exports.profileList = function(data) {
		console.log(data)
	}

  /*
    For some messages we need an ack from the server to make sure that they
    were received correctly. This removes the messages from the queue after
    an ack is recevied.
  */
  exports.ack = $tw.utils.handleMessageAck;

})();
