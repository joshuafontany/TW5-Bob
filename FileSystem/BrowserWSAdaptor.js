/*\
title: $:/plugins/OokTech/Bob/BrowserWSAdaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor for syncing changes using websockets with 
Bob's WSClient library instance: $tw.Bob.wsClient

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
  This adds actions for the different event hooks. Each hook sends a
  message to the node process.

  Some unused hooks have commented out skeletons for adding those hooks in
  the future if they are needed.
*/
let addHooks = function(connectionIndex) {
  connectionIndex = connectionIndex || 0;
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

function BrowserWSAdaptor(options) {
  this.wiki = options.wiki;
  this.hasStatus = false;
	this.logger = new $tw.utils.Logger("BrowserWSAdaptor");
	this.isLoggedIn = false;
	this.isReadOnly = false;
  if(options.url){
    this.host = options.url;
  } else {
    this.host = this.getHost();
  }
  this.connectionIndex = options.connectionIndex || 0;
  // Do all actions on startup.
  //$tw.Bob.wsClient.connect(this.connectionIndex, this.host);
  //addHooks(this.connectionIndex);
}

// Syncadaptor properties

// REQUIRED
// The name of the syncadaptor
BrowserWSAdaptor.prototype.name = "browserwsadaptor";

BrowserWSAdaptor.prototype.supportsLazyLoading = true;

BrowserWSAdaptor.prototype.isReady = function() {
  return this.hasStatus;
}

BrowserWSAdaptor.prototype.getHost = function() {
  const WSDomain = window.location.hostname;
  const WSSPort = window.location.port;
  const regxName = new RegExp("\\/"+ $tw.wikiName + "\\/?$");
  const WSPath = decodeURI(window.location.pathname).replace(regxName,'');
  const text = "wss://" + WSDomain +":" + WSSPort + WSPath;
  return text;
}

BrowserWSAdaptor.prototype.getTiddlerInfo = function(tiddler, options) {
  /* Bag stuff here?
  options = options || {};
  return {
		bag: tiddler.fields.bag
  };
  */
  return {};
}

/*
Get the current status of the WS connection
*/
BrowserWSAdaptor.prototype.getStatus = function(callback) {
	// Get status
	var self = this;
	this.logger.log("Getting status");
	$tw.utils.httpRequest({
		url: this.host + "status",
		callback: function(err,data) {
			self.hasStatus = true;
			if(err) {
				return callback(err);
			}
			// Decode the status JSON
			var json = null;
			try {
				json = JSON.parse(data);
			} catch (e) {
			}
			if(json) {
				self.logger.log("Status:",data);
				// Record the recipe
				if(json.space) {
					self.recipe = json.space.recipe;
				}
				// Check if we're logged in
				self.isLoggedIn = json.username !== "GUEST";
				self.isReadOnly = !!json["read_only"];
				self.isAnonymous = !!json.anonymous;

				var isSseEnabled = !!json.sse_enabled;
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
BrowserWSAdaptor.prototype.login = function(username,password,callback) {
	var options = {
		url: this.host + "challenge/tiddlywebplugins.tiddlyspace.cookie_form",
		type: "POST",
		data: {
			user: username,
			password: password,
			tiddlyweb_redirect: "/status" // workaround to marginalize automatic subsequent GET
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
BrowserWSAdaptor.prototype.logout = function(callback) {
	var options = {
		url: this.host + "logout",
		type: "POST",
		data: {
			csrf_token: this.getCsrfToken(),
			tiddlyweb_redirect: "/status" // workaround to marginalize automatic subsequent GET
		},
		callback: function(err,data) {
			callback(err);
		}
	};
	this.logger.log("Logging out:",options);
	$tw.utils.httpRequest(options);
};

/*
Retrieve the CSRF token from its cookie
*/
BrowserWSAdaptor.prototype.getCsrfToken = function() {
	var regex = /^(?:.*; )?csrf_token=([^(;|$)]*)(?:;|$)/,
		match = regex.exec(document.cookie),
		csrf = null;
	if (match && (match.length === 2)) {
		csrf = match[1];
	}
	return csrf;
};

/*
  Get the current status of the Bob WS conection (called by the syncer)
*/
BrowserWSAdaptor.prototype.getStatus = function(callback) {
  console.log('Getting status');

  //callback(null,isLoggedIn,json.username,isReadOnly,isAnonymous,isPollingDisabled);
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
    $tw.Bob.sendToServer(connectionIndex, message, function(err, id){
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
    $tw.Bob.sendToServer(connectionIndex, message, function(err, id){
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
    $tw.Bob.sendToServer(connectionIndex, message, function(err, id){
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

/*
// OPTIONAL
// This checks the login state
// it can be used to give an async way to check the status and update the
// isReady state. The tiddlyweb adaptor does this.
BrowserWSAdaptor.prototype.getStatus = function(callback) {

}*/

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
              if($tw.Bob.sessions) {
                if($tw.Bob.sessions[0].socket.readyState === 1) {
                  id = $tw.Bob.sendToServer(connectionIndex, message)
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
          if($tw.Bob.sessions) {
            if($tw.Bob.sessions[0].socket.readyState === 1) {
              id = $tw.Bob.sendToServer(connectionIndex, message)
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
