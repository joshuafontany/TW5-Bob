/*\
title: $:/plugins/OokTech/Bob/Bob.js
type: application/javascript
module-type: library

A core prototype to hand everything else onto.

\*/
(function () {

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";

  const Yutils = require('./External/yjs/y-utils.cjs');
  const WebSocketManager = require('./WSManager.js').WebSocketManager;

  /*
    "Bob" is a websocket helper module for both server and client/browser.
    options: 
  */
  function Bob(options) {
    this.settings = {    // Setup the heartbeat settings placeholders (filled in by the 'handshake')
      "heartbeat": {
        "interval":1000, // default 1 sec heartbeats
        "timeout":5000 // default 5 second heartbeat timeout
      },
      "reconnect": {
        "auto": true,
        "initial": 1200, // small initial increment
        "decay": 1.5, // exponential decay d^n (number-of-retries)
        "max": 1000000, // maximum retry increment
        "abort": 20 // failure after this many tries
      }
    };
    this.version = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob').fields.version;
    this.ExcludeFilter = $tw.wiki.getTiddlerText('$:/plugins/OokTech/Bob/ExcludeSync');
    // Wikis & Ydocs maps
    this.Wikis = new Map();
    this.Ydocs = new Map();
    this.Yversion = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob/External/yjs/yjs.cjs').fields.version;
    // Logger
    this.logger = {};
    // Setup Websocket library
    if($tw.node){
      this.ws = require('./External/ws/ws.js');
      this.url = require('url').URL;
    } else {
      this.ws = WebSocket;
      this.url = URL;
    }
    // Always setup the WebSocketManager
    let managerSerialized = JSON.parse("{}");
    this.wsManager = new WebSocketManager(managerSerialized);
  }

  Bob.prototype.browserSide = function () {
      // Get the name for this wiki for websocket messages
      $tw.wikiName = $tw.wiki.getTiddlerText("$:/WikiName", $tw.wiki.getTiddlerText("$:/SiteTitle", ""));
      // Set this wiki as loaded
      $tw.Bob.Wikis.set($tw.wikiName,$tw);
      // Setup the Ydocs for the wiki
      let wikiDoc = $tw.Bob.getYDoc($tw.wikiName);
  
      // Attach the providers 
  
      // Awareness
          
      // Initialize the wiki subdocs
  
    };  

  // Tiddler methods

  /*
    This function takes two tiddler objects and returns a boolean value
    indicating if they are the same or not.
  */
  Bob.prototype.tiddlerHasChanged = function (tiddler, otherTiddler) {
    if (!otherTiddler) {
      return true;
    }
    if (!tiddler) {
      return true;
    }
    if (!otherTiddler.fields && tiddler.fields) {
      return true;
    }
    if (!tiddler.fields && otherTiddler.fields) {
      return true;
    }
    const hash1 = tiddler.hash || this.getTiddlerHash(tiddler);
    const hash2 = otherTiddler.hash || this.getTiddlerHash(otherTiddler);
    return hash1 !== hash2;
  };

  /*
    This is a simple and fast hashing function that we can use to test if a
    tiddler has changed or not.
    This doesn't need to be at all secure, and doesn't even need to be that
    robust against collisions, it just needs to make collisions rare for a very
    easy value of rare, like 0.1% would be more than enough to make this very
    useful, and this should be much better than that.

    Remember that this just cares about collisions between one tiddler and its
    previous state after an edit, not between all tiddlers in the wiki or
    anything like that.
  */
  Bob.prototype.getTiddlerHash = function (tiddler) {
    const tiddlerString = this.stableStringify(this.normalizeTiddler(tiddler))
    let hash = 0;
    if (tiddlerString.length === 0) {
      return hash;
    }
    for (let i = 0; i < tiddlerString.length; i++) {
      const char = tiddlerString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  // This is a stable json stringify function from https://github.com/epoberezkin/fast-json-stable-stringify
  Bob.prototype.stableStringify = function (data, opts) {
    if (!opts) opts = {};
    if (typeof opts === 'function') opts = { cmp: opts };
    let cycles = (typeof opts.cycles === 'boolean') ? opts.cycles : false;

    let cmp = opts.cmp && (function (f) {
      return function (node) {
        return function (a, b) {
          const aobj = { key: a, value: node[a] };
          const bobj = { key: b, value: node[b] };
          return f(aobj, bobj);
        };
      };
    })(opts.cmp);

    let seen = [];
    return (function stringify(node) {
      if (node && node.toJSON && typeof node.toJSON === 'function') {
        node = node.toJSON();
      }

      if (node === undefined) return;
      if (typeof node == 'number') return isFinite(node) ? '' + node : 'null';
      if (typeof node !== 'object') return JSON.stringify(node);

      let i, out;
      if (Array.isArray(node)) {
        out = '[';
        for (i = 0; i < node.length; i++) {
          if (i) out += ',';
          out += stringify(node[i]) || 'null';
        }
        return out + ']';
      }

      if (node === null) return 'null';

      if (seen.indexOf(node) !== -1) {
        if (cycles) return JSON.stringify('__cycle__');
        throw new TypeError('Converting circular structure to JSON');
      }

      let seenIndex = seen.push(node) - 1;
      let keys = Object.keys(node).sort(cmp && cmp(node));
      out = '';
      for (i = 0; i < keys.length; i++) {
        let key = keys[i];
        let value = stringify(node[key]);

        if (!value) continue;
        if (out) out += ',';
        out += JSON.stringify(key) + ':' + value;
      }
      seen.splice(seenIndex, 1);
      return '{' + out + '}';
    })(data);
  };

  /*
    This normalizes a tiddler so that it can be compared to another tiddler to
    determine if they are the same.

    Any two tiddlers that have the same fields and content (including title)
    will return exactly the same thing using this function.

    Fields are included in alphabetical order, as defined by the javascript
    array sort method.

    The tag field gets sorted and the list field is interpreted as a string
    array. If either field exists but it is an empty string it is replaced with
    an empty array.

    Date fields (modified and created) are stringified.
  */
  Bob.prototype.normalizeTiddler = function (tiddler) {
    let newTid = {};
    if (tiddler) {
      if (tiddler.fields) {
        let fields = Object.keys(tiddler.fields) || []
        fields.sort()
        fields.forEach(function (field) {
          if (field === 'list' || field === 'tags') {
            if (Array.isArray(tiddler.fields[field])) {
              newTid[field] = tiddler.fields[field].slice()
              if (field === 'tags') {
                newTid[field] = newTid[field].sort()
              }
            } else if (tiddler.fields[field] === '') {
              newTid[field] = []
            } else {
              newTid[field] = $tw.utils.parseStringArray(tiddler.fields[field]).slice()
              if (field === 'tags') {
                newTid[field] = newTid[field].sort()
              }
            }
          } else if (field === 'modified' || field === 'created') {
            if (typeof tiddler.fields[field] === 'object' && tiddler.fields[field] !== null) {
              newTid[field] = $tw.utils.stringifyDate(tiddler.fields[field]);
            } else {
              newTid[field] = tiddler.fields[field]
            }
          } else {
            newTid[field] = tiddler.fields[field]
          }
        })
        if (typeof newTid.text === 'undefined' || !newTid.text) {
          newTid.text = '';
        }
      }
    }
    return { fields: newTid }
  }


  /*
  *
  * Ydoc methods
  */
  Bob.prototype.getYDoc = function (docname, gc = true) {
    return Yutils.getYDoc(this.Ydocs,docname,gc);
  }

  /*
  * Node methods
  */
  if ($tw.node) {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    // A polyfilL to make this work with older node installs

    // START POLYFILL
    const reduce = Function.bind.call(Function.call, Array.prototype.reduce);
    const isEnumerable = Function.bind.call(Function.call, Object.prototype.propertyIsEnumerable);
    const concat = Function.bind.call(Function.call, Array.prototype.concat);
    const keys = Reflect.ownKeys;

    if (!Object.values) {
      Object.values = function values(O) {
        return reduce(keys(O), (v, k) => concat(v, typeof k === 'string' && isEnumerable(O, k) ? [O[k]] : []), []);
      };
    }
    // END POLYFILL

    /*
      Node init
    */
    Bob.prototype.serverSide = function () {
      // Initialise the scriptQueue objects ???
      this.scriptQueue = {};
      this.scriptActive = {};
      this.childproc = false;
      // Initialise the $tw.Bob.settings object & load the user settings
      this.settings = JSON.parse($tw.wiki.getTiddler('$:/plugins/OokTech/Bob/DefaultSettings').fields.text || "{}");
      this.loadSettings(this.settings, $tw.boot.wikiPath);
      // Load the RootWiki
      this.loadWiki("RootWiki");
    }

    // Settings Methods

    /*
      Parse the default settings file and the normal user settings file
      This function modifies the input settings object with the properties in the
      json file at newSettingsPath
    */
    Bob.prototype.loadSettings = function (settings, bootPath) {
      const newSettingsPath = path.join(bootPath, 'settings', 'settings.json');
      let newSettings;
      if (typeof $tw.ExternalServer !== 'undefined') {
        newSettings = require(path.join(process.cwd(), 'LoadConfig.js')).settings;
      } else {
        if ($tw.node && !fs) {
          const fs = require('fs')
        }
        let rawSettings;
        // try/catch in case defined path is invalid.
        try {
          rawSettings = fs.readFileSync(newSettingsPath);
        } catch (err) {
          console.log('NodeSettings - No settings file, creating one with default values.');
          rawSettings = '{}';
        }
        // Try to parse the JSON after loading the file.
        try {
          newSettings = JSON.parse(rawSettings);
          console.log('NodeSettings - Parsed raw settings.');
        } catch (err) {
          console.log('NodeSettings - Malformed user settings. Using empty default.');
          console.log('NodeSettings - Check settings. Maybe comma error?');
          // Create an empty default settings.
          newSettings = {};
        }
      }
      // Extend the default with the user settings & normalize the wiki objects
      this.updateSettings(settings, newSettings);
      this.updateSettingsWikiPaths(settings.wikis);
      // Get the ip address to make it easier for other computers to connect.
      const ip = require('./External/IP/ip.js');
      const ipAddress = ip.address();
      settings.serverInfo = {
        name: settings.serverName,
        ipAddress: ipAddress,
        protocol: !!settings["tls-key"] && !!!settings["tls-cert"]? "https": "http",
        port: settings['ws-server'].port || "8080",
        host: settings['ws-server'].host || "127.0.0.1"
      }
    }

    /*
      Given a local and a global settings, this returns the global settings but with
      any properties that are also in the local settings changed to the values given
      in the local settings.
      Changes to the settings are later saved to the local settings.
    */
    Bob.prototype.updateSettings = function (globalSettings, localSettings) {
      /*
      Walk though the properties in the localSettings, for each property set the global settings equal to it, 
      but only for singleton properties. Don't set something like 
      GlobalSettings.Accelerometer = localSettings.Accelerometer, instead set 
      GlobalSettings.Accelerometer.Controller = localSettings.Accelerometer.Contorller
      */
      let self = this;
      Object.keys(localSettings).forEach(function (key, index) {
        if (typeof localSettings[key] === 'object') {
          if (!globalSettings[key]) {
            globalSettings[key] = {};
          }
          //do this again!
          self.updateSettings(globalSettings[key], localSettings[key]);
        } else {
          globalSettings[key] = localSettings[key];
        }
      });
    }

    /*
      This allows people to add wikis using name: path in the settings.json and
      still have them work correctly with the name: {path: path} setup.

      It takes the wikis section of the settings and changes any entries that are
      in the form name: path and puts them in the form name: {path: path}, and
      recursively walks through all the wiki entries.
    */
    Bob.prototype.updateSettingsWikiPaths = function (inputObj) {
      let self = this;
      Object.keys(inputObj).forEach(function (entry) {
        if (typeof inputObj[entry] === 'string') {
          inputObj[entry] = { 'path': inputObj[entry] }
        } else if (typeof inputObj[entry] === 'object' && !!inputObj[entry].wikis) {
          self.updateSettingsWikiPaths(inputObj[entry].wikis)
        }
      })
    }

    /*
      Creates initial settings tiddlers for the wiki.
    */
    Bob.prototype.createStateTiddlers = function (data, instance) {
      // Create the $:/ServerIP tiddler
      let pluginTiddlers = {
        "$:/state/Bob/ServerIP": {
          title: "$:/state/Bob/ServerIP",
          text: this.settings.serverInfo.ipAddress,
          protocol: this.settings.serverInfo.protocol,
          port: this.settings.serverInfo.port,
          host: this.settings.serverInfo.host
        }
      }
      if (typeof instance.wikiInfo === 'object') {
        // Get plugin list
        const fieldsPluginList = {
          title: '$:/state/Bob/ActivePluginList',
          list: $tw.utils.stringifyList(instance.wikiInfo.plugins)
        }
        pluginTiddlers['$:/state/Bob/ActivePluginList'] = fieldsPluginList;
        
        const fieldsThemesList = {
          title: '$:/state/Bob/ActiveThemesList',
          list: $tw.utils.stringifyList(instance.wikiInfo.themes)
        }
        pluginTiddlers['$:/state/Bob/ActiveThemesList'] = fieldsThemesList;
        
        const fieldsLanguagesList = {
          title: '$:/state/Bob/ActiveLanguagesList',
          list: $tw.utils.stringifyList(instance.wikiInfo.languages)
        }
        pluginTiddlers['$:/state/Bob/ActiveLanguagesList'] = fieldsLanguagesList;
      }
      const message = {
        type: 'saveTiddler',
        wiki: data.wiki,
        tiddler: {
          fields: {
            title: "$:/state/Bob",
            type: "application/json",
            "plugin-type": "plugin",
            text: JSON.stringify({tiddlers: pluginTiddlers}) 
          }
        }
      };
      this.wsManager.getSession(data.sessionId).sendMessage(message);
    }

    // Wiki methods

    /*
      This function loads a tiddlywiki instance, starts the given wiki and calls any callback.
    */
    Bob.prototype.loadWiki = function (wikiName, cb) {
      const settings = this.getWikiSettings(wikiName);
      let wikiPath = this.wikiExists(settings.path);
      // Make sure it isn't loaded already
      if (!!wikiPath && !this.Wikis.has(wikiName)) {
        try {
          let instance = (wikiName == 'RootWiki') ? $tw : require("./boot.js").TiddlyWiki();
          if (wikiName == 'RootWiki') {

          } else {
              // Pass the command line arguments to the boot kernel
              instance.boot.argv = ["+plugins/" + settings.syncadaptor, wikiPath];
              // Boot the TW5 app
              instance.boot.boot();
          }
          // Name the wiki
          instance.wikiName = wikiName;
          const fields = {
            title: '$:/WikiName',
            text: wikiName
          };
          instance.wiki.addTiddler(new $tw.Tiddler(fields));

          // Setup the Ydocs for the wiki
          let wikiDoc = this.getYDoc(wikiName);
          
          // Setup the FileSystemMonitors
          /*
          // Make sure that the tiddlers folder exists
          const error = $tw.utils.createDirectory($tw.Bob.Wikis[wikiName].wikiTiddlersPath);
          if(error){
            $tw.Bob.logger.error('Error creating wikiTiddlersPath', error, {level:1});
          }
          // Recursively build the folder tree structure
          $tw.Bob.Wikis[wikiName].FolderTree = buildTree('.', $tw.Bob.Wikis[wikiName].wikiTiddlersPath, {});
          if($tw.Bob.settings.disableFileWatchers !== 'yes') {
            // Watch the root tiddlers folder for chanegs
            $tw.Bob.WatchAllFolders($tw.Bob.Wikis[wikiName].FolderTree, wikiName);
          }
          */
          // Set the wiki as loaded
          this.Wikis.set(wikiName,instance);
          $tw.hooks.invokeHook('wiki-loaded',wikiName);
        } catch (err) {
          if (typeof cb === 'function') {
            cb(err);
          } else {
            console.error(err);
            return err;
          }
        }
      }
      if (typeof cb === 'function') {
        cb(null, this.getWikiPath(wikiName));
      } else {
        return this.getWikiPath(wikiName);
      }
    }

    /*
      Return the resolved filePathRoot
    */
    Bob.prototype.getFilePathRoot = function () {
      const currPath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      let basePath = '';
      this.settings.filePathRoot = this.settings.filePathRoot || './files';
      if (this.settings.filePathRoot === 'cwd') {
        basePath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      } else if (this.settings.filePathRoot === 'homedir') {
        basePath = os.homedir();
      } else {
        basePath = path.resolve(currPath, this.settings.filePathRoot);
      }
    }

    /*
      Return the resolved basePath
    */
    Bob.prototype.getBasePath = function () {
      const currPath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      let basePath = '';
      this.settings.wikiPathBase = this.settings.wikiPathBase || 'cwd';
      if (this.settings.wikiPathBase === 'homedir') {
        basePath = os.homedir();
      } else if (this.settings.wikiPathBase === 'cwd' || !this.settings.wikiPathBase) {
        basePath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
      } else {
        basePath = path.resolve(currPath, this.settings.wikiPathBase);
      }
      return basePath;
    }

    /*
      Given a wiki name this generates the path for the wiki.
    */
    Bob.prototype.generateWikiPath = function (wikiName) {
      const basePath = this.getBasePath();
      return path.resolve(basePath, this.settings.wikisPath, wikiName);
    }

    /*
      Given a wiki name this gets the wiki path if one is listed, if the wiki isn't
      listed this returns undefined.
      This can be used to determine if a wiki is listed or not.
    */
    Bob.prototype.getWikiPath = function (wikiName) {
      let wikiSettings = this.getWikiSettings(wikiName), wikiPath = undefined;
      if (wikiSettings) {
        wikiPath = wikiSettings.path;
      }
      // If the wikiPath exists convert it to an absolute path
      if (typeof wikiPath !== 'undefined') {
        const basePath = this.getBasePath()
        wikiPath = path.resolve(basePath, this.settings.wikisPath, wikiPath);
      }
      return wikiPath;
    }

    /*
      Given a wiki name this gets the wiki settings object if one is listed, 
      if the wiki isn't listed this returns undefined.
      This can be used to determine if a wiki is listed or not.
    */
    Bob.prototype.getWikiSettings = function (wikiName) {
      let wikiSettings = undefined;
      if (wikiName == 'RootWiki') {
        wikiSettings = {
          path: path.resolve($tw.boot.wikiPath),
          admin: this.settings["ws-server"].admin,
          readers: this.settings["ws-server"].readers,
          writers: this.settings["ws-server"].writers,
          syncadaptor: this.settings["ws-server"].syncadaptor
        }
      } else if (typeof this.settings.wikis[wikiName] === 'object') {
        wikiSettings = this.settings.wikis[wikiName];
      } else {
        const parts = wikiName.split('/');
        let settings, obj = this.settings.wikis;
        for (let i = 0; i < parts.length; i++) {
          if (obj[parts[i]]) {
            if (i === parts.length - 1 && typeof obj[parts[i]] === 'object') {
              settings = obj[parts[i]];
            } else if (!!obj[parts[i]].wikis) {
              obj = obj[parts[i]].wikis;
            }
          } else {
            break;
          }
        }
        if (!!settings) {
          wikiSettings = settings;
        }
      }
      if (!wikiSettings.syncadaptor) {
        // Set the default syncadaptor
        wikiSettings.syncadaptor = this.settings["ws-server"].syncadaptor;
      }
      return wikiSettings;
    }

    /*
      This checks to make sure there is a tiddlwiki.info file in a wiki folder
      If so, the full wikipath is returned, else false is returned.
    */
    Bob.prototype.wikiExists = function (wikiFolder) {
      let exists = false;
      // Make sure that the wiki actually exists
      if (wikiFolder) {
        const basePath = this.getBasePath()
        // This is a bit hacky to get around problems with loading the root wiki
        // This tests if the wiki is the root wiki and ignores the other pathing
        // bits
        if (wikiFolder === $tw.boot.wikiPath) {
          wikiFolder = path.resolve($tw.boot.wikiPath)
        } else {
          // Get the correct path to the tiddlywiki.info file
          wikiFolder = path.resolve(basePath, this.settings.wikisPath, wikiFolder);
          // Make sure it exists
        }
        exists = fs.existsSync(path.resolve(wikiFolder, 'tiddlywiki.info'));
      }
      return exists? wikiFolder: false;
    }

    // End Node methods
  } else {
    // Polyfill because IE uses old javascript
    if(!String.prototype.startsWith) {
      String.prototype.startsWith = function(search, pos) {
        return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
      };
    }
  }

  exports.Bob = Bob;

})();