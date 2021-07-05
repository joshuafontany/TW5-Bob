/*\
title: $:/plugins/OokTech/Bob/WSAdaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor for syncing changes using websockets with Yjs and Bob

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const CONFIG_HOST_TIDDLER = "$:/config/bob/host",
  DEFAULT_HOST_TIDDLER = "$protocol$//$host$/";

/*
  This adds actions for the different event hooks. Each hook sends a
  message to the node process.

  Some unused hooks have commented out skeletons for adding those hooks in
  the future if they are needed.
*/
let addHooks = function(connectionIndex) {
  connectionIndex = connectionIndex || 0;
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
            $tw.Bob.sendToServer(connectionIndex, message);
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
    $tw.Bob.sendToServer(connectionIndex, message);
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
    $tw.Bob.sendToServer(connectionIndex, message);
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
            let percentComplete = e.loaded/e.total*100;
          } else {
            let percentComplete = -1;
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
      //const mimeMap = $tw.Bob.settings.mimeMap || {
      const mimeMap = $tw.Bob.settings.mimeMap || {
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

        let wikiPrefix = this.wiki.getTiddlerText('$:/status/WikiName') || '';
        const uploadURL = '/api/upload';
        request.open('POST', uploadURL, true);
        // cookies are sent with the request so the authentication cookie
        // should be there if there is one.
        const thing = {
          tiddler: tiddler,
          wiki: this.wiki.getTiddlerText('$:/status/WikiName')
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
        wikiPrefix = this.wiki.getTiddlerText('$:/status/WikiName') || '';
        wikiPrefix = wikiPrefix === '' ? '' : '/' + wikiPrefix;
        $tw.Bob.settings.fileURLPrefix = $tw.Bob.settings.fileURLPrefix || 'files';
        const uri = wikiPrefix + '/' + $tw.Bob.settings.fileURLPrefix + '/' + tiddler.fields.title;
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

function WebsocketAdaptor(options) {
    this.wiki = options.wiki;
    this.host = this.getHost();
    this.hasStatus = false;
    this.logger = new $tw.utils.Logger("WebsocketAdaptor");
    this.isLoggedIn = false;
    this.isReadOnly = false;
    this.isAnonymous = true;
    this.sessionId = window.sessionStorage.getItem("ws-adaptor-session") || require('./External/uuid/nil.js').default;
    this.updates = {
      modifications: [],
      deletions: []
    };
    //addHooks(this.clientId);
}

// Syncadaptor properties

// REQUIRED
// The name of the syncadaptor
WebsocketAdaptor.prototype.name = "wsadaptor";

WebsocketAdaptor.prototype.supportsLazyLoading = false;

WebsocketAdaptor.prototype.isReady = function() {
  return $tw.Bob.Wikis.has($tw.wikiName);
}

WebsocketAdaptor.prototype.getHost = function() {
  let text = this.wiki.getTiddlerText(CONFIG_HOST_TIDDLER,DEFAULT_HOST_TIDDLER),
    substitutions = [
      {name: "protocol", value: document.location.protocol},
      {name: "host", value: document.location.host}
    ];
  for(let t=0; t<substitutions.length; t++) {
    let s = substitutions[t];
    text = $tw.utils.replaceString(text,new RegExp("\\$" + s.name + "\\$","mg"),s.value);
  }
  if(!!$tw.wikiName && $tw.wikiName !== "RootWiki") {
    let regxName = new RegExp($tw.wikiName + "\\/?$");
    text = text.replace(regxName,'');
  }
  return text;
}

WebsocketAdaptor.prototype.getTiddlerInfo = function(tiddler) {
  /* 
    Return the vector clock of the tiddler?
  */
  return {

  };
}

/*
Get the current status of the user
*/
WebsocketAdaptor.prototype.getStatus = function(callback) {
	// Get status
	let self = this,
    isSseEnabled = false,
    params = "?wiki=" + $tw.wikiName + "&session=" + this.sessionId;
  this.logger.log("Getting status");
	$tw.utils.httpRequest({
		url: this.host + "status" + params,
		callback: function(err,data) {
			self.hasStatus = true;
			if(err) {
				return callback(err);
			}
			// Decode the status JSON
			let json = null;
			try {
				json = JSON.parse(data);
			} catch (e) {
			}
			if(json) {
				// Record the recipe
				if(json.space) {
					self.recipe = json.space.recipe;
				}
				// Check if we're logged in
				self.isLoggedIn = !!json.username;
				self.isReadOnly = !!json["read_only"];
				self.isAnonymous = !!json.anonymous;

				isSseEnabled = !!json.sse_enabled;

        if(json.session) {
          // Set the session id, setup the WS connection
          self.sessionId = json.session.id;
          window.sessionStorage.setItem("ws-adaptor-session", self.sessionId);
          if($tw.Bob.hasSession(json.session.id)){
            $tw.Bob.getSession(json.session.id).connect()
          } else {
            // Setup the connection url
            json.session.client = true;
            json.session.connect = true;
            json.session.url = new $tw.Bob.url($tw.Bob.getHost(self.host));
            json.session.url.searchParams.append("wiki", $tw.wikiName);
            json.session.url.searchParams.append("session", json.session.id);
            json.session.doc = $tw.Bob.getYDoc($tw.wikiName);
            let session = $tw.Bob.createSession(json.session);
            // Event handlers
            let tiddlerHandler = function(events,transaction){
              if (transaction.origin !== session) {         
                events.forEach(event => {
                  console.log(event);
                  debugger; 
                  // Push tiddler title to updates array
                  if(self.updates.modifications.indexOf() == -1) {
                    self.updates.modifications.push(self.updates.length);
                  }
                });
              }
            };
            session.doc.on('tiddlers',tiddlerHandler)
            session.on("status",function(event,session) {
              if(event.status == "error" || (!!event.code && event.code == 4023)) {
                  // Invalid session or connection rejected
                  session.doc.off('tiddlers',tiddlerHandler);
                  self.sessionId = require('./External/uuid/nil.js').default;
                  window.sessionStorage.setItem("ws-adaptor-session", self.sessionId);
                  $tw.Bob.deleteSession(session.id);
                  session.destroy();
                  session = null;
              }
            });
          }
        }
      }
      // Invoke the callback if present
      if(callback) {
        callback(null,self.isLoggedIn,json.username,self.isReadOnly,self.isAnonymous,isSseEnabled);
      }
    }
	});
};

/*
Attempt to login and invoke the callback(err)
*/
WebsocketAdaptor.prototype.login = function(username,password,callback) {
	let options = {
		url: this.host + "challenge/bob-login",
		type: "POST",
		data: {
			user: username,
			password: password
		},
		callback: function(err) {
			callback(err);
		}
	};
	this.logger.log("Logging in:",options);
	$tw.utils.httpRequest(options);
};

/*
*/
WebsocketAdaptor.prototype.logout = function(callback) {
	let options = {
		url: this.host + "logout",
		type: "POST",
		data: {
      session_id: this.sessionId
		},
		callback: function(err,data) {
			callback(err);
		}
	};
	this.logger.log("Logging out:",options);
	$tw.utils.httpRequest(options);
};

/*
Get an array of skinny tiddler fields from the yjs doc?
*/
WebsocketAdaptor.prototype.getUpdatedTiddlers = function(syncer,callback) {
  // Invoke the callback with the updated tiddler titles
  let updates = {
    modifications: $tw.utils.extend([],this.updates.modifications),
    deletions: $tw.utils.extend([],this.updates.deletions)
  }
  this.updates.deletions = [];
  callback(null,updates);
};

// REQUIRED
// This does whatever is necessary to actually store a tiddler
WebsocketAdaptor.prototype.saveTiddler = function(tiddler, options, callback) {
  // Check for pre v5.2.0 method signature:
  if(typeof callback !== "function" && typeof options === "function"){
    let optionsArg = callback;
    callback = options;
    options = optionsArg;
  }
  options = options || {};
  if(this.isReadOnly) {
		return callback(null,options.tiddlerInfo.adaptorInfo);
	}
  // Test the connection
  let session = $tw.Bob.getSession(this.sessionId);
  if(!session || !session.isReady()) {
    return callback($tw.language.getString("Error/XMLHttpRequest") + ": 0");
  } else {
      // Save to the YDoc here
      let wikiDoc = $tw.Bob.getYDoc($tw.wikiName);
      let wikiTitles = wikiDoc.getArray("titles");
      let wikiTiddlers = wikiDoc.getArray("tiddlers");  
      let tiddlerIndex = wikiTitles.toArray().indexOf(tiddler.fields.title);

      let standardFields = [
        "title",
        "text",
        "modified",
        "modifier",
        "created",
        "creator",
        "tags",
        "type",
        "list",
        "caption"
      ];
      wikiDoc.transact(() => {debugger;
        let tiddlerFields = tiddler.getFieldStrings();
        let tiddlerMap = tiddlerIndex == -1? wiikiDoc.getMap(title): wikiTiddlers.get(tiddlerIndex);
        standardFields.forEach(field => {
          if (tiddlerFields[field]) {
            tiddlerMap.set(field,fieldStrings[field]);
            delete tiddlerFields[field];
          }
        });
        tiddlerMap.set("fields",fieldStrings);
        if(tiddlerIndex == -1){
          wikiTiddlers.push(tiddlerMap);
          wikiTitles.push(tiddler.fields.title);
        }
        wikiMap.set("titles", $tw.syncer.getSyncedTiddlers());
      },$tw);
      callback(null,options.tiddlerInfo.adaptorInfo,null);
  }
}

// REQUIRED
// This does whatever is necessary to load a tiddler.
// Used for lazy loading
WebsocketAdaptor.prototype.loadTiddler = function(title, options, callback) {
  // Check for pre v5.2.0 method signature:
  if(typeof callback !== "function" && typeof options === "function"){
    let optionsArg = callback;
    callback = options;
    options = optionsArg;
  }
  options = options || {};
  let updateIndex = this.updates.modifications.indexOf(title),
    tiddlerFields = null;
  try {
    let wikiDoc = $tw.Bob.getYDoc($tw.wikiName);
    let wikiTitles = wikiDoc.getArray("titles");
    let wikiTiddlers = wikiDoc.getArray("tiddlers");  
    let tiddlerIndex = wikiTitles.toArray().indexOf(title);
    let tiddlerFields = wikiTiddlers.get(tiddlerIndex).toJSON();
    if(updateIndex !== -1) {
      this.updates.modifications.splice(updateIndex,1)
    }
    callback(null, tiddlerFields, options.tiddlerInfo.adaptorInfo);
  } catch (error) {
    callback(error)
  }
}

// REQUIRED
// This does whatever is necessary to delete a tiddler
WebsocketAdaptor.prototype.deleteTiddler = function(title, options, callback) {
  // Check for pre v5.2.0 method signature:
  if(typeof callback !== "function" && typeof options === "function"){
    let optionsArg = callback;
    callback = options;
    options = optionsArg;
  }
  options = options || {};
  if(this.isReadOnly) {
		return callback(null,options.tiddlerInfo.adaptorInfo);
	}
  let session = $tw.Bob.getSession(this.sessionId);
  if(!session || !session.isReady()) {
    return callback($tw.language.getString("Error/XMLHttpRequest") + ": 0");
  } else {
    let wikiDoc = $tw.Bob.getYDoc($tw.wikiName);
    let wikiTitles = wikiDoc.getArray("titles");
    let wikiTiddlers = wikiDoc.getArray("tiddlers");  
    let tiddlerIndex = wikiTitles.toArray().indexOf(title);
    wikiDoc.transact(() => {
      wikiTiddlers.delete(tiddlerIndex,1);
      wikiTitles.delete(tiddlerIndex,1);
      wikiMap.set("titles", $tw.syncer.getSyncedTiddlers());
    },$tw);
    callback(null,null);
  }
}

// Only set up the websockets if we are in the browser and have websockets.
if($tw.browser && window.location.hostname && $tw.Bob) {
  //setupSkinnyTiddlerLoading()
  exports.adaptorClass = WebsocketAdaptor
}

})();
