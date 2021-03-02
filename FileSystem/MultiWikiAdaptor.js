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

if($tw.node){
  // Get a reference to the util library for promise creation
  const util = require("util");
}
/*
  TODO Create a message that lets us set excluded tiddlers from inside the wikis
  A per-wiki exclude list would be best but that is going to have annoying
  logic so it will come later.
*/
//$tw.Bob.ExcludeFilter = $tw.Bob.ExcludeFilter || "[prefix[$:/state/]][prefix[$:/temp/]][prefix[$:/HistoryList]][prefix[$:/WikiSettings]][[$:/status/UserName]][[$:/Import]][prefix[$:/plugins/OokTech/Bob/Socket]]";

function MultiWikiAdaptor(options) {
  this.rootwiki = options.wiki;
}

MultiWikiAdaptor.prototype.name = "MultiWikiAdaptor"

MultiWikiAdaptor.prototype.supportsLazyLoading = false

MultiWikiAdaptor.prototype.isReady = function() {
  // The file system adaptor is always ready
  return true;
};

MultiWikiAdaptor.prototype.getTiddlerInfo = function(tiddler, options) {
  //Returns the existing fileInfo for the tiddler. To regenerate, call getTiddlerFileInfo().
  options = options || {};
  const prefix = options.wiki ? options.wiki.getTiddlerText('$:/WikiName') : options.prefix || 'RootWiki';
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
MultiWikiAdaptor.prototype.getTiddlerFileInfo = function(tiddler, options, callback) {
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
  if(typeof options !== 'object') {
    if(typeof options === 'string') {
      options = {prefix: options}
    } else {
      return callback(new Error("getTiddlerFileInfo Error. No wiki given."));
    }
  }
  var prefix = options.wiki ? options.wiki.getTiddlerText('$:/WikiName') : options.prefix || 'RootWiki';
  // Always generate a fileInfo object when this fuction is called
  var title = tiddler.fields.title, newInfo, pathFilters, extFilters;
  if($tw.Bob.Wikis[prefix].wiki.tiddlerExists("$:/config/FileSystemPaths")){
    pathFilters = $tw.Bob.Wikis[prefix].wiki.getTiddlerText("$:/config/FileSystemPaths","").split("\n");
  }
  if($tw.Bob.Wikis[prefix].wiki.tiddlerExists("$:/config/FileSystemExtensions")){
    extFilters = $tw.Bob.Wikis[prefix].wiki.getTiddlerText("$:/config/FileSystemExtensions","").split("\n");
  }
  newInfo = $tw.utils.generateTiddlerFileInfo(tiddler,{
    directory: $tw.Bob.Wikis[prefix].wikiTiddlersPath,
    pathFilters: pathFilters,
    extFilters: extFilters,
    wiki: $tw.Bob.Wikis[prefix].wiki,
    fileInfo: $tw.Bob.Files[prefix][title],
    originalpath: $tw.Bob.Wikis[prefix].wiki.extractTiddlerDataItem("$:/config/OriginalTiddlerPaths",title, "")
  });
  if(typeof callback === "function") {
    return callback(null,newInfo);
  } else {
    return newInfo;
  }
};

/*
Given a tiddler title and a options object, generate a fileInfo object but do not save it.
Make sure that the wiki exists before calling this.
*/
MultiWikiAdaptor.prototype.generateCustomFileInfo = function(title, options) {
  options = options || {};
  if(typeof options !== 'object') {
    if(typeof options === 'string') {
      options = {prefix: options}
    } else {
      return callback(new Error("generateCustomFileInfo Error. No wiki given."));
    }
  }
  const prefix = options.wiki ? options.wiki.getTiddlerText('$:/WikiName') : options.prefix || 'RootWiki';
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
  if(typeof options !== 'object') {
    if(typeof options === 'string') {
      options = {prefix: options}
    } else {
      return callback(new Error("saveTiddler Error. No wiki given."));
    }
  }
  const prefix = options.wiki ? options.wiki.getTiddlerText('$:/WikiName') : options.prefix || 'RootWiki';
  let syncerInfo = options.tiddlerInfo || {};
  if(tiddler.fields && $tw.Bob.Wikis[prefix].wiki.filterTiddlers($tw.Bob.ExcludeFilter).indexOf(tiddler.fields.title) === -1) {
    let promiseGetTiddlerFileInfo = util.promisify(this.getTiddlerFileInfo);
    let promiseSaveTiddlerToFile = util.promisify($tw.utils.saveTiddlerToFile);
    let promiseCleanupTiddlerFiles = util.promisify($tw.utils.cleanupTiddlerFiles);
    promiseGetTiddlerFileInfo(tiddler, {prefix: prefix})
      .then(fileInfo => {
        $tw.Bob.logger.log(`[${prefix}] Save Tidder:`, tiddler.fields.title, {level:2});
        return promiseSaveTiddlerToFile(tiddler, fileInfo);
      })
      .then(fileInfo => {
        $tw.Bob.logger.log(`[${prefix}] Saved File:`, fileInfo.filepath, {level:3});
        // Store the new file location
        $tw.Bob.Files[prefix][tiddler.fields.title] = fileInfo;
        // Cleanup duplicates if the file moved or changed extensions
        var options = {
          adaptorInfo: syncerInfo.adaptorInfo || {},
          bootInfo: fileInfo || {},
          title: tiddler.fields.title
        };
        return promiseCleanupTiddlerFiles(options);
      })
      .then(fileInfo => {
        return callback(null, fileInfo);
      })
      .catch(err => {
        debugger;
        $tw.Bob.logger.error(`[${prefix}] Save Error:`, tiddler.fields.title, err, {level:1});
        if(err) {
          // If there's an error, exit without changing any internal wiki state
          if ((err.code == "EPERM" || err.code == "EACCES") && err.syscall == "open") {
            tw.Bob.logger.log(`Sync failed for '${tiddler.fields.title}' and will be retried with encoded filepath`, encodeURIComponent(bootInfo.filepath), {level:2});
            fileInfo = fileInfo || $tw.Bob.Files[prefix][tiddler.fields.title];
            fileInfo.writeError = true;
            $tw.Bob.Files[prefix][tiddler.fields.title] = fileInfo;
            return callback(err);
          } else {
            return callback(err);
          }
        }
    });
  }
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)

We don't need to implement loading for the file system adaptor, 
because all the tiddler files will have been loaded during the boot process.
*/
MultiWikiAdaptor.prototype.loadTiddler = function(title,options,callback) {
  // Starting with 5.1.24, all syncadptor method signatures follow the node.js
  // standard of callback as last argument. This catches the previous signature:
  /*options = options || {};
  if(!!callback && typeof callback !== "function"){
    var optionsArg = callback;
  }
  if(typeof options === "function"){
    callback = options;
    options = optionsArg || {};
  if(typeof options !== 'object') {
    if(typeof options === 'string') {
      options = {prefix: options}
    } else {
      return callback(new Error("loadTiddler Error. No wiki given."));
    }
  }
  }*/
  // call internalSave, for FileSystemWatchers on new files?
  // store and return fileInfo?
  //const prefix = options.wiki ? options.wiki.getTiddlerText('$:/WikiName') : options.prefix || 'RootWiki';
  callback(null,null);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
MultiWikiAdaptor.prototype.deleteTiddler = function(title, options, callback) {
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
  if(typeof options !== 'object') {
    if(typeof options === 'string') {
      options = {prefix: options}
    } else {
      return callback(new Error("deleteTiddler Error. No wiki given."));
    }
  }
  const prefix = options.wiki ? options.wiki.getTiddlerText('$:/WikiName') : options.prefix || 'RootWiki';
  const fileInfo = this.getTiddlerInfo({fields: {title: title}}, {prefix: prefix});
  // Only delete the tiddler if we have writable information for the file
  if(fileInfo) {
    // Delete the file
    $tw.Bob.logger.log(`[${prefix}] Delete Tidder:`, tiddler.fields.title, {level:2});
    let promiseDeleteTiddlerFile = util.promisify($tw.utils.deleteTiddlerFile);
    promiseDeleteTiddlerFile(fileInfo)
    .then(fileInfo => {
      $tw.Bob.logger.log(`[${prefix}] Deleted File:`, fileInfo.filepath, {level:3});
      // Delete the tiddler from the internal tiddlywiki side of things
      delete $tw.Bob.Files[prefix][title];
      return fileInfo || {};
    })
    .then(fileInfo => {
      return callback(null, fileInfo);
    })
    .catch(err => {
      $tw.Bob.logger.error(`[${prefix}] Delete Error:`, tiddler.fields.title, err, {level:1});
      if ((err.code == "EPERM" || err.code == "EACCES") && err.syscall == "unlink") {
        // Error deleting the file on disk, should fail gracefully
        $tw.Bob.logger.log('Server desynchronized. Error deleting file for deleted tiddler:'+title, {level:2});
        return callback(null, {})
      }
      return callback(err);
    });
  }
};

if(false && $tw.node) {
  exports.adaptorClass = MultiWikiAdaptor;
}

})();
