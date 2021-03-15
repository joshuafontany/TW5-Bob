/*\
title: $:/plugins/OokTech/Bob/ServerSide.js
type: application/javascript
module-type: library

This is server functions that can be shared between different server types

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */

let ServerSide = {};

const path = require('path');
const fs = require('fs');
const os = require('os');

// A polyfilL to make this work with older node installs

// START POLYFILL
const reduce = Function.bind.call(Function.call, Array.prototype.reduce);
const isEnumerable = Function.bind.call(Function.call, Object.prototype.propertyIsEnumerable);
const concat = Function.bind.call(Function.call, Array.prototype.concat);
const keys = Reflect.ownKeys;

if(!Object.values) {
  Object.values = function values(O) {
    return reduce(keys(O), (v, k) => concat(v, typeof k === 'string' && isEnumerable(O, k) ? [O[k]] : []), []);
  };
}
// END POLYFILL

/*
  Return the resolved filePathRoot
*/
ServerSide.getFilePathRoot= function() {
  const currPath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
  let basePath = '';
  $tw.Bob.settings.filePathRoot = $tw.Bob.settings.filePathRoot || './files';
  if($tw.Bob.settings.filePathRoot === 'cwd') {
    basePath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
  } else if($tw.Bob.settings.filePathRoot === 'homedir') {
    basePath = os.homedir();
  } else {
    basePath = path.resolve(currPath, $tw.Bob.settings.filePathRoot);
  }
}

/*
  Return the resolved basePath
*/
ServerSide.getBasePath = function() {
  const currPath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
  let basePath = '';
  $tw.Bob.settings.wikiPathBase = $tw.Bob.settings.wikiPathBase || 'cwd';
  if($tw.Bob.settings.wikiPathBase === 'homedir') {
    basePath = os.homedir();
  } else if($tw.Bob.settings.wikiPathBase === 'cwd' || !$tw.Bob.settings.wikiPathBase) {
    basePath = path.parse(process.argv[0]).name !== 'node' ? path.dirname(process.argv[0]) : process.cwd();
  } else {
    basePath = path.resolve(currPath, $tw.Bob.settings.wikiPathBase);
  }
  return basePath;
}

/*
  Given a wiki name this generates the path for the wiki.
*/
ServerSide.generateWikiPath = function(wikiName) {
  const basePath = $tw.ServerSide.getBasePath();
  return path.resolve(basePath, $tw.Bob.settings.wikisPath, wikiName);
}

/*
  Given a wiki name this gets the wiki path if one is listed, if the wiki isn't
  listed this returns undefined.
  This can be used to determine if a wiki is listed or not.
*/
ServerSide.getWikiPath = function(wikiName) {
  let wikiSettings = ServerSide.getWikiSettings(wikiName), wikiPath = undefined;
  if(wikiSettings) {
    wikiPath = wikiSettings.path;
  }
  // If the wikiPath exists convert it to an absolute path
  if(typeof wikiPath !== 'undefined') {
    const basePath = ServerSide.getBasePath()
    wikiPath = path.resolve(basePath, $tw.Bob.settings.wikisPath, wikiPath);
  }
  return wikiPath;
}

/*
  Given a wiki name this gets the wiki settings object if one is listed, 
  if the wiki isn't listed this returns undefined.
  This can be used to determine if a wiki is listed or not.
*/
ServerSide.getWikiSettings = function(wikiName) {
  let wikiSettings = undefined;
  if (wikiName == 'RootWiki') {
    wikiSettings = {
      path: path.resolve($tw.boot.wikiPath),
      admin: $tw.Bob.settings["ws-server"].admin,
      readers: $tw.Bob.settings["ws-server"].readers,
      writers: $tw.Bob.settings["ws-server"].writers,
      syncadaptor: $tw.Bob.settings["ws-server"].syncadaptor
    }
  } else if(typeof $tw.Bob.settings.wikis[wikiName] === 'object') {
    wikiSettings = $tw.Bob.settings.wikis[wikiName];
  } else {
    const parts = wikiName.split('/');
    let settings, obj = $tw.Bob.settings.wikis;
    for (let i = 0; i < parts.length; i++) {
      if(obj[parts[i]]) {
        if(i === parts.length - 1 && typeof obj[parts[i]] === 'object') {
            settings = obj[parts[i]];
        } else if(!!obj[parts[i]].wikis) {
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
  if(!wikiSettings.syncadaptor) {
    // Set the default syncadaptor
    wikiSettings.syncadaptor = $tw.Bob.settings["ws-server"].syncadaptor;
  }
  return wikiSettings;
}

/*
  This checks to make sure there is a tiddlwiki.info file in a wiki folder
*/
ServerSide.wikiExists = function(wikiFolder) {
  let exists = false;
  // Make sure that the wiki actually exists
  if(wikiFolder) {
    const basePath = $tw.ServerSide.getBasePath()
    // This is a bit hacky to get around problems with loading the root wiki
    // This tests if the wiki is the root wiki and ignores the other pathing
    // bits
    if(wikiFolder === $tw.boot.wikiPath) {
      wikiFolder = path.resolve($tw.boot.wikiPath)
    } else {
      // Get the correct path to the tiddlywiki.info file
      wikiFolder = path.resolve(basePath, $tw.Bob.settings.wikisPath, wikiFolder);
      // Make sure it exists
    }
    exists = fs.existsSync(path.resolve(wikiFolder, 'tiddlywiki.info'));
  }
  return exists;
}

/*
  This checks to make sure that a wiki exists
*/
ServerSide.existsListed = function(wikiName) {
  if(typeof wikiName !== 'string') {
    return false;
  }
  let exists = false;
  // First make sure that the wiki is listed
  const settings = ServerSide.getWikiSettings(wikiName);
  // Make sure that the wiki actually exists
  exists = ServerSide.wikiExists(settings.path);
  if(exists) {
    return settings.path;
  } else {
    return exists;
  }
}

/*
  This function loads a tiddlywiki instance, starts the given wiki and calls any callback.
*/
ServerSide.loadWiki = function(wikiName, cb) {
  const settings = ServerSide.getWikiSettings(wikiName);
  // Make sure it isn't loaded already
  if(settings && !$tw.Bob.Wikis.has(wikiName)) {
    try{
      let instance = (wikiName == 'RootWiki')? $tw: require("./boot.js").TiddlyWiki();
      if(wikiName == 'RootWiki') {

      } else {
        // Pass the command line arguments to the boot kernel
        instance.boot.argv = ["+plugins/"+settings.syncadaptor,settings.path];
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
      $tw.Bob.Wikis.set(wikiName,(wikiName == 'RootWiki')? true : instance);
      $tw.hooks.invokeHook('wiki-loaded', wikiName);
    } catch(err) {
      if(typeof cb === 'function') {
        cb(err);
      } else {
        return err;
      }
    }
  }
  if(typeof cb === 'function') {
    cb(null, wikiName);
  } else {
    return ServerSide.getWikiPath(wikiName);
  }
}

/*
path: path of wiki directory
options:
  parentPaths: array of parent paths that we mustn't recurse into
  readOnly: true if the tiddler file paths should not be retained
*/
function loadWikiTiddlers(wikiPath,options) {
  options = options || {};
  const wikiName = options.wikiName || '';
  const parentPaths = options.parentPaths || [];
  const wikiInfoPath = path.resolve(wikiPath,$tw.config.wikiInfo);
  let wikiInfo;
  let pluginFields;
  // Bail if we don't have a wiki info file
  if(fs.existsSync(wikiInfoPath)) {
    try {
      wikiInfo = JSON.parse(fs.readFileSync(wikiInfoPath,"utf8"));
    } catch (e) {
      $tw.Bob.logger.error('Error reading wiki info', e, {level:1});
      return null;
    }
  } else {
    return null;
  }
  // Save the wikiTiddlersPath for the MultiWikiAdaptor
  let config = wikiInfo.config || {};
  $tw.Bob.Wikis[wikiName].wikiTiddlersPath = path.resolve($tw.Bob.Wikis[wikiName].wikiPath,config["default-tiddler-location"] || $tw.config.wikiTiddlersSubDir);
  // Load any parent wikis
  if(wikiInfo.includeWikis) {
    $tw.Bob.logger.log('Load Wiki: includeWikis!', {level:1});
    parentPaths = parentPaths.slice(0);
    parentPaths.push(wikiPath);
    $tw.utils.each(wikiInfo.includeWikis,function(info) {
      if(typeof info === "string") {
        info = {path: info};
      }
      var resolvedIncludedWikiPath = path.resolve(wikiPath,info.path);
      if(parentPaths.indexOf(resolvedIncludedWikiPath) === -1) {
        var subWikiInfo = loadWikiTiddlers(resolvedIncludedWikiPath,{
          parentPaths: parentPaths,
          readOnly: info["read-only"]
        });
        // Merge the build targets
        wikiInfo.build = $tw.utils.extend([],subWikiInfo.build,wikiInfo.build);
      } else {
        $tw.utils.error("Cannot recursively include wiki " + resolvedIncludedWikiPath);
      }
    });
  }
  // Load any plugins, themes and languages listed in the wiki info file
  loadPlugins(wikiInfo.plugins,$tw.config.pluginsPath,$tw.config.pluginsEnvVar, wikiName);
  loadPlugins(wikiInfo.themes,$tw.config.themesPath,$tw.config.themesEnvVar, wikiName);
  loadPlugins(wikiInfo.languages,$tw.config.languagesPath,$tw.config.languagesEnvVar, wikiName);
  // Load the wiki files, registering them as writable
  const resolvedWikiPath = path.resolve(wikiPath,$tw.config.wikiTiddlersSubDir);
  const exlcudePlugins = ['$:/plugins/tiddlywiki/tiddlyweb', '$:/plugins/tiddlywiki/filesystem'];
  function getTheseTiddlers() {
    let out = [];
    try {
      out = $tw.loadTiddlersFromPath(resolvedWikiPath);
    } catch(e) {
      $tw.Bob.logger.error("loadWikiTiddlers Error: ", e, {level:1});
    }
    return out;
  }
  $tw.utils.each(
    getTheseTiddlers(), function(tiddlerFile) {
      let use = true;
      if(!options.readOnly && tiddlerFile.filepath) {
        $tw.utils.each(tiddlerFile.tiddlers,function(tiddler) {
          if(exlcudePlugins.indexOf(tiddler.title) !== -1) {
            use = false;
          } else {
            $tw.Bob.Files[wikiName][tiddler.title] ={
              filepath: tiddlerFile.filepath,
              type: tiddlerFile.type,
              hasMetaFile: tiddlerFile.hasMetaFile,
              isEditableFile: config["retain-original-tiddler-path"] || tiddlerFile.isEditableFile || tiddlerFile.filepath.indexOf($tw.Bob.Wikis[wikiName].wikiTiddlersPath) !== 0
            };
          }
        });
      }
      if(!use) {
        //Walk the tiddler stack backwards, and splice out the unwanted plugins
        for (i = tiddlerFile.tiddlers - 1; i >= 0; --i) {
          if(exlcudePlugins.indexOf(tiddlerFile.tiddlers[i].title) !== -1) {
            tiddlerFile.tiddlers.splice(i, 1); //Remove the excluded plugin
          }
        }
      }
      $tw.Bob.Wikis[wikiName].wiki.addTiddlers(tiddlerFile.tiddlers);
    }
  );
  if ($tw.Bob.Wikis[wikiName].wikiPath == wikiPath) {
    // Save the original tiddler file locations if requested
    var output = {}, relativePath, fileInfo;
    for(let title in $tw.Bob.Files[wikiName]) {
      fileInfo =  $tw.Bob.Files[wikiName][title];
      if(fileInfo.isEditableFile) {
        relativePath = path.relative($tw.Bob.Wikis[wikiName].wikiTiddlersPath,fileInfo.filepath);
        output[title] =
          path.sep === "/" ?
          relativePath :
          relativePath.split(path.sep).join("/");
      }
    }
    if(Object.keys(output).length > 0){
      $tw.Bob.Wikis[wikiName].wiki.addTiddler({title: "$:/config/OriginalTiddlerPaths", type: "application/json", text: JSON.stringify(output)});
    }
  }
  // Load any plugins within the wiki folder
  const wikiPluginsPath = path.resolve(wikiPath,$tw.config.wikiPluginsSubDir);
  if(fs.existsSync(wikiPluginsPath)) {
    try {
      const pluginFolders = fs.readdirSync(wikiPluginsPath);
      for(let t=0; t<pluginFolders.length; t++) {
        pluginFields = $tw.loadPluginFolder(path.resolve(wikiPluginsPath,"./" + pluginFolders[t]));
        if(pluginFields) {
          $tw.Bob.Wikis[wikiName].wiki.addTiddler(pluginFields);
        }
      }
    } catch (e) {
      $tw.Bob.logger.error('Error loading wiki plugin folder: ', e, {level:2});
    }
  }
  // Load any themes within the wiki folder
  const wikiThemesPath = path.resolve(wikiPath,$tw.config.wikiThemesSubDir);
  if(fs.existsSync(wikiThemesPath)) {
    try {
      const themeFolders = fs.readdirSync(wikiThemesPath);
      for(let t=0; t<themeFolders.length; t++) {
        pluginFields = $tw.loadPluginFolder(path.resolve(wikiThemesPath,"./" + themeFolders[t]));
        if(pluginFields) {
          $tw.Bob.Wikis[wikiName].wiki.addTiddler(pluginFields);
        }
      }
    } catch (e) {
      $tw.Bob.logger.error('Error loading wiki theme folder: ', e, {level:2});
    }
  }
  // Load any languages within the wiki folder
  const wikiLanguagesPath = path.resolve(wikiPath,$tw.config.wikiLanguagesSubDir);
  if(fs.existsSync(wikiLanguagesPath)) {
    try {
      const languageFolders = fs.readdirSync(wikiLanguagesPath);
      for(let t=0; t<languageFolders.length; t++) {
        pluginFields = $tw.loadPluginFolder(path.resolve(wikiLanguagesPath,"./" + languageFolders[t]));
        if(pluginFields) {
          $tw.Bob.Wikis[wikiName].wiki.addTiddler(pluginFields);
        }
      }
    } catch (e) {
      $tw.Bob.logger.error('Error loading wiki language folder: ', e, {level:2});
    }
  }
  return wikiInfo;
};

/*
wikiName: the wiki to check for unloaded module definitions
We only define modules that haven't already been defined, 
  because the exiting ones were defined by the RootWiki
  and reloading all of them would spam the server log.
*/
function defineTiddlerModules(wikiName) {
  $tw.Bob.Wikis[wikiName].wiki.each(function(tiddler,title) {
    if(tiddler.hasField("module-type") && !$tw.utils.hop($tw.modules.titles,tiddler.fields.title)) {
      switch (tiddler.fields.type) {
        case "application/javascript":
            $tw.modules.define(tiddler.fields.title,tiddler.fields["module-type"],tiddler.fields.text);
          break;
        case "application/json":
          $tw.modules.define(tiddler.fields.title,tiddler.fields["module-type"],JSON.parse(tiddler.fields.text));
          break;
        case "application/x-tiddler-dictionary":
          $tw.modules.define(tiddler.fields.title,tiddler.fields["module-type"],$tw.utils.parseFields(tiddler.fields.text));
          break;
      }
    }
  });
};

/*
wikiName: the wiki to check for unloaded shadow module definitions
We only define modules that haven't already been defined, 
  because the existing ones were defined by the RootWiki
  and reloading all of them would spam the server log.
*/
function defineShadowModules(wikiName) {
  $tw.Bob.Wikis[wikiName].wiki.eachShadow(function(tiddler,title) {
    // Don't define the module if it is overidden by an ordinary tiddler
    if(!$tw.Bob.Wikis[wikiName].wiki.tiddlerExists(title) && tiddler.hasField("module-type") && !$tw.utils.hop($tw.modules.titles,tiddler.fields.title)) {
      // Define the module
      $tw.modules.define(tiddler.fields.title,tiddler.fields["module-type"],tiddler.fields.text);
    }
  });
};

ServerSide.prepareWiki = function(fullName, servePlugin, cache='yes') {
  // Only rebuild the wiki if there have been changes since the last time it
  // was built, otherwise use the cached version.
  if(typeof $tw.Bob.Wikis[fullName].modified === 'undefined' || $tw.Bob.Wikis[fullName].modified === true || typeof $tw.Bob.Wikis[fullName].cached !== 'string') {
    $tw.Bob.Wikis[fullName].plugins = $tw.Bob.Wikis[fullName].plugins || [];
    $tw.Bob.Wikis[fullName].themes = $tw.Bob.Wikis[fullName].themes || [];
    $tw.Bob.Wikis[fullName].tiddlers = $tw.Bob.Wikis[fullName].tiddlers || [];
    if(servePlugin !== 'no') {
      // By default the normal file system plugins removed and the
      // multi-user plugin added instead so that they all work the same.
      // The wikis aren't actually modified, this is just hov they are
      // served.
      $tw.Bob.Wikis[fullName].plugins = $tw.Bob.Wikis[fullName].plugins.filter(function(plugin) {
        return plugin !== 'tiddlywiki/filesystem' && plugin !== 'tiddlywiki/tiddlyweb';
      });
      if($tw.Bob.Wikis[fullName].plugins.indexOf('$:/plugins/OokTech/Bob') === -1) {
        $tw.Bob.Wikis[fullName].plugins.push('$:/plugins/OokTech/Bob');
      }
    }
    $tw.Bob.settings.includePluginList = $tw.Bob.settings.includePluginList || [];
    $tw.Bob.settings.excludePluginList = $tw.Bob.settings.excludePluginList || [];
    // Add any plugins that should be included in every wiki
    const includeList = Object.values($tw.Bob.settings.includePluginList).filter(function(plugin) {
      return $tw.Bob.Wikis[fullName].plugins.indexOf(plugin) === -1;
    }).map(function(pluginName) {return '$:/plugins/'+pluginName;})
    $tw.Bob.Wikis[fullName].plugins = $tw.Bob.Wikis[fullName].plugins.concat(includeList);
    // Remove any plugins in the excluded list
    // The exclude list takes precidence over the include list
    $tw.Bob.Wikis[fullName].plugins = $tw.Bob.Wikis[fullName].plugins.filter(function(plugin) {
      return Object.values($tw.Bob.settings.excludePluginList).indexOf(plugin) === -1;
    })
    // Make sure that all the plugins are actually loaded.
    const missingPlugins = $tw.Bob.Wikis[fullName].plugins.filter(function(plugin) {
      return !$tw.Bob.Wikis[fullName].wiki.tiddlerExists(plugin);
    }).map(function(pluginTiddler) {
      return pluginTiddler.replace(/^\$:\/plugins\//, '')
    });
    if(missingPlugins.length > 0) {
      loadPlugins(missingPlugins,$tw.config.pluginsPath,$tw.config.pluginsEnvVar, fullName);
    }
    // This makes the wikiTiddlers variable a filter that lists all the
    // tiddlers for this wiki.
    const options = {
      variables: {
        wikiTiddlers:
          $tw.Bob.Wikis[fullName].wiki.allTitles().concat($tw.Bob.Wikis[fullName].plugins.concat($tw.Bob.Wikis[fullName].themes)).map(function(tidInfo) {
            if(servePlugin === 'no' && tidInfo === '$:/plugins/OokTech/Bob') {
              return '';
            } else {
              return '[[' + tidInfo + ']]';
            }
          }).join(' '),
        wikiName: fullName
      }
    };
    $tw.Bob.Wikis[fullName].wiki.addTiddler(new $tw.Tiddler({title: '$:/WikiName', text: fullName}))
    const text = $tw.Bob.Wikis[fullName].wiki.renderTiddler("text/plain", $tw.Bob.settings['ws-server'].rootTiddler || "$:/core/save/all", options);
    // Only cache the wiki if it isn't too big.
    if(text.length < 10*1024*1024 && cache !== 'no') {
      $tw.Bob.Wikis[fullName].cached = text;
      $tw.Bob.Wikis[fullName].modified = false;
    } else {
      return text;
    }
  }
  return $tw.Bob.Wikis[fullName].cached;
}

/*
plugins: Array of names of plugins (eg, "tiddlywiki/filesystemadaptor")
libraryPath: Path of library folder for these plugins (relative to core path)
envVar: Environment variable name for these plugins
*/
function loadPlugins(plugins,libraryPath,envVar, wikiName) {
  if(plugins) {
    const pluginPaths = $tw.getLibraryItemSearchPaths(libraryPath,envVar);
    for(let t=0; t<plugins.length; t++) {
      if(plugins[t] !== 'tiddlywiki/filesystem' && plugins[t] !== 'tiddlywiki/tiddlyweb') {
        loadPlugin(plugins[t],pluginPaths, wikiName);
      }
    }
  }
};

/*
name: Name of the plugin to load
paths: array of file paths to search for it
*/
function loadPlugin(name,paths, wikiName) {
  const pluginPath = $tw.findLibraryItem(name,paths);
  if(pluginPath) {
    const pluginFields = $tw.loadPluginFolder(pluginPath);
    if(pluginFields) {
      $tw.Bob.Wikis[wikiName].wiki.addTiddler(pluginFields);
    }
  }
};

/*
  This copies a folder from source to destination
  both source and destination are paths
  This uses absolute paths, so make sure you get them before passing them to
  this function.

  source - the folder to copy
  destination - the folder to create containing a copy of the source folder
  copyChildren - if set to true than any child wikis inside the source folder will be copied as well, otherwise no child wikis will be copied.
  cb - an optional callback function, it is passed source, destination and copyChildren as arguments

  note: The callback is called only once for the original function call, it
  isn't called for any of the recursive calls used for sub-directories.
*/
ServerSide.specialCopy = function(source, destination, copyChildren, cb) {
  let err = undefined;
  // Check to make sure inputs are what we expect
  if(typeof source !== 'string' || typeof destination !== 'string') {
    cb('The source or destination given is not a string.')
    return;
  }
  if(typeof copyChildren === 'function') {
    cb = copyChildren;
    copyChildren = false;
  } else if(typeof copyChildren === 'string') {
    copyChildren = (copyChildren==='true' || copyChildren === 'yes')?true:false;
  } else if(copyChildren !== true) {
    copyChildren = false;
  }
  try {
    fs.mkdirSync(destination, {recursive: true});
    const currentDir = fs.readdirSync(source)
    currentDir.forEach(function(item) {
      if(fs.statSync(path.join(source, item)).isFile()) {
        const fd = fs.readFileSync(path.join(source, item), {encoding: 'utf8'});
        fs.writeFileSync(path.join(destination, item), fd, {encoding: 'utf8'});
      } else {
        //Recurse!! Because it is a folder.
        // But make sure it is a directory first.
        if(fs.statSync(path.join(source, item)).isDirectory() && (!fs.existsSync(path.join(source, item, 'tiddlywiki.info')) || copyChildren)) {
          ServerSide.specialCopy(path.join(source, item), path.join(destination, item), copyChildren);
        }
      }
    });
  } catch (e) {
    err = e;
  }
  if(typeof cb === 'function') {
    cb(err, source, destination, copyChildren)
  } else {
    return err;
  }
}

/*
  Determine which sub-folders are in the current folder
*/
const getDirectories = function(source) {
  try {
    return fs.readdirSync(source).map(function(name) {
      return path.join(source,name)
    }).filter(function(source) {
      return fs.lstatSync(source).isDirectory();
    });
  } catch (e) {
    $tw.Bob.logger.error('Error getting directories', e, {level:2});
    return [];
  }
}
/*
  This recursively builds a tree of all of the subfolders in the tiddlers
  folder.
  This can be used to selectively watch folders of tiddlers.
*/
const buildTree = function(location, parent) {
  const folders = getDirectories(path.join(parent,location));
  let parentTree = {'path': path.join(parent,location), folders: {}};
  if(folders.length > 0) {
    folders.forEach(function(folder) {
      const apex = folder.split(path.sep).pop();
      parentTree.folders[apex] = {};
      parentTree.folders[apex] = buildTree(apex, path.join(parent,location));
    })
  }
  return parentTree;
}

/*
  This sends an alert to the connected browser(s)

  Who alerts are sent to can be filtered by:
  - wiki: only browsers that are viewing the listed wiki(s) receive the alert.
  - authentication level: only people who are logged in with one of the listed
      authentication levels gets the alerm.
  - specific connections: only the browser(s) using the listed connection(s)
      get the alert.

  or the alert can be sent to all connected browsers.

  {
    authentications: [authenticationLevel],
    wikis: [wikiName],
    connections: [connectionIndex],
    alert: alertMessage
  }

  wikis - an array of wiki names to send the alert to
  connections - an array of connection indicies to send the alert to
  alert - the text of the alert to send

  The authentications, wikis and connections can be combined so only people
  who meet all the listed criteria get the alert.

  NOTE: we don't have a good way to do these next ones for now, but we need to
  in the future.
  authentications - an array of authentication levels to receive the alert
  access - an array of wikis and access levels (like can view the wiki in
  question, or edit it)

  We can turn off browser messages
*/
ServerSide.sendBrowserAlert = function(input) {
  if($tw.Bob.settings.disableBrowserAlerts !== 'yes') {
    const message = {
      type:'browserAlert',
      alert: input.alert
    }
    input.wikis = input.wikis || [];
    input.connections = input.connections || [];
    input.authentications = input.authentications || [];
    input.alert = input.alert || '';
    if(input.alert.length > 0) {
      let wikisList = false;
      let connectionsList = false;
      let authenticationsList = false;
      if(input.connections.length > 0) {
        connectionsList = [];
        $tw.Bob.sessions.forEach(function(connection) {
          if(input.connections.indexOf(connection.index) !== -1) {
            connectionsList.push(connection.index);
          }
        });
      }
      if(input.wikis.length > 0) {
        wikisList = [];
        $tw.Bob.sessions.forEach(function(connection) {
          if(input.wikis.indexOf(connection.wiki) !== -1) {
            wikisList.push(connection.index);
          }
        })
      }
      if(input.authentications.length > 0) {
        // Nothing here yet
      }
      // Get the intersection of all of the things listed above to get the
      // connections to send this to.
      wikisListThing = wikisList || []
      connectionsListThing = connectionsList || []
      authenticationsListThing = authenticationsList || []
      if(wikisListThing.length > 0 || connectionsListThing.length > 0 || authenticationsListThing.length > 0) {
        let intersection = new Set([...connectionsListThing, ...wikisListThing, ...authenticationsListThing]);
        if(wikisList) {
          const wikiSet = new Set(wikisList);
          intersection = new Set([...intersection].filter(x => wikiSet.has(x)));
        }
        if(connectionsList) {
          const connectionsSet = new Set(connectionsList);
          intersection = new Set([...intersection].filter(x => connectionsSet.has(x)));
        }
        if(authenticationsList) {
          const authenticationsSet = new Set(authenticationsList);
          intersection = new Set([...intersection].filter(x => authenticationsSet.has(x)));
        }
        intersection.forEach(function(index) {
          message.wiki = $tw.Bob.sessions.wiki
          $tw.Bob.SendToBrowser($tw.Bob.sessions[index], message);
        });
      } else {
        $tw.Bob.logger.log('send message to all browsers', {level: 4})
        $tw.Bob.SendToBrowsers(message);
      }
    }
  }
}

ServerSide.getViewableWikiList = function(data) {
  data = data || {};
  function getList(obj, prefix) {
    let output = [];
    let ownedWikis = {};
    Object.keys(obj).forEach(function(item) {
      if(typeof obj[item] === 'string') {
        if($tw.ServerSide.existsListed(prefix+item)) {
          if(item == '__path') {
            if(prefix.endsWith('/')) {
              output.push(prefix.slice(0,-1));
            } else {
              output.push(prefix);
            }
          } else {
            output.push(prefix+item);
          }
        }
      } else if(typeof obj[item] === 'object' && item !== '__permissions') {
        output = output.concat(getList(obj[item], prefix + item + '/'));
      }
    })
    if (prefix === '') {
      output.push('RootWiki')
    }
    return output;
  }
  // Get the wiki list of wiki names from the settings object
  const wikiList = getList($tw.Bob.settings.wikis, '');
  const viewableWikis = [];
  wikiList.forEach(function(wikiName) {
    if($tw.Bob.wsServer.AccessCheck(wikiName, {"authenticated": data.authenticated}, 'view', 'wiki')) {
      viewableWikis.push(wikiName);
    }
  });
  const tempObj = {};
  for (let i = 0; i < viewableWikis.length; i++) {
    tempObj[viewableWikis[i]] = ['view'];
    // Check if you can edit it
    if($tw.Bob.wsServer.AccessCheck(viewableWikis[i], {"authenticated": data.authenticated}, 'edit', 'wiki')) {
      tempObj[viewableWikis[i]].push('edit');
    }
  }
  return tempObj;
}

ServerSide.getViewablePluginsList = function(data) {
  data = data || {};
  const viewablePlugins = [];
  const pluginList = $tw.utils.getPluginInfo();
  if($tw.Bob.settings.pluginLibrary.allPublic === 'yes') {
    return pluginList;
  }
  Object.keys(pluginList).forEach(function(pluginName) {
    if($tw.Bob.wsServer.AccessCheck(pluginName, {"authenticated": data.authenticated}, 'view', 'plugin')) {
      viewablePlugins[pluginName] = pluginList[pluginName];
    }
  })
  return viewablePlugins;
}

ServerSide.getViewableThemesList = function(data) {
  data = data || {};
  const viewableThemes = [];
  const themeList = $tw.utils.getThemeInfo();
  if($tw.Bob.settings.themeLibrary.allPublic === 'yes') {
    return themeList;
  }
  Object.keys(themeList).forEach(function(themeName) {
    if($tw.Bob.wsServer.AccessCheck(themeName, {"authenticated": data.authenticated}, 'view', 'theme')) {
      viewableThemes[themeName] = themeList[themeName];
    }
  })
  return viewableThemes;
}

ServerSide.getViewableEditionsList = function(data) {
  // This may not be needed anymore
  if(typeof $tw.Bob.settings.editionsPath === 'string') {
    const basePath = $tw.ServerSide.getBasePath();
    // We need to make sure this doesn't overwrite existing thing
    const fullEditionsPath = path.resolve(basePath, $tw.Bob.settings.editionsPath);
    if(process.env["TIDDLYWIKI_EDITION_PATH"] !== undefined && process.env["TIDDLYWIKI_EDITION_PATH"] !== '') {
      process.env["TIDDLYWIKI_EDITION_PATH"] = process.env["TIDDLYWIKI_EDITION_PATH"] + path.delimiter + fullEditionsPath;
    } else {
      process.env["TIDDLYWIKI_EDITION_PATH"] = fullEditionsPath;
    }
  }
  data = data || {};
  const viewableEditions = {};
  const editionList =  $tw.utils.getEditionInfo();
  if($tw.Bob.settings.editionLibrary.allPublic === 'yes') {
    return editionList;
  }
  Object.keys(editionList).forEach(function(editionName) {
    if($tw.Bob.wsServer.AccessCheck(editionName, {"authenticated": data.authenticated}, 'view', 'edition')) {
      Object.keys(editionList).forEach(function(index) {
        viewableEditions[index] = editionList[index].description;
      });
    }
  })
  return viewableEditions;
}

ServerSide.getViewableLanguagesList = function(data) {
  data = data || {};
  const viewableLanguages = {};
  const languageList =  $tw.utils.getLanguageInfo();
  Object.keys(languageList).forEach(function(languageName) {
    if($tw.Bob.wsServer.AccessCheck(languageName, {"authenticated": data.authenticated}, 'view', 'edition')) {
      Object.keys(languageList).forEach(function(index) {
        viewableLanguages[index] = languageList[index].description;
      });
    }
  })
  return viewableLanguages;
}



ServerSide.getProfileInfo = function(data) {
  $tw.Bob.settings.profiles = $tw.Bob.settings.profiles || {};
  if ($tw.Bob.wsServer.AccessCheck(data.profileName, {"authenticated": data.authenticated}, 'view', 'profile')) {
    return $tw.Bob.settings.profiles[data.profileName] || {};
  } else {
    return {};
  }
}

ServerSide.listProfiles = function(data) {
  $tw.Bob.settings.profiles = $tw.Bob.settings.profiles || {};
  const result = {};
  Object.keys($tw.Bob.settings.profiles).forEach(function(profileName) {
    if ($tw.Bob.wsServer.AccessCheck(profileName, data, 'view', 'profile') || $tw.Bob.wsServer.AccessCheck(profileName, data, 'view/anyProfile', 'server')) {
      result[profileName] = $tw.Bob.settings.profiles[profileName]
    }
  })
  return result;
}

ServerSide.getOwnedWikis = function(data) {
  function getList(obj, prefix) {
    let output = [];
    Object.keys(obj).forEach(function(item) {
      if(typeof obj[item] === 'string') {
        if($tw.ServerSide.existsListed(prefix+item)) {
          if(item == '__path') {
            if(prefix.endsWith('/')) {
              output.push(prefix.slice(0,-1));
            } else {
              output.push(prefix);
            }
          } else {
            output.push(prefix+item);
          }
        }
      } else if(typeof obj[item] === 'object' && item !== '__permissions') {
        output = output.concat(getList(obj[item], prefix + item + '/'));
      }
    })
    return output;
  }
  function wikiInfo(wikiName) {
    let thisObj = $tw.Bob.settings.wikis;
    wikiName.split('/').forEach(function(part) {
      thisObj = thisObj[part];
    })
    return thisObj.__permissions;
  }
  // Get the list of wiki names from the settings object
  const wikiList = getList($tw.Bob.settings.wikis, '');
  const ownedWikis = {};
  wikiList.forEach(function(wikiName) {
    if($tw.Bob.wsServer.AccessCheck(wikiName, {"authenticated": data.authenticated}, 'owner', 'wiki')) {
      ownedWikis[wikiName] = wikiInfo(wikiName);
    }
  });
  return ownedWikis;
}

ServerSide.findName = function(url) {
  url = url.startsWith('/') ? url.slice(1,url.length) : url;
  const pieces = url.split('/')
  let name = ''
  let settingsObj = $tw.Bob.settings.wikis[pieces[0]]
  if(settingsObj) {
    name = pieces[0]
  }
  for (let i = 1; i < pieces.length; i++) {
    if(settingsObj) {
      if(typeof settingsObj[pieces[i]] === 'object') {
        name = name + '/' + pieces[i]
        settingsObj = settingsObj[pieces[i]]
      } else if(typeof settingsObj[pieces[i]] === 'string') {
        name = name + '/' + pieces[i]
        break
      } else {
        break
      }
    }
  }
  if(name === '' && pieces[0] === 'RootWiki') {
    name = 'RootWiki'
  }
  return name
}

ServerSide.listFiles = function(data, cb) {
  const path = require('path');
  const fs = require('fs');
  const authorised = $tw.Bob.wsServer.AccessCheck(data.wiki, {"authenticated":data.authenticated}, 'listFiles', 'wiki');

  if(authorised) {
    $tw.Bob.settings.fileURLPrefix = $tw.Bob.settings.fileURLPrefix || 'files';
    data.folder = data.folder || $tw.Bob.settings.fileURLPrefix;
    data.folder = data.folder.startsWith('/') ? data.folder : '/' + data.folder;
    const wikiName = data.wiki || $tw.ServerSide.findName(data.folder);
    const repRegex = new RegExp(`^\/?.+?\/?${$tw.Bob.settings.fileURLPrefix}\/?`)
    const thePath = data.folder.replace(repRegex, '').replace(/^\/*/,'');
    let fileFolder
    if(thePath === '' && wikiName === '') {
      // Globally available files in filePathRoot
      const filePathRoot = $tw.ServerSide.getFilePathRoot();
      fileFolder = path.resolve($tw.ServerSide.getBasePath(), filePathRoot);
      // send to browser
      next(fileFolder, '');
    } else if(wikiName === '' && $tw.Bob.settings.servingFiles[thePath]) {
      // Explicitly listed folders that are globally available
      fileFolder = $tw.Bob.settings.servingFiles[thePath];
      // send to browser
      next(fileFolder, thePath);
    } else if(wikiName !== '') {
      // Wiki specific files, need to check to make sure that if perwikiFiles is set this only works from the target wiki.
      if($tw.Bob.settings.perWikiFiles !== 'yes' || wikiName === data.wiki) {
        const wikiPath = $tw.ServerSide.existsListed(wikiName);
        if(!wikiPath) {
          return;
        }
        fileFolder = path.join(wikiPath, 'files');
        next(fileFolder, thePath, wikiName);
      }
    } else {
      const testPaths = [path.resolve($tw.ServerSide.getBasePath())].concat( Object.values($tw.Bob.settings.servingFiles));
      let ind = 0
      nextTest(0, testPaths)
      function nextTest(index, pathsToTest) {
        // If the path isn't listed in the servingFiles thing check if it is a child of one of the paths, or of the filePathRoot
        const filePathRoot = $tw.ServerSide.getFilePathRoot();
        let test = path.resolve($tw.ServerSide.getBasePath(), filePathRoot, pathsToTest[index]);
        fs.access(test, fs.constants.F_OK, function(err) {
          if(err) {
            if(index < pathToTest.length - 1) {
              nextTest(index + 1, pathsToTest);
            }
          } else {
            // send the list to the browser
            next(test, pathsToTest[index]);
          }
        })
      }
    }
    function next(folder, urlPath, wikiName) {
      wikiName = wikiName || '';
      // if the folder listed in data.folder is either a child of the filePathRoot or if it is a child of one of the folders listed in the $tw.Bob.settings.servingFiles thing we will continue, otherwise end.
      const filePathRoot = $tw.ServerSide.getFilePathRoot();
      const usedPaths = Object.values($tw.Bob.settings.servingFiles).map(function(item) {
          return path.resolve($tw.ServerSide.getBasePath(), filePathRoot, item)
        });
      const resolvedPath = path.resolve($tw.ServerSide.getBasePath(), filePathRoot, folder);
      let match = false;
      if(authorised) {
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
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.weba': 'audio/weba',
          '.webm': 'video/webm',
          '.wav': 'audio/wav'
        };
        const extList = data.mediaTypes || false;
        let prefix = path.join(wikiName, $tw.Bob.settings.fileURLPrefix, urlPath);
        prefix = prefix.startsWith('/') ? prefix : '/' + prefix;
        prefix = prefix.endsWith('/') ? prefix : prefix + '/';
        fs.readdir(resolvedPath, function(err, items) {
          if(err || !items) {
            $tw.Bob.logger.error("Can't read files folder ", resolvedPath, " with error ", err, {level: 1});
            cb(prefix, [], urlPath);
          } else {
            // filter the list to only include listed mimetypes.
            let filteredItems = items.filter(function(item) {
              const splitItem = item.split('.');
              const ext = splitItem[splitItem.length-1];
              return typeof mimeMap['.' + ext] === 'string';
            })
            if(extList) {
              filteredItems = filteredItems.filter(function(item) {
                const splitItem = item.split('.');
                const ext = splitItem[splitItem.length-1];
                return typeof extList.indexOf('.' + ext) !== -1;
              })
            }
            // Reply with the list
            $tw.Bob.logger.log("Scanned ", resolvedPath, " for files, returned ", filteredItems, {level: 3});
            cb(prefix, filteredItems, urlPath);
          }
        });
      }
    }
  } else {
    cb("", [], "");
  }
}

function deleteDirectory(dir) {
  const fs = require('fs');
  const path = require('path');
  return new Promise(function(resolve, reject) {
    // Check to make sure that dir is in the place we expect
    if(dir.startsWith($tw.ServerSide.getBasePath())) {
      fs.access(dir, function(err) {
        if(err) {
          if(err.code === 'ENOENT') {
            return resolve();
          }
          return reject(err);
        }
        fs.readdir(dir, function(err, files) {
          if(err) {
            return reject(err);
          }
          Promise.all(files.map(function(file) {
            return deleteFile(dir, file);
          })).then(function() {
            fs.rmdir(dir, function(err) {
              if(err) {
                return reject(err);
              }
              resolve();
            });
          }).catch(reject);
        });
      });
    } else {
      reject('The folder is not in expected pace!');
    }
  });
};

function deleteFile(dir, file) {
  const fs = require('fs');
  const path = require('path');
  return new Promise(function(resolve, reject) {
    //Check to make sure that dir is in the place we expect
    if(dir.startsWith($tw.ServerSide.getBasePath())) {
      const filePath = path.join(dir, file);
      fs.lstat(filePath, function(err, stats) {
        if(err) {
          return reject(err);
        }
        if(stats.isDirectory()) {
          resolve(deleteDirectory(filePath));
        } else {
          fs.unlink(filePath, function(err) {
            if(err) {
              return reject(err);
            }
            resolve();
          });
        }
      });
    } else {
      reject('The folder is not in expected place!');
    }
  });
};

ServerSide.deleteWiki = function(data, cb) {
  const path = require('path')
  const fs = require('fs')
  const authorised = $tw.Bob.wsServer.AccessCheck(data.deleteWiki, {"authenticated":data.authenticated}, 'delete', 'wiki');
  // Make sure that the wiki exists and is listed
  if($tw.ServerSide.existsListed(data.deleteWiki) && authorised) {
    $tw.Bob.unloadWiki(data.deleteWiki);
    const wikiPath = $tw.ServerSide.getWikiPath(data.deleteWiki);
    if(data.deleteChildren === 'yes') {
      deleteDirectory(wikiPath).then(function() {
        cb();
      }).catch(function(e) {
        cb(e);
      }).finally(function() {
        ServerSide.updateWikiListing();
      })
    } else {
      // Delete the tiddlywiki.info file
      fs.unlink(path.join(wikiPath, 'tiddlywiki.info'), function(e) {
        if(e) {
          $tw.Bob.logger.error('failed to delete tiddlywiki.info',e, {level:1});
          cb(e);
          ServerSide.updateWikiListing();
        } else {
          // Delete the tiddlers folder (if any)
          deleteDirectory(path.join(wikiPath, 'tiddlers')).then(function() {
            $tw.utils.deleteEmptyDirs(wikiPath,function() {
              cb();
            });
          }).catch(function(e){
            cb(e);
          }).finally(function() {
            ServerSide.updateWikiListing();
          })
        }
      })
    }
  }
}


/*
  This updates the server wiki listing, it is just the server task that checks
  to see if there are any unlisted wikis and that the currently listed wikis
  edist, so it doesn't need any authentication.

  This function checks to make sure all listed wikis exist and that all wikis
  it can find are listed.
  Then it saves the settings file to reflect the changes.
*/
ServerSide.updateWikiListing = function(data) {
  data = data || {update:'true',remove:'true',saveSettings:true};
  // This gets the paths of all wikis listed in the settings
  function getWikiPaths(settingsObject, outPaths) {
    const settingsKeys = Object.keys(settingsObject);
    outPaths = outPaths || [];
    settingsKeys.forEach(function(thisKey) {
      if(thisKey === '__path') {
        // its one of the paths we want
        outPaths.push(path.resolve(basePath, $tw.Bob.settings.wikisPath, settingsObject[thisKey]));
      } else if(thisKey === '__permissions') {
        // Ignore it
      } else if(typeof settingsObject[thisKey] === 'object') {
        // Recurse
        outPaths = getWikiPaths(settingsObject[thisKey], outPaths);
      }
    })
    return outPaths
  }
  // This gets a list of all wikis in the wikis folder and subfolders
  function getRealPaths(startPath) {
    // Check each folder in the wikis folder to see if it has a
    // tiddlywiki.info file
    let realFolders = [];
    try {
      const folderContents = fs.readdirSync(startPath);
      folderContents.forEach(function(item) {
        const fullName = path.join(startPath, item);
        if(fs.statSync(fullName).isDirectory()) {
          if($tw.ServerSide.wikiExists(fullName)) {
            realFolders.push(fullName);
          }
          // Check if there are subfolders that contain wikis and recurse
          const nextPath = path.join(startPath,item)
          if(fs.statSync(nextPath).isDirectory()) {
            realFolders = realFolders.concat(getRealPaths(nextPath));
          }
        }
      })
    } catch (e) {
      $tw.Bob.logger.log('Error getting wiki paths', e, {level:1});
    }
    return realFolders;
  }
  // This takes the list of wikis in the settings and returns a new object
  // without any of the non-existent wikis listed
  function pruneWikiList(dontExistList, settingsObj) {
    let prunedSettings = {};
    Object.keys(settingsObj).forEach(function(wikiName) {
      if(typeof settingsObj[wikiName] === 'string') {
        // Check if the wikiName resolves to one of the things to remove
        if(dontExistList.indexOf(path.resolve(wikiFolderPath, settingsObj[wikiName])) === -1) {
          // If the wiki isn't listed as not existing add it to the prunedSettings
          prunedSettings[wikiName] = settingsObj[wikiName];
        }
      } else if(typeof settingsObj[wikiName] === 'object') {
        if(Object.keys(settingsObj[wikiName]).length > 0) {
          const temp = pruneWikiList(dontExistList, settingsObj[wikiName]);
          if(Object.keys(temp).length > 0) {
            prunedSettings[wikiName] = temp;
          }
        }
      }
    })
    return prunedSettings;
  }
  const fs = require('fs');
  const path = require('path');
  const basePath = $tw.ServerSide.getBasePath();
  
  let wikiFolderPath = path.resolve(basePath, $tw.Bob.settings.wikisPath);
  // Make sure that the wikiFolderPath exists
  const error = $tw.utils.createDirectory(path.resolve(basePath, $tw.Bob.settings.wikisPath));
  // Check each folder in the wikis folder to see if it has a tiddlywiki.info
  // file.
  // If there is no tiddlywiki.info file it checks sub-folders.
  const realFolders = getRealPaths(wikiFolderPath);
  // If it does check to see if any listed wiki has the same path, if so skip
  // it
  let alreadyListed = [];
  const listedWikis = getWikiPaths($tw.Bob.settings.wikis);
  realFolders.forEach(function(folder) {
    // Check is the wiki is listed
    if(listedWikis.indexOf(folder) > -1) {
      alreadyListed.push(folder);
    }
  })
  let wikisToAdd = realFolders.filter(function(folder) {
    return alreadyListed.indexOf(folder) === -1;
  })
  wikisToAdd = wikisToAdd.map(function(thisPath) {
    return path.relative(wikiFolderPath,thisPath);
  })
  const dontExist = listedWikis.filter(function(folder) {
    return !$tw.ServerSide.wikiExists(folder);
  })
  data.update = data.update || ''
  if(typeof data.update !== 'string') {
    data.update = (data.update === true)?'true':''
  }
  if(data.update.toLowerCase() === 'true') {
    wikisToAdd.forEach(function(wikiName) {
      if($tw.ExternalServer) {
        if(typeof $tw.ExternalServer.initialiseWikiSettings === 'function') {
          // This adds unlisted wikis as private and without giving them an
          // owner, so an admin needs to set the owner and stuff.
          $tw.ExternalServer.initialiseWikiSettings(wikiName, {});
        }
      } else {
        const nameParts = wikiName.split('/');
        let settingsObj = $tw.Bob.settings.wikis;
        let i;
        for (i = 0; i < nameParts.length; i++) {
          if(typeof settingsObj[nameParts[i]] === 'object' && i < nameParts.length - 1) {
            settingsObj = settingsObj[nameParts[i]];
          } else if(i < nameParts.length - 1) {
            settingsObj[nameParts[i]] = settingsObj[nameParts[i]] || {};
            settingsObj = settingsObj[nameParts[i]]
          } else {
            settingsObj[nameParts[i]] = settingsObj[nameParts[i]] || {};
            settingsObj[nameParts[i]].path = nameParts.join('/');
          }
        }
      }
    })
  }
  if(typeof data.remove !== 'string') {
    data.remove = (data.remove === false)?'false':'true'
  }
  if(data.remove.toLowerCase() === 'true') {
    // update the wikis listing in the settings with a version that doesn't
    // have the wikis that don't exist.
    $tw.Bob.settings.wikis = pruneWikiList(dontExist, $tw.Bob.settings.wikis);
  }
  // Save the new settings, update routes, update settings tiddlers in the
  // browser and update the list of available wikis
  if(data.saveSettings) {
    data.fromServer = true;
    $tw.Bob.wsServer.messageHandlers.saveSettings(data);
    $tw.Bob.wsServer.messageHandlers.updateRoutes(data);
  }
}

$tw.stopFileWatchers = function(wikiName) {
  // Close any file watchers that are active for the wiki
  if($tw.Bob.Wikis[wikiName]) {
    if($tw.Bob.Wikis[wikiName].watchers) {
      Object.values($tw.Bob.Wikis[wikiName].watchers).forEach(function(thisWatcher) {
        thisWatcher.close();
      })
    }
  }
}


ServerSide.renameWiki = function(data, cb) {
  const path = require('path')
  const fs = require('fs')
  const authorised = $tw.Bob.wsServer.AccessCheck(data.fromWiki, {"authenticated":data.authenticated}, 'rename', 'wiki');
  if($tw.ServerSide.existsListed(data.oldWiki) && !$tw.ServerSide.existsListed(data.newWiki) && authorised) {
    // Unload the old wiki
    $tw.Bob.unloadWiki(data.oldWiki);
    const basePath = $tw.ServerSide.getBasePath();
    const oldWikiPath = $tw.ServerSide.getWikiPath(data.oldWiki);
    const newWikiPath = path.resolve(basePath, $tw.Bob.settings.wikisPath, data.newWiki);
    fs.rename(oldWikiPath, newWikiPath, function(e) {
      if(e) {
        $tw.Bob.logger.log('failed to rename wiki',e,{level:1});
        cb(e);
      } else {
        // Refresh wiki listing
        data.update = 'true';
        data.saveSettings = 'true';
        $tw.ServerSide.updateWikiListing(data);
        cb();
      }
    })
  }
}


/*
  This ensures that the wikiName used is unique by appending a number to the
  end of the name and incrementing the number if needed until an unused name
  is created.
  If on name is given it defualts to NewWiki
*/
function GetWikiName (wikiName, count, wikiObj, fullName) {
  let updatedName;
  count = count || 0;
  wikiName = wikiName || ''
  if(wikiName.trim() === '') {
    wikiName = 'NewWiki'
  }
  fullName = fullName || wikiName || 'NewWiki';
  wikiObj = wikiObj || $tw.Bob.settings.wikis;
  const nameParts = wikiName.split('/');
  if(nameParts.length === 1) {
    updatedName = nameParts[0];
    if(wikiObj[updatedName]) {
      if(wikiObj[updatedName].path) {
        count = count + 1;
        while (wikiObj[updatedName + String(count)]) {
          if(wikiObj[updatedName + String(count)].path) {
            count = count + 1;
          } else {
            break;
          }
        }
      }
    }
    if(count > 0) {
      return fullName + String(count);
    } else {
      return fullName;
    }
  } else if(!wikiObj[nameParts[0]]) {
    if(count > 0) {
      return fullName + String(count);
    } else {
      return fullName;
    }
  }
  if(nameParts.length > 1) {
    if(wikiObj[nameParts[0]]) {
      return GetWikiName(nameParts.slice(1).join('/'), count, wikiObj[nameParts[0]], fullName);
    } else {
      return fullName;
    }
  } else {
    return undefined
  }
}

ServerSide.createWiki = function(data, cb) {
  const authorised = $tw.Bob.wsServer.AccessCheck('create/wiki', {"authenticated": data.authenticated}, 'create/wiki', 'server');
  const quotasOk = $tw.Bob.wsServer.CheckQuotas(data, 'wiki');
  if(authorised && quotasOk) {
    const fs = require("fs"),
      path = require("path");
    $tw.Bob.settings.wikisPath = $tw.Bob.settings.wikisPath || 'Wikis';
    // if we are using namespaced wikis prepend the logged in profiles name to
    // the wiki name.
    const name = ($tw.Bob.settings.namespacedWikis === 'yes') ? GetWikiName((data.authenticated.name || 'imaginaryPerson') + '/' + (data.wikiName || data.newWiki || 'NewWiki')) : GetWikiName(data.wikiName || data.newWiki);
    const basePath = data.basePath || $tw.ServerSide.getBasePath();
    const destination = path.resolve(basePath, $tw.Bob.settings.wikisPath, name);
    $tw.utils.createDirectory(path.join(basePath, $tw.Bob.settings.wikisPath));
    if(data.nodeWikiPath) {
      // This is just adding an existing node wiki to the listing
      addListing(name, data.nodeWikiPath);
      data.fromServer = true;
      $tw.Bob.wsServer.messageHandlers.saveSettings(data);
      finish();
    } else if(data.tiddlers || data.externalTiddlers) {
      data.tiddlers = data.tiddlers || data.externalTiddlers;
      // Create a wiki using tiddlers sent from the browser, this is what is
      // used to create wikis from existing html files.
      // Start with an empty edition
      const searchPaths = $tw.getLibraryItemSearchPaths($tw.config.editionsPath,$tw.config.editionsEnvVar);
      const editionPath = $tw.findLibraryItem('empty',searchPaths);
      const err = $tw.ServerSide.specialCopy(editionPath, destination, true);
      $tw.utils.createDirectory(path.join(basePath, $tw.Bob.settings.wikisPath, name));
      for(let i = 0; i < data.tiddlers.length; i++) {
        $tw.syncadaptor.getTiddlerFileInfo(new $tw.Tiddler(tiddler.fields), name,
        function(err,fileInfo) {
          $tw.utils.saveTiddlerToFileSync(new $tw.Tiddler(data.tiddlers[i]), fileInfo)
        })
      }
      finish();
    } else if(data.fromWiki) {
      // Duplicate a wiki
      // Make sure that the wiki to duplicate exists and that the target wiki
      // name isn't in use
      if($tw.ServerSide.existsListed(data.fromWiki)) {
        // Get the paths for the source and destination
        const source = $tw.ServerSide.getWikiPath(data.fromWiki);
        data.copyChildren = data.copyChildren || 'no';
        const copyChildren = data.copyChildren.toLowerCase() === 'yes'?true:false;
        // Make the duplicate
        $tw.ServerSide.specialCopy(source, destination, copyChildren, function() {
          // Refresh wiki listing
          data.update = 'true';
          data.saveSettings = 'true';
          $tw.ServerSide.updateWikiListing(data);
          $tw.Bob.logger.log('Duplicated wiki', data.fromWiki, 'as', name, {level: 2})
          finish();
        });
      }
    } else {
      // Paths are relative to the root wiki path
      // This is the path given by the person making the wiki, it needs to be
      // relative to the basePath
      // data.wikisFolder is an optional sub-folder to use. If it is set to
      // Wikis than wikis created will be in the basepath/Wikis/relativePath
      // folder I need better names here.
      // For now we only support creating wikis with one edition, multi edition
      // things like in the normal init command can come later.
      const editionName = data.edition?data.edition:"empty";
      const searchPaths = $tw.getLibraryItemSearchPaths($tw.config.editionsPath,$tw.config.editionsEnvVar);
      const editionPath = $tw.findLibraryItem(editionName,searchPaths);
      // Copy the edition content
      const err = $tw.ServerSide.specialCopy(editionPath, destination, true);
      if(!err) {
        $tw.Bob.logger.log("Copied edition '" + editionName + "' to " + destination + "\n", {level:2});
      } else {
        $tw.Bob.logger.error(err, {level:1});
      }
      // Tweak the tiddlywiki.info to remove any included wikis
      const packagePath = path.join(destination, "tiddlywiki.info");
      let packageJson = {};
      try {
        packageJson = JSON.parse(fs.readFileSync(packagePath));
      } catch (e) {
        $tw.Bob.logger.error('failed to load tiddlywiki.info file', e, {level:1});
      }
      delete packageJson.includeWikis;
      try {
        fs.writeFileSync(packagePath,JSON.stringify(packageJson,null,$tw.config.preferences.jsonSpaces));
      } catch (e) {
        $tw.Bob.logger.error('failed to write tiddlywiki.info ', e, {level:1})
      }
      finish();
    }

    function finish() {
      // This is here as a hook for an external server. It is defined by the
      // external server and shouldn't be defined here or it will break
      // If you are not using an external server than this does nothing
      if($tw.ExternalServer) {
        if(typeof $tw.ExternalServer.initialiseWikiSettings === 'function') {
          const relativePath = path.relative(path.join(basePath, data.wikisFolder),destination);
          $tw.ExternalServer.initialiseWikiSettings(relativePath, data);
        }
      }

      setTimeout(function() {
        data.update = 'true';
        data.saveSettings = 'true';
        $tw.ServerSide.updateWikiListing(data);
        if(typeof cb === 'function') {
          setTimeout(cb, 1500);
        }
      }, 1000);
    }
  }
}

/*
  This updates the list of tiddlers being edited in each wiki. Any tiddler on
  this list has the edit button disabled to prevent two people from
  simultaneously editing the same tiddler.
  If run without an input it just re-sends the lists to each browser, with a
  tiddler title as input it appends that tiddler to the list and sends the
  updated list to all connected browsers.

  For privacy and security only the tiddlers that are in the wiki a
  conneciton is using are sent to that connection.
*/
ServerSide.UpdateEditingTiddlers = function(tiddler, wikiName) {
  // Make sure that the wiki is loaded
  const exists = $tw.ServerSide.loadWiki(wikiName);
  // This should never be false, but then this shouldn't every have been a
  // problem to start.
  if(exists) {
    // Check if a tiddler title was passed as input and that the tiddler isn't
    // already listed as being edited.
    // If there is a title and it isn't being edited add it to the list.
    if(tiddler && !$tw.Bob.EditingTiddlers[wikiName][tiddler]) {
      $tw.Bob.EditingTiddlers[wikiName][tiddler] = true;
    }
    Object.keys($tw.Bob.sessions).forEach(function(index) {
      if($tw.Bob.sessions[index].wiki === wikiName) {
        $tw.Bob.EditingTiddlers[wikiName] = $tw.Bob.EditingTiddlers[wikiName] || {};
        const list = Object.keys($tw.Bob.EditingTiddlers[wikiName]);
        const message = {type: 'updateEditingTiddlers', list: list, wiki: wikiName};
        $tw.Bob.SendToBrowser($tw.Bob.sessions[index], message);
        $tw.Bob.logger.log('Update Editing Tiddlers', {level: 4})
      }
    });
  }
}
/*
  This keeps a history of changes for each wiki so that when a wiki is
  disconnected and reconnects and asks to resync this can be used to resync
  the wiki with the minimum amount of network traffic.

  Resyncing only needs to keep track of creating and deleting tiddlers here.
  The editing state of tiddlers is taken care of by the websocket
  reconnection process.

  So this is just the list of deleted tiddlers and saved tiddlers with time
  stamps, and it should at most have one item per tiddler because the newest
  save or delete message overrides any previous messages.

  The hisotry is an array of change entries
  Each entry in the history is in the form
  {
    title: tiddlerTitle,
    timestamp: changeTimeStamp,
    type: messageType
  }
*/
$tw.Bob.UpdateHistory = function(message) {
  // Only save saveTiddler or deleteTiddler events that have a wiki listed
  if(['saveTiddler', 'deleteTiddler'].indexOf(message.type) !== -1 && message.wiki) {
    $tw.Bob.ServerHistory = $tw.Bob.ServerHistory || {};
    $tw.Bob.ServerHistory[message.wiki] = $tw.Bob.ServerHistory[message.wiki] || [];
    const entryIndex = $tw.Bob.ServerHistory[message.wiki].findIndex(function(entry) {
      return entry.title === message.tiddler.fields.title;
    })
    const entry = {
      timestamp: Date.now(),
      title: message.tiddler.fields.title,
      type: message.type
    }
    if(entryIndex > -1) {
      $tw.Bob.ServerHistory[message.wiki][entryIndex] = entry;
    } else {
      $tw.Bob.ServerHistory[message.wiki].push(entry);
    }
  }
}

/*
  This is a wrapper function that takes a message that is meant to be sent to
  all connected browsers and handles the details.

  It iterates though all connections, checks if each one is active, tries to
  send the message, if the sending fails than it sets the connection as
  inactive.

  Note: This checks if the message is a string despite SendToBrowser also
  checking because if it needs to be changed and sent to multiple browsers
  changing it once here instead of once per browser should be better.
*/
$tw.Bob.SendToBrowsers = function(message, excludeConnection) {
  $tw.Bob.UpdateHistory(message);
  const messageData = $tw.utils.createMessageData(message);

  $tw.Bob.sessions.forEach(function(connection, ind) {
    if((ind !== excludeConnection) && connection.socket) {
      if(connection.socket.readyState === 1 && (connection.wiki === message.wiki || !message.wiki)) {
        $tw.utils.sendMessage(message, connection.index, messageData);
      }
    }
  })
}

/*
  This function sends a message to a single connected browser. It takes the
  browser connection object and the stringifyed message as input.
  If any attempt fails mark the connection as inacive.

  On the server side the history is a bit more complex.
  There is one history of messages sent that has the message ids, each
  connection has a list of message ids that are still waiting for acks.
*/
$tw.Bob.SendToBrowser = function(connection, message) {
  if(connection) {
    $tw.Bob.UpdateHistory(message);
    const messageData = $tw.utils.createMessageData(message);
    if(connection.socket) {
      if(connection.socket.readyState === 1 && (connection.wiki === message.wiki || !message.wiki)) {
        $tw.utils.sendMessage(message, connection.index, messageData);
      }
    }
  }
}

/*
  This disconnects all connections that are for a specific wiki. this is used
  when unloading a wiki to make sure that people aren't trying to interact
  with a disconnected wiki.
*/
$tw.Bob.DisconnectWiki = function(wiki) {
  $tw.Bob.sessions.forEach(function(connectionIndex) {
    if(connectionIndex.wiki === wiki) {
      if(connectionIndex.socket !== undefined) {
        // Close the websocket connection
        connectionIndex.socket.terminate();
      }
    }
  })
}

$tw.Bob.unloadWiki = function(wikiName) {
  if(wikiName) {
    $tw.Bob.logger.log('Unload wiki ', wikiName, {level:1});
    $tw.stopFileWatchers(wikiName);
    // Make sure that the wiki is loaded
    if($tw.Bob.Wikis[wikiName]) {
      if($tw.Bob.Wikis[wikiName].State === 'loaded') {
        // If so than unload the wiki
        // This removes the information about the wiki and the wiki object
        delete $tw.Bob.Wikis[wikiName];
        // This removes all the info about the files for the wiki
        delete $tw.Bob.Files[wikiName];
      }
    }
    $tw.Bob.DisconnectWiki(wikiName);
  }
}

/*
  This checks to see if a wiki has no connected sockets and if not it unloads
  the wiki.
*/
$tw.Bob.PruneConnections = function() {
  if($tw.Bob.settings.autoUnloadWikis === "true") {
    $tw.Bob.sessions.forEach(function(connection) {
      if(connection.socket !== undefined) {
        if(connection.socket.readyState !== 1) {
          connection.socket.terminate();
          connection.socket = undefined;
        }
      }
    })
  }
}

// Settings Methods

/*
  Parse the default settings file and the normal user settings file
  This function modifies the input settings object with the properties in the
  json file at newSettingsPath
*/
ServerSide.loadSettings = function(settings,bootPath) {
  const newSettingsPath = path.join(bootPath, 'settings', 'settings.json');
  let newSettings;
  if(typeof $tw.ExternalServer !== 'undefined') {
    newSettings = require(path.join(process.cwd(),'LoadConfig.js')).settings;
  } else {
    if($tw.node && !fs) {
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
  $tw.ServerSide.updateSettings(settings,newSettings);
  $tw.ServerSide.updateSettingsWikiPaths(settings.wikis);
  // Get the ip address to make it easier for other computers to connect.
  const ip = require('$:/plugins/OokTech/Bob/External/IP/ip.js');
  const ipAddress = ip.address();
  settings.serverInfo = {
    name: settings.serverName,
    ipAddress: ipAddress,
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
ServerSide.updateSettings = function(globalSettings,localSettings) {
  /*
  Walk though the properties in the localSettings, for each property set the global settings equal to it, 
  but only for singleton properties. Don't set something like 
  GlobalSettings.Accelerometer = localSettings.Accelerometer, instead set 
  GlobalSettings.Accelerometer.Controller = localSettings.Accelerometer.Contorller
  */
  Object.keys(localSettings).forEach(function(key,index){
    if(typeof localSettings[key] === 'object') {
      if(!globalSettings[key]) {
        globalSettings[key] = {};
      }
      //do this again!
      $tw.ServerSide.updateSettings(globalSettings[key], localSettings[key]);
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
ServerSide.updateSettingsWikiPaths = function(inputObj) {
  Object.keys(inputObj).forEach(function(entry) {
    if(typeof inputObj[entry] === 'string') {
      inputObj[entry] = {'path': inputObj[entry]}
    } else if(typeof inputObj[entry] === 'object' && !!inputObj[entry].wikis) {
      ServerSide.updateSettingsWikiPaths(inputObj[entry].wikis)
    }
  })
}

/*
  Creates initial settings tiddlers for the wiki.
*/
ServerSide.CreateSettingsTiddlers = function(data) {
  data = data || {}
  data.wiki = data.wiki || 'RootWiki'

  // Create the $:/ServerIP tiddler
  const message = {
    type: 'saveTiddler',
    wiki: data.wiki
  };
  message.tiddler = {fields: {title: "$:/ServerIP", text: $tw.Bob.settings.serverInfo.ipAddress, port: $tw.Bob.settings.serverInfo.port, host: $tw.Bob.settings.serverInfo.host}};
  $tw.Bob.SendToBrowser($tw.Bob.sessions[data.source_connection], message);

  let wikiInfo = undefined
  try {
    // Save the lists of plugins, languages and themes in tiddlywiki.info
    const wikiInfoPath = path.join($tw.Bob.Wikis[data.wiki].wikiPath, 'tiddlywiki.info');
    wikiInfo = JSON.parse(fs.readFileSync(wikiInfoPath,"utf8"));
  } catch(e) {
    console.log(e)
  }
  if(typeof wikiInfo === 'object') {
    // Get plugin list
    const fieldsPluginList = {
      title: '$:/Bob/ActivePluginList',
      list: $tw.utils.stringifyList(wikiInfo.plugins)
    }
    message.tiddler = {fields: fieldsPluginList};
    $tw.Bob.SendToBrowser($tw.Bob.sessions[data.source_connection], message);
    const fieldsThemesList = {
      title: '$:/Bob/ActiveThemesList',
      list: $tw.utils.stringifyList(wikiInfo.themes)
    }
    message.tiddler = {fields: fieldsThemesList};
    $tw.Bob.SendToBrowser($tw.Bob.sessions[data.source_connection], message);
    const fieldsLanguagesList = {
      title: '$:/Bob/ActiveLanguagesList',
      list: $tw.utils.stringifyList(wikiInfo.languages)
    }
    message.tiddler = {fields: fieldsLanguagesList};
    $tw.Bob.SendToBrowser($tw.Bob.sessions[data.source_connection], message);
  }
}

module.exports = ServerSide

})();
