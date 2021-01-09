/*\
title: $:/plugins/OokTech/Bob/MultiWikiAdaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor module for synchronising multiple wikis

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.platforms = ["node"];

if($tw.node) {

  // Get a reference to the file system
  const fs = require("fs"),
    path = require("path"),
    util = require("util");

  $tw.Bob = $tw.Bob || {};
  $tw.Bob.Files = $tw.Bob.Files || {};

  /*
    TODO Create a message that lets us set excluded tiddlers from inside the wikis
    A per-wiki exclude list would be best but that is going to have annoying
    logic so it will come later.
  */
  $tw.Bob.ExcludeFilter = $tw.Bob.ExcludeFilter || "[prefix[$:/state/]][prefix[$:/temp/]][prefix[$:/HistoryList]][prefix[$:/WikiSettings]][[$:/status/UserName]][[$:/Import]][[$:/plugins/OokTech/Bob/Server Warning]]";


  function MultiWikiAdaptor(options) {
    
  }

  MultiWikiAdaptor.prototype.name = "MultiWikiAdaptor";

  MultiWikiAdaptor.prototype.isReady = function() {
    // The file system adaptor is always ready
    return true;
  };

  MultiWikiAdaptor.prototype.getTiddlerInfo = function(tiddler, prefix) {
    //Returns the existing fileInfo for the tiddler. To regenerate, call getTiddlerFileInfo().
    prefix = prefix || '';
    $tw.Bob.Files[prefix] = $tw.Bob.Files[prefix] || {};
    var title = tiddler.fields.title;
    return $tw.Bob.Files[prefix][title] || {};
  };

  /*
  Return a fileInfo object for a tiddler, creating it if necessary:
    filepath: the absolute path to the file containing the tiddler
    type: the type of the tiddler file (NOT the type of the tiddler -- see below)
    hasMetaFile: true if the file also has a companion .meta file

  The boot process populates $tw.Bob.Files[prefix][title] for each of the tiddler files that it loads.
  The type is found by looking up the extension in $tw.config.fileExtensionInfo (eg "application/x-tiddler" for ".tid" files).

  It is the responsibility of the filesystem adaptor to update $tw.Bob.Files[prefix][title] for new files that are created.
  */
  MultiWikiAdaptor.prototype.getTiddlerFileInfo = function(tiddler, prefix, callback) {
    prefix = prefix || 'RootWiki';
    if(typeof prefix === "function") {
      callback = prefix;
      prefix = "RootWiki";
    }
    if(!callback) {
      callback = function (err, fileInfo) {
        if(err) {
          $tw.Bob.logger.error(err, {level:2});
        } else {
          return fileInfo;
        }
      }
    }
    const tiddlersPath = $tw.Bob.Wikis[prefix].wikiTiddlersPath;
    // Always generate a fileInfo object when this fuction is called
    var title = tiddler.fields.title, newInfo, pathFilters, extFilters;
    if($tw.Bob.Wikis[prefix].wiki.tiddlerExists("$:/config/FileSystemPaths")){
      pathFilters = $tw.Bob.Wikis[prefix].wiki.getTiddlerText("$:/config/FileSystemPaths","").split("\n");
    }
    if($tw.Bob.Wikis[prefix].wiki.tiddlerExists("$:/config/FileSystemExtensions")){
      extFilters = $tw.Bob.Wikis[prefix].wiki.getTiddlerText("$:/config/FileSystemExtensions","").split("\n");
    }
    newInfo = $tw.utils.generateTiddlerFileInfo(tiddler,{
      directory: tiddlersPath,
      pathFilters: pathFilters,
      extFilters: extFilters,
      wiki: $tw.Bob.Wikis[prefix].wiki,
      fileInfo: $tw.Bob.Files[prefix][title],
      originalpath: $tw.Bob.Wikis[prefix].wiki.extractTiddlerDataItem("$:/config/OriginalTiddlerPaths",title, "")
    });
    callback(null,newInfo);
  };

  /*
  Given a tiddler title and a options object, generate a fileInfo object but do not save it.
  Make sure that the wiki exists before calling this.
  */
  MultiWikiAdaptor.prototype.generateCustomFileInfo = function(title, options) {
    options = options || {};
    const prefix = options.prefix || '';
    // Always generate a fileInfo object when this fuction is called
    var tiddler = $tw.Bob.Wikis[prefix].wiki.getTiddler(title) || $tw.newTiddler({title: title}), newInfo, pathFilters, extFilters;
    if($tw.Bob.Wikis[prefix].wiki.tiddlerExists("$:/config/FileSystemPaths")){
      pathFilters = options.pathFilters || $tw.Bob.Wikis[prefix].wiki.getTiddlerText("$:/config/FileSystemPaths","").split("\n");
    }
    if($tw.Bob.Wikis[prefix].wiki.tiddlerExists("$:/config/FileSystemExtensions")){
      extFilters = options.extFilters || $tw.Bob.Wikis[prefix].wiki.getTiddlerText("$:/config/FileSystemExtensions","").split("\n");
    }
    newInfo = $tw.utils.generateTiddlerFileInfo(tiddler,{
      directory: options.directory,
      pathFilters: pathFilters,
      extFilters: extFilters,
      wiki: $tw.Bob.Wikis[prefix].wiki,
      fileInfo: $tw.Bob.Files[prefix][title],
      originalpath: $tw.Bob.Wikis[prefix].wiki.extractTiddlerDataItem("$:/config/OriginalTiddlerPaths",title, "")
    });
    return newInfo;
  };

  /*
  Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
  */
  MultiWikiAdaptor.prototype.saveTiddler = function(tiddler, options, callback) {
    if(!!callback && typeof callback !== "function"){
      var optionsArg = callback;
    }
    if(typeof options === "function"){
      callback = options;
      options = optionsArg || {};
    }
    const self = this;
    const prefix = options.prefix || 'RootWiki';
    const connectionInd = Number.isInteger(+options.connectionInd) ? options.connectionInd : null;
    self.adaptorInfo = self.adaptorInfo || {};
    self.adaptorInfo[prefix] = self.adaptorInfo[prefix] || {};
    let promiseLoadWiki = util.promisify($tw.ServerSide.loadWiki);
    let promiseGetTiddlerFileInfo = util.promisify(self.getTiddlerFileInfo);
    let promiseSaveTiddlerToFile = util.promisify($tw.utils.saveTiddlerToFile);
    let promiseCleanupTiddlerFiles = util.promisify($tw.utils.cleanupTiddlerFiles);
    promiseLoadWiki(prefix)
      .then(prefix => {
        if(tiddler.fields && $tw.Bob.Wikis[prefix].wiki.filterTiddlers($tw.Bob.ExcludeFilter).indexOf(tiddler.fields.title) === -1) {
          tiddler = new $tw.Tiddler(tiddler.fields);
          self.adaptorInfo[prefix][tiddler.fields.title] = $tw.utils.extend(Object.create(null), self.getTiddlerInfo(tiddler, prefix));
          self.internalSave(tiddler, prefix, connectionInd);
          return promiseGetTiddlerFileInfo(tiddler, prefix)
        }
      })
      .then(fileInfo => {
        $tw.Bob.logger.log(`${prefix}[${connectionInd}] Save Tidder:`, tiddler.fields.title, {level:2});
        return promiseSaveTiddlerToFile(tiddler, fileInfo);
      })
      .then(fileInfo => {
        // Store the new file location
        $tw.Bob.Files[prefix][tiddler.fields.title] = fileInfo;
        // Cleanup duplicates if the file moved or changed extensions
        var options = {
          adaptorInfo: self.adaptorInfo[prefix][tiddler.fields.title] || {},
          bootInfo: fileInfo || {},
          title: tiddler.fields.title
        };
        return promiseCleanupTiddlerFiles(options);
      })
      .then(fileInfo => {
        debugger;
        self.adaptorInfo[prefix][tiddler.fields.title] = fileInfo;
        callback(null, fileInfo)
      })
      .catch(err => {
        debugger;
        $tw.Bob.logger.log(`${prefix}[${connectionInd}] Save Error:`, tiddler.fields.title, {level:2});
        if(err) {
          // If there's an error, exit without changing any internal wiki state
          $tw.Bob.logger.log('Error Saving Tiddler ', tiddler.fields.title, err, {level:1});
          if ((err.code == "EPERM" || err.code == "EACCES") && err.syscall == "open") {
            fileInfo = fileInfo || $tw.Bob.Files[prefix][tiddler.fields.title];
            fileInfo.writeError = true;
            $tw.Bob.Files[prefix][tiddler.fields.title] = fileInfo;
            tw.Bob.logger.log(`Sync failed for '${tiddler.fields.title}' and will be retried with encoded filepath`, encodeURIComponent(bootInfo.filepath), {level:1});
            return callback(err);
          } else {
            $tw.Bob.Files[prefix][tiddler.fields.title] = self.adaptorInfo[prefix][tiddler.fields.title]
            return callback(err);
          }
        }
    });
  }

  /*
  Internal save (in case it needs to be re-used). Make sure $tw.Bob.Wikis[prefix].wiki exists first.
  */
  MultiWikiAdaptor.prototype.internalSave = function(tiddler, prefix, connectionInd){
    // Only call wiki.addTiddler if the tiddler has changed.
    // Otherwise, changes initiated from the server's $tw.syncer will cause a save-loop-o-doom
    // because the tiddler has already been added and the changecount is incremented 
    // each time you call addTiddler
    if($tw.Bob.Shared.TiddlerHasChanged(tiddler, $tw.Bob.Wikis[prefix].wiki.getTiddler(tiddler.fields.title))) {
      $tw.Bob.Wikis[prefix].tiddlers = $tw.Bob.Wikis[prefix].tiddlers || [];
      $tw.Bob.Wikis[prefix].wiki.addTiddler(tiddler);
      if($tw.Bob.Wikis[prefix].tiddlers.indexOf(tiddler.fields.title) === -1) {
        $tw.Bob.Wikis[prefix].tiddlers.push(tiddler.fields.title);
      }
      const message = {
        type: 'saveTiddler',
        wiki: prefix,
        tiddler: {
          fields: tiddler.fields
        }
      };
      $tw.Bob.SendToBrowsers(message, connectionInd);
      //Mark as modified
      $tw.Bob.Wikis[prefix].modified = true;
      $tw.hooks.invokeHook('wiki-modified', prefix);
    }
  }

  /*
  Load a tiddler and invoke the callback with (err,tiddlerFields)

  We don't need to implement loading for the file system adaptor, because all the tiddler files will have been loaded during the boot process.
  */
  MultiWikiAdaptor.prototype.loadTiddler = function(title,options,callback) {
    if(!!callback && typeof callback !== "function"){
      var optionsArg = callback;
    }
    if(typeof options === "function"){
      callback = options;
      options = optionsArg || {};
    }
    const self = this;
    if(!callback) {
      callback = function (err) {
        return err;
      }
    }
    // call internalSave, for FileSystemWatchers on new files?
    // store and return fileInfo?
    callback(null,null);
  };

  /*
  Delete a tiddler and invoke the callback with (err)
  */
  MultiWikiAdaptor.prototype.deleteTiddler = function(title, options, callback) {
    if(!!callback && typeof callback !== "function"){
      var optionsArg = callback;
    }
    if(typeof options === "function"){
      callback = options;
      options = optionsArg || {};
    }
    if(typeof options !== 'object') {
      if(typeof options === 'string') {
        options = {prefix: options}
      } else {
        return callback("Delete Tiddler Error. No wiki given.");
      }
    }
    const self = this;
    const prefix = options.prefix || 'RootWiki';
    const connectionInd = Number.isInteger(+options.connectionInd) ? options.connectionInd : null;
    self.adaptorInfo = self.adaptorInfo || {};
    self.adaptorInfo[prefix] = self.adaptorInfo[prefix] || {};
    let promiseLoadWiki = util.promisify($tw.ServerSide.loadWiki);
    let promiseDeleteTiddlerFile = util.promisify($tw.utils.deleteTiddlerFile);
    promiseLoadWiki(prefix)
    .then(prefix => {
      const fileInfo = self.getTiddlerInfo({fields: {title: title}}, prefix);
      // Only delete the tiddler if we have writable information for the file
      if(fileInfo) {
        // Delete the file
        $tw.Bob.logger.log(`${prefix}[${connectionInd}] Save Tidder:`, tiddler.fields.title, {level:2});
        return promiseDeleteTiddlerFile(fileInfo);
      }
    })
    .then(fileInfo => {
      // Delete the tiddler from the internal tiddlywiki side of things
      $tw.Bob.Wikis[prefix].wiki.deleteTiddler(title);
      delete $tw.Bob.Files[prefix][title];
      delete self.adaptorInfo[prefix][title];
      if($tw.Bob.Wikis[prefix].tiddlers.indexOf(title) > -1){
        $tw.Bob.Wikis[prefix].tiddlers.splice($tw.Bob.Wikis[prefix].tiddlers.indexOf(title), 1)
      }
      // Create a message saying to remove the tiddler
      const message = {type: 'deleteTiddler', tiddler: {fields:{title: title}}, prefix: prefix};
      // Send the message to each connected browser
      $tw.Bob.SendToBrowsers(message);
      // I guess unconditionally say the wiki is modified in this case.
      $tw.Bob.Wikis[prefix].modified = true;
      $tw.hooks.invokeHook('wiki-modified', prefix);
      $tw.Bob.logger.log('Deleted file ', fileInfo.filepath, {level:2});
      return callback(null, fileInfo);
    })
    .catch(err => {
      if ((err.code == "EPERM" || err.code == "EACCES") && err.syscall == "unlink") {
        // Error deleting the file on disk, should fail gracefully
        $tw.Bob.logger.log('Server desynchronized. Error deleting file for deleted tiddler:'+title, err, {level:1});
      }
      return callback(err);
    });
  };

  if($tw.node) {
    exports.adaptorClass = MultiWikiAdaptor;
  }
}

})();
