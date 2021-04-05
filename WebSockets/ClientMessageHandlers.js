/*\
title: $:/plugins/OokTech/Bob/ClientMessageHandlers.js
type: application/javascript
module-type: client-messagehandlers

Handlers for messages sent to the wsClient (mostly in the browser).

`this` is always the session object,
`data` is the current message data,
`instance` is the current $tw instance (if diffrent from the `RootWiki` $tw)

$tw.Bob will always be at the root $tw object on both node and browser.
\*/
(function () {

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";

  /* REQUIRED
    The session handles incoming acks
  */
  exports.ack = function (data,instance) {
    this.handleMessageAck(data,instance);
  }

  /* REQUIRED MESSAGE HANDLER
    This handles a ping from the server. The server and browser make sure they
    are connected by sending pings periodically. Pings from servers are not
    used in the heartbeat. The pong response echos back whatever was sent.
  */
  exports.ping = function (data,instance) {
    // When the server receives a ping it sends back a pong.
    let message = $tw.utils.extend(data, { type: 'pong' });
    this.send(message);
  }

  /* REQUIRED MESSAGE HANDLER
    This handles the pong response of a client's ping. It is used as the 
    heartbeat to ensure that the session to the server is still live.
  */
  exports.pong = function (data,instance) {
    // If this pong is part of a heartbeat then send another heartbeat
    if (data.id == "heartbeat") {
      $tw.Bob.wsClient.heartbeat(data);
    }
  }

  /* REQUIRED
    When the handshake is confirmed the heartbeat timer starts. This tells us
    if the connection to the server gets interrupted. The state is reset, 
    and any unacknowledged messages are sent by "syncing" to the server.
    This message handler updates the session token and client settings.
    It is called directly after logging in, and then once an hour to
    update the client access token.
  */
  exports.handshake = function (data,instance) {
    if(data.settings) {
      // Update the settings
      $tw.Bob.settings = data.settings;
      $tw.Bob.wsClient.settings = $tw.Bob.settings['ws-client'] || $tw.Bob.wsClient.settings;
    }
    // Set the WS Session id to sessionStorage here
    if($tw.syncadaptor.sessionId && $tw.syncadaptor.sessionId == this.id) {
      window.sessionStorage.setItem("ws-adaptor-session", this.id);
      // Clear the server warning
      if($tw.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Server Warning`)) {
        $tw.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Server Warning`);
      }
    } else {
      if(instance.wiki.tiddlerExists(`$:/plugins/OokTech/Bob/Session Warning/${this.id}`)) {
        instance.wiki.deleteTiddler(`$:/plugins/OokTech/Bob/Session Warning/${this.id}`);
      }
    }
    // Start a heartbeat
    $tw.Bob.wsClient.heartbeat(data);
    // Sync to the server
    if ($tw.Bob.wsManager.tickets.entries().length > 0) {
      $tw.Bob.wsClient.syncToServer(this.id);
    }
    // This is an array of tiddler titles, each title is a string.
    const response = instance.wiki.allTitles();
    // Send the response JSON as a string.
    let message = {
      type: 'clientTiddlerList',
      titles: response
    };
    this.sendMessage(message);
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
  exports.saveTiddler = function (data,instance) {
    if(data.tiddler && data.tiddler.fields
      && typeof data.tiddler.fields.title === 'string') {
      // The title must exist and must be a string, everything else is optional
      let update = new $tw.Tiddler(data.tiddler.fields),
      tiddler = instance.wiki.getTiddler(data.tiddler.fields.title);
      if (!tiddler || !tiddler.isEqual(update)) {
        instance.syncer.storeTiddler(update.fields);
      }
    } else {
      console.error(`['${this.id}'] Save Tiddler error: Invalid tiddler`)
    }
  }

  /*
    When the client receive a "loaded" tiddler from the server,
    it is handled by the syncer.
  */
  exports.loadTiddler = function (data,instance) {
    // Update the info stored about this tiddler
    if (data.tiddler && data.tiddler.fields
      && typeof data.tiddler.fields.title === 'string') {
      instance.syncer.storeTiddler(data.tiddler.fields);
    } else {
      console.error(`['${this.id}'] Load Tiddler error: Invalid tiddler`)
    }
  }

  /*
    This message handles the deleteTiddler message for the client. Note that
    this removes the tiddler from the client wiki in the browser and on node.
  */
  exports.deleteTiddler = function (data,instance) {
    if (data.tiddler && data.tiddler.fields
      && typeof data.tiddler.fields.title === 'string') {
      instance.wiki.deleteTiddler(title);
    } else {
      console.error(`['${this.id}'] Delete Tiddler error: Invalid tiddler`)
    }
  }

  /*
    When the browser receives skinny tiddlers from the server dispatch the
    'skinny-tiddlers' event with the received tiddlers.
    It is handled by the syncadaptor.
  */
  exports.skinnyTiddlers = function (data,instance) {
    const skinnyTiddlers = new CustomEvent('skinny-tiddlers', { bubbles: true, detail: data.tiddlers || [] })
    instance.rootWidget.dispatchEvent(skinnyTiddlers)
  }

  /*
    This is for updating the tiddlers currently being edited. It needs a
    special handler to support multi-wikis.
  */
  exports.updateEditingTiddlers = function (data) {
    // make sure there is actually a list sent
    if (data.list) {
      const listField = $tw.utils.stringifyList(data.list);
      // Make the tiddler fields
      const tiddlerFields = {
        title: "$:/state/Bob/EditingTiddlers",
        list: listField
      };
      // Add the tiddler
      $tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
    } else {
      console.log("No tiddler list given", { level: 2 });
    }
  }

  /*
    This message asks the client to send a list of all tiddlers back to the
    node process.
    This is useful for when you are trying to sync the client and the remote file
    system or if you only want a sub-set of existing tiddlers in the browser.
  */
  exports.listTiddlers = function (data) {
    const connectionIndex = data.source_connection;
    // This is an array of tiddler titles, each title is a string.
    const response = $tw.wiki.allTitles();
    let message = {
      type: 'clientTiddlerList',
      titles: response
    };
    this.sendMessage(message);
  }

  /*
    This message handles conflicts between the server and browser after
    reconnecting

    It saves the server version under the normal title and saves the in-browser
    version with the prefix $:/state/Bob/Conflicts/
  */
  exports.conflict = function (data) {
    if (data.tiddler) {
      if (data.tiddler.fields) {
        data.tiddler.fields.created = $tw.utils.stringifyDate(new Date(data.tiddler.fields.created))
        data.tiddler.fields.modified = $tw.utils.stringifyDate(new Date(data.tiddler.fields.modified))
        let wikiTiddler = $tw.wiki.getTiddler(data.tiddler.fields.title);
        if (wikiTiddler) {
          wikiTiddler = JSON.parse(JSON.stringify(wikiTiddler));
          wikiTiddler.fields.modified = $tw.utils.stringifyDate(new Date(wikiTiddler.fields.modified))
          wikiTiddler.fields.created = $tw.utils.stringifyDate(new Date(wikiTiddler.fields.created))
          // Only add the tiddler if it is different
          if ($tw.Bob.tiddlerHasChanged(data.tiddler, wikiTiddler)) {
            const newTitle = '$:/state/Bob/Conflicts/' + data.tiddler.fields.title;
            $tw.wiki.importTiddler(new $tw.Tiddler(wikiTiddler.fields, { title: newTitle }));
            // we have conflicts so open the conflict list tiddler
            let storyList = $tw.wiki.getTiddler('$:/StoryList').fields.list
            storyList = "$:/plugins/OokTech/Bob/ConflictList " + $tw.utils.stringifyList(storyList)
            $tw.wiki.addTiddler({ title: "$:/StoryList", text: "", list: storyList }, $tw.wiki.getModificationFields());
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
  exports.import = function (data) {
    console.log('import', data.tiddler.fields.title, { level: 2 })
    data.tiddler.fields.created = $tw.utils.stringifyDate(new Date(data.tiddler.fields.created))
    data.tiddler.fields.modified = $tw.utils.stringifyDate(new Date(data.tiddler.fields.modified))
    const newTitle = '$:/state/Bob/Import/' + data.tiddler.fields.title;
    $tw.wiki.importTiddler(new $tw.Tiddler(data.tiddler.fields, { title: newTitle }));
    // we have conflicts so open the conflict list tiddler
    let storyList = $tw.wiki.getTiddler('$:/StoryList').fields.list
    storyList = "$:/plugins/OokTech/Bob/ImportList " + $tw.utils.stringifyList(storyList)
    $tw.wiki.addTiddler({
      title: "$:/StoryList",
      text: "",
      list: storyList
    }, $tw.wiki.getModificationFields());
  }

  /*
    Download the file in the message data
  */
  exports.downloadFile = function (data) {
    if (data) {
      const text = $tw.wiki.renderTiddler("text/plain", "$:/core/save/all", {});
      let a = document.createElement('a');
      a.download = 'index.html';
      const thisStr = 'data:text/html;base64,' + window.btoa(unescape(encodeURIComponent(text)));
      a.setAttribute('href', thisStr);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  /*
    Set the viewable wikis
  */
  exports.setViewableWikis = function (data) {
    if (data.list) {
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
  exports.browserAlert = function (data) {
    const serverMessagesTid = $tw.wiki.getTiddler('$:/settings/Bob/ServerMessageHistoryLimit');
    let hideAlerts = false;
    if (serverMessagesTid) {
      hideAlerts = serverMessagesTid.fields.hide_messages === 'true' ? true : false;
    }
    if (!hideAlerts) {
      if (data.alert) {
        // Update the message history
        let tiddler = $tw.wiki.getTiddler('$:/Bob/AlertHistory');
        let tidObj = {
          title: '$:/Bob/AlertHistory',
          type: 'application/json',
          text: '{}'
        };
        if (tiddler) {
          tidObj = JSON.parse(JSON.stringify(tiddler.fields))
        }
        const newNumber = Object.keys(JSON.parse(tidObj.text)).map(function (item) {
          return Number(item.replace(/^\$:\/temp\/Server Alert /, ''))
        }).sort(function (a, b) { return a - b }).slice(-1)[0] + 1 || 0;
        const AlertTitle = '$:/temp/Server Alert ' + newNumber;
        tidObj.text = JSON.parse(tidObj.text);
        tidObj.text[AlertTitle] = data.alert + ' - ' + $tw.utils.formatDateString(new Date(), "0hh:0mm, 0DD/0MM/YY");
        tidObj.text = JSON.stringify(tidObj.text);
        $tw.wiki.addTiddler(tidObj);

        // Make a tiddler that has the tag $:/tags/Alert that has the text of
        // the alert.
        const fields = {
          component: 'Server Message',
          title: AlertTitle,
          text: data.alert + "<br/><$button>Clear Alerts<$action-deletetiddler $filter='[tag[$:/tags/Alert]component[Server Message]]'/></$button>",
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
  exports.updateConnections = function (data) {
    if (data.connections) {
      const fields = {
        title: '$:/Bob/ActiveConnections',
        list: $tw.utils.stringifyList(Object.keys(data.connections))
      };
      $tw.wiki.addTiddler(new $tw.Tiddler(fields));
      Object.keys(data.connections).forEach(function (connectionUrl) {
        if (data.connections[connectionUrl].name) {
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
          Object.keys(data.connections[connectionUrl].available_wikis).forEach(function (thisWikiName) {
            const theTid = $tw.wiki.getTiddler('$:/Bob/KnownServers/' + data.connections[connectionUrl].name + '/wikis/' + thisWikiName) || { fields: {} };
            $tw.wiki.addTiddler(new $tw.Tiddler({
              title: '$:/Bob/KnownServers/' + data.connections[connectionUrl].name + '/wikis/' + thisWikiName,
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
          data.connections[connectionUrl].available_chats.forEach(function (thisChatName) {
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
  exports.updateSettings = function (data) {
    $tw.Bob.wsClient.getSettings();
  }

  /*
    Receive a list of visible profiles from the server
  */
  exports.profileList = function (data) {
    console.log(data)
  }

})();
