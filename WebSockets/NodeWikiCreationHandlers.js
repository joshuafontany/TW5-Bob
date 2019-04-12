/*\
title: $:/plugins/OokTech/Bob/NodeWikiCreationHandlers.js
type: application/javascript
module-type: startup

These are message handler functions for the web socket servers. Use this file
as a template for extending the web socket funcitons.

This handles messages sent to the node process.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.platforms = ["node"];

if($tw.node) {
  $tw.nodeMessageHandlers = $tw.nodeMessageHandlers || {};
  /*
    This builds a single file html version of the current wiki.
    This is a modified version of the renderTiddler command.
    It can exclude tiddlers from the wiki using a filter and it can include
    tiddlers form any served wiki.
    buildWiki - the name of the base wiki to build
    excludeList - a filter that returns tiddlers to exclude from the resulting single file wiki.
    ignoreDefaultExclude - if this is 'true' than the default exclude list is ignored
    outputFolder - the name of the folder to save the result in
    outputName - the file name to use for the resulting html file (this should include the .html suffix)
    externalTiddlers - a json object that contains information about other tiddlers to include in the resulting html file

    About externalTiddlers:
      Each key is a the name of a wiki served by Bob, the value is a filter
      that will be run in that wiki and any returned tiddlers will be included in the output html file.
  */
  $tw.nodeMessageHandlers.buildHTMLWiki = function (data) {
    $tw.Bob.Shared.sendAck(data);
    const path = require('path');
    const fs = require('fs');
    let wikiPath, fullName, excludeList = [];
    if(data.buildWiki) {
      const exists = $tw.ServerSide.loadWiki(data.buildWiki);
      if(exists) {
        wikiPath = $tw.Bob.Wikis[data.buildWiki].wikiPath || undefined;
        fullName = data.buildWiki;
      }
    } else {
      wikiPath = $tw.Bob.Wikis[data.wiki].wikiPath;
      fullName = data.wiki;
    }
    console.log('Build HTML Wiki:', fullName);
    if(data.excludeList) {
      // Get the excludeList from the provided filter, if it exists
      excludeList = $tw.Bob.Wikis[fullName].wiki.filterTiddlers(data.excludeList);
    } else {
      // Otherwise we want to ignore the server-specific plugins to keep things
      // small.
      excludeList = ['$:/plugins/OokTech/Bob', '$:/plugins/tiddlywiki/filesystem', '$:/plugins/tiddlywiki/tiddlyweb'];
    }
    if(data.ignoreDefaultExclude !== 'true') {
      const defaultExclude = $tw.Bob.Wikis[fullName].wiki.filterTiddlers('[prefix[$:/plugins/OokTech/Bob/]][[$:/plugins/OokTech/Bob]][prefix[$:/WikiSettings]][prefix[$:/Bob/]][[$:/ServerIP]][[$:/plugins/tiddlywiki/filesystem]][[$:/plugins/tiddlywiki/tiddlyweb]]');
      excludeList = excludeList.concat(defaultExclude);
    }
    if(wikiPath) {
      const outputFolder = data.outputFolder || 'output';
      const outputName = data.outputName || 'index.html';
      const outputFile = path.resolve(wikiPath, outputFolder, outputName);
      $tw.utils.createFileDirectories(outputFile);
      let tempWiki = new $tw.Wiki();
      $tw.Bob.Wikis[fullName].wiki.allTitles().forEach(function(title) {
        if(excludeList.indexOf(title) === -1) {
          tempWiki.addTiddler($tw.Bob.Wikis[fullName].wiki.getTiddler(title));
        }
      })
      // If there are external tiddlers to add try and add them
      GatherTiddlers (tempWiki, data.externalTiddlers, data.transformFilters, data.transformFilter, data.decoded)
      // Prepare the wiki
      tempWiki.registerPluginTiddlers("plugin",["$:/core"]);
      // Unpack plugin tiddlers
      tempWiki.readPluginInfo();
      tempWiki.unpackPluginTiddlers();
      const text = tempWiki.renderTiddler('text/plain',"$:/core/save/all", {variables:{wikiTiddlers:$tw.utils.stringifyList(tempWiki.allTitles())}});
      fs.writeFile(outputFile,text,"utf8",function(err) {
        if(err) {
            console.log(err);
          } else {
            console.log('Built Wiki: ', outputFile);
            const message = {
              alert: `Saved html file ` + outputFile + ' to the server.',
              wikis: [data.buildWiki, data.wiki]
            };
            $tw.ServerSide.sendBrowserAlert(message);
          }
      });
    } else {
      console.log("Can't find wiki ", fullName, ", is it listed in the Bob settings tab?");
    }
  }

  /*
    This lets you create a new wiki from existing tiddlers in other wikis.
    Tiddlers from each wiki are selected by filters

    inputs:

    tiddlers - an array of tiddlers in json format
    wikiFolder - The name of the folder that holds your wikis
    wikiName - The name of the wiki to create or add to
    wikisPath - the path to the folder that holds the wikiFolder
    overwrite - if a wikiName is given and a wiki with that name already exists
    than the tiddlers will be added to that wiki instead of making a new wiki.

    externalTiddlers - a json object that has filters to import tiddlers from
    existing wikis.

    If overwrite is not set to 'yes' than wiki names are made unique. If you
    already have a wiki called MyWiki and give MyWiki as the wikiName parameter
    than a number will be appended to the end of the name to make it unique,
    similarly to how new tiddler titles are made unique.
  */
  $tw.nodeMessageHandlers.newWikiFromTiddlers = function (data) {
    // send ack first because otherwise it often takes too long to run this
    // command and the message is sent again.
    $tw.Bob.Shared.sendAck(data);
    // Do nothing unless there is an input file path given
    if(data.tiddlers || data.externalTiddlers) {
      const path = require('path');
      const fs = require('fs')
      let wikiName, wikiTiddlersPath, basePath;
      const wikiFolder = data.wikiFolder || "Wikis";
      // If there is no wikiname given create one
      if(data.wikiName) {
        if(data.overwrite !== 'yes') {
          // If a name is given use it
          wikiName = GetWikiName(data.wikiName);
        } else {
          wikiName = data.wikiName;
        }
      } else {
        // Otherwise create a new wikiname
        wikiName = GetWikiName();
      }
      // If there is no output path given use a default one
      if(data.wikisPath) {
        basePath = data.wikisPath;
      } else {
        basePath = $tw.ServerSide.getBasePath()
      }

      // even if overwrite is set to true we need to make sure the wiki already
      // exists
      let exists = false;
      const wikiPath = path.join(basePath, wikiFolder, wikiName)
      if(data.overwrite === 'true') {
        exists = $tw.ServerSide.loadWiki(wikiName)
      }

      // If we aren't overwriting or it doesn't already exist than make the new
      // wiki and load it
      if(!(typeof exists === 'string') || data.overwrite !== 'true') {
        // First copy the empty edition to the wikiPath to make the
        // tiddlywiki.info
        const params = {
          "wiki": data.wiki,
          "basePath": basePath,
          "wikisFolder": wikiFolder,
          "edition": "empty",
          "path": wikiName,
          "wikiName": wikiName,
          "decoded": data.decoded,
          "fromServer": true
        };
        $tw.nodeMessageHandlers.createNewWiki(params);
        // Get the folder for the wiki tiddlers
        wikiTiddlersPath = path.join(basePath, wikiFolder, wikiName, 'tiddlers');
        // Make sure tiddlers folder exists
        try {
          fs.mkdirSync(wikiTiddlersPath);
          console.log('Created Tiddlers Folder ', wikiTiddlersPath);
        } catch (e) {
          console.log('Tiddlers Folder Exists:', wikiTiddlersPath);
        }
        // Load the empty wiki
        $tw.ServerSide.loadWiki(wikiName)
      }
      // Add all the received tiddlers to the loaded wiki
      let count = 0;
      $tw.utils.each(data.tiddlers,function(tiddler) {
        // Save each tiddler using the syncadaptor
        // We don't save the components that are part of the empty edition
        // because we start with that
        if(tiddler.title !== '$:/core' && tiddler.title !== '$:/themes/tiddlywiki/snowwhite' && tiddler.title !== '$:/themes/tiddlywiki/vanilla') {
          $tw.syncadaptor.saveTiddler({fields: tiddler}, wikiName);
        }
        count++;
      });
      // If there are external tiddlers to add try and add them
      let tempWiki = new $tw.Wiki();
      GatherTiddlers(tempWiki, data.externalTiddlers, data.transformFilters, data.transformFilter, data.decoded);
      tempWiki.allTitles().forEach(function(tidTitle) {
        $tw.syncadaptor.saveTiddler(tempWiki.getTiddler(tidTitle), wikiName);
        count++;
      })
      if(!count) {
        console.log("No tiddlers found in the input file");
      } else {
        console.log("Wiki created");
        const message = {
          alert: 'Created wiki ' + wikiName,
          connections: [data.source_connection]
        };
        $tw.ServerSide.sendBrowserAlert(message);
      }
    } else {
      console.log('No tiddlers given!');
    }
  }

  /*
    This takes an externalTiddlers object that lists wikis and filters that
    define the tiddlers to get from that wiki

    inputs:

    wiki - the $tw.Wiki object to add the tiddlers to
    externalTiddlers - a json object that lists the wikis and filters
    token - the access token, if any
  */
  function GatherTiddlers (wiki, externalTiddlers, transformFilters, transformFilter, decodedToken) {
    if(externalTiddlers) {
      try {
        let externalData = externalTiddlers
        if(typeof externalTiddlers !== 'object') {
          externalData = JSON.parse(externalTiddlers);
        }
        transformFilters = transformFilters || '{}'
        if(typeof transformFilters !== 'object') {
          transformFilters = JSON.parse(transformFilters);
        }
        Object.keys(externalData).forEach(function(wikiTitle) {
          const allowed = $tw.Bob.AccessCheck(wikiTitle, {"decoded": decodedToken}, 'view');
          if(allowed) {
            const exists = $tw.ServerSide.loadWiki(wikiTitle);
            if(exists) {
              const includeList = $tw.Bob.Wikis[wikiTitle].wiki.filterTiddlers(externalData[wikiTitle]);
              includeList.forEach(function(tiddlerTitle) {
                let tiddler = $tw.Bob.Wikis[wikiTitle].wiki.getTiddler(tiddlerTitle)
                // Transform the tiddler title if a transfom filter is given
                let txformFilter = transformFilter
                if(transformFilters) {
                  txformFilter = transformFilters[wikiTitle] || transformFilter;
                }
                if(txformFilter) {
                  const transformedTitle = ($tw.Bob.Wikis[wikiTitle].wiki.filterTiddlers(txformFilter, null, $tw.Bob.Wikis[wikiTitle].wiki.makeTiddlerIterator([tiddlerTitle])) || [""])[0];
                  if(transformedTitle) {
                    tiddler = new $tw.Tiddler(tiddler,{title: transformedTitle});
                  }
                }
                wiki.addTiddler(tiddler);
              })
            }
          }
        });
      } catch (e) {
        console.log("Couldn't parse externalTiddlers input:", e);
      }
    }
    return wiki;
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
    wikiObj = wikiObj || $tw.settings.wikis;
    const nameParts = wikiName.split('/');
    if(nameParts.length === 1) {
      updatedName = nameParts[0];
      if(wikiObj[updatedName]) {
        if(wikiObj[updatedName].__path) {
          count = count + 1;
          while (wikiObj[updatedName + String(count)]) {
            if(wikiObj[updatedName + String(count)].__path) {
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

  // This is just a copy of the init command modified to work in this context
  $tw.nodeMessageHandlers.createNewWiki = function (data) {
    $tw.Bob.Shared.sendAck(data);
    if(data.wiki === 'RootWiki' || true) {
      const fs = require("fs"),
        path = require("path");

      // Paths are relative to the root wiki path
      $tw.settings.wikisPath = $tw.settings.wikisPath || 'Wikis';
      data.wikisFolder = data.wikisFolder || $tw.settings.wikisPath;
      // If no basepath is given than the default is to place the folder in the
      // default wikis folder
      const basePath = data.basePath || $tw.ServerSide.getBasePath();
      // This is the path given by the person making the wiki, it needs to be
      // relative to the basePath
      // data.wikisFolder is an optional sub-folder to use. If it is set to
      // Wikis than wikis created will be in the basepath/Wikis/relativePath
      // folder I need better names here.
      $tw.utils.createDirectory(path.join(basePath, data.wikisFolder));

      // Make sure we have a unique name by appending a number to the wiki name
      // if it exists.
      let name = GetWikiName(data.wikiName)
      let relativePath = name;
      // This only does something for the secure wiki server
      if($tw.settings.namespacedWikis === 'true') {
        data.decoded = data.decoded || {};
        data.decoded.name = data.decoded.name || 'imaginaryPerson';
        name = data.decoded.name + '/' + name;
        name = GetWikiName(name);
        relativePath = name;
        $tw.utils.createDirectory(path.join(basePath, data.decoded.name));
      }
      const fullPath = path.join(basePath, data.wikisFolder, relativePath)
      //var tiddlersPath = path.join(fullPath, 'tiddlers')
      // For now we only support creating wikis with one edition, multi edition
      // things like in the normal init command can come later.
      const editionName = data.edition?data.edition:"empty";
      const searchPaths = $tw.getLibraryItemSearchPaths($tw.config.editionsPath,$tw.config.editionsEnvVar);
      if(process.pkg) {
        let editionPath = $tw.findLibraryItem(editionName,searchPaths);
        if(!$tw.utils.isDirectory(editionPath)) {
          editionPath = undefined
          const pluginPath = process.pkg.path.resolve("./editions","./" + editionName)
          if(true || fs.existsSync(pluginPath) && fs.statSync(pluginPath).isDirectory()) {
            editionPath = pluginPath;
          }
          if(editionPath) {
            try {
              $tw.ServerSide.specialCopy(editionPath, fullPath);
              console.log("Copied edition '" + editionName + "' to " + fullPath + "\n");
            } catch (e) {
              console.log('error copying edition', e);
            }
          } else {
            console.log("Edition not found");
          }
        } else if($tw.utils.isDirectory(editionPath)) {
          // Copy the edition content
          const err = $tw.utils.copyDirectory(editionPath,fullPath);
          if(!err) {
            console.log("Copied edition '" + editionName + "' to " + fullPath + "\n");
          } else {
            console.log(err);
          }
        }
      } else {
        // Check the edition exists
        const editionPath = $tw.findLibraryItem(editionName,searchPaths);
        if(!$tw.utils.isDirectory(editionPath)) {
          console.log("Edition '" + editionName + "' not found");
        }
        // Copy the edition content
        const err = $tw.utils.copyDirectory(editionPath,fullPath);
        if(!err) {
          console.log("Copied edition '" + editionName + "' to " + fullPath + "\n");
        } else {
          console.log(err);
        }
      }
      // Tweak the tiddlywiki.info to remove any included wikis
      const packagePath = path.join(fullPath, "tiddlywiki.info");
      let packageJson = {};
      try {
        packageJson = JSON.parse(fs.readFileSync(packagePath));
      } catch (e) {
        console.log('failed to load tiddlywiki.info file', e);
      }
      delete packageJson.includeWikis;
      try {
        fs.writeFileSync(packagePath,JSON.stringify(packageJson,null,$tw.config.preferences.jsonSpaces));
      } catch (e) {
        console.log('failed to write settings', e)
      }

      /*
      // Use relative paths here.
      // Note this that is dependent on process.cwd()!!
      function listWiki(wikiName, currentLevel, wikiPath) {
        const nameParts = wikiName.split(path.sep);
        if(typeof currentLevel[nameParts[0]] === 'object' && nameParts.length > 1) {
          listWiki(nameParts.slice(1).join(path.sep), currentLevel[nameParts[0]], wikiPath);
        } else if(typeof currentLevel[nameParts[0]] === 'undefined' && nameParts.length > 1) {
          currentLevel[nameParts[0]] = {};
          listWiki(nameParts.slice(1).join(path.sep), currentLevel[nameParts[0]], wikiPath);
        } else if(nameParts.length === 1) {
          // List the wiki in the appropriate place
          currentLevel[nameParts[0]] = currentLevel[nameParts[0]] || {};
          currentLevel[nameParts[0]].__path = wikiPath;
          //currentLevel[nameParts[0]] = {'__path': wikiPath};
        }
      }
      listWiki(relativePath, $tw.settings.wikis, relativePath)
      */
      // This is here as a hook for an external server. It is defined by the
      // external server and shouldn't be defined here or it will break
      // If you are not using an external server than this does nothing
      if($tw.ExternalServer) {
        if(typeof $tw.ExternalServer.initialiseWikiSettings === 'function') {
          $tw.ExternalServer.initialiseWikiSettings(relativePath, data);
        }
      }

      /*
      // Update the settings
      setTimeout(function() {
        data.saveSettings = true;
        $tw.nodeMessageHandlers.findAvailableWikis(data);
      }, 1000);
      // Then clear all the routes to the non-root wiki
      $tw.httpServer.clearRoutes();
      // The re-add all the routes from the settings
      // This reads the settings so we don't need to give it any arguments
      $tw.httpServer.addOtherRoutes();
      */
      data.update = 'true';
      data.saveSettings = 'true';
      $tw.nodeMessageHandlers.findAvailableWikis(data);

      const message = {
        alert: 'Created wiki ' + name,
        connections: [data.source_connection]
      };
      $tw.ServerSide.sendBrowserAlert(message);
    }
  }

  /*
    This downloads the single html file version of a wiki
    It defaults to the current wiki but if you give a forWiki input it
    downloads that wiki instead.
  */
  $tw.nodeMessageHandlers.downloadHTMLFile = function (data) {
    $tw.Bob.Shared.sendAck(data);
    if(data.wiki) {
      const downloadWiki = data.forWiki || data.wiki;
      const allowed = $tw.Bob.AccessCheck(downloadWiki, {"decoded":data.decoded}, 'view');
      if(allowed) {
        const path = require('path');
        const fs = require('fs');
        try {
          const outputFilePath = path.join($tw.Bob.Wikis[data.wiki].wikiPath, 'output', 'index.html');
          const file = fs.readFileSync(outputFilePath);
          // Send file to browser in a websocket message
          const message = {'type': 'downloadFile', 'file': file};
          $tw.Bob.SendToBrowser($tw.connections[data.source_connection], message);
        } catch (e) {
          console.log('Error:', e)
        }
      }
    }
  }

  /*
    This message fetches tiddlers from another wiki on the same Bob server
    The input data object has:
      fromWiki - the name of the wiki to pull from
      filter - the tiddler filter to use to select tiddlers from the remote
        wiki
      transformFilter - the titles of imported tiddlers are modified by this
        filter.
      resolution - how conflicts are handled
        - manual - all tiddlers are saved in a temporary place and have to be
          manually accepted or rejected
        - conflct - only tiddlers that conflict with existing tiddlers are
          saved in a temporary place to be accepted or rejected.
        - force - all imported tiddlers are saved regardelss of conflicts
  */
  $tw.nodeMessageHandlers.internalFetch = function(data) {
    $tw.Bob.Shared.sendAck(data);
    // Make sure that the person has access to the wiki
    const authorised = $tw.Bob.AccessCheck(data.fromWiki, {"decoded":data.decoded}, 'view');
    if(authorised) {
      let externalTiddlers = {};
      if(data.externalTiddlers) {
        try {
          externalTiddlers = JSON.parse(data.externalTiddlers);
        } catch (e) {
          console.log("Can't parse externalTiddlers");
        }
      }
      externalTiddlers[data.fromWiki] = data.filter
      let tempWiki = new $tw.Wiki();
      GatherTiddlers(tempWiki, externalTiddlers, data.transformFilters, data.transformFilter, data.decoded);

      // Add the results to the current wiki
      // Each tiddler gets added to the requesting wiki
      let list = []
      let message
      tempWiki.allTitles().forEach(function(tidTitle){
        // Get the current tiddler
        const tiddler = tempWiki.getTiddler(tidTitle);
        list.push(tiddler.fields.title)
        // Create the message with the appropriate conflict resolution
        // method and send it
        if(data.resolution === 'conflict') {
          message = {type: 'conflict', message: 'saveTiddler', tiddler: tiddler, wiki: data.wiki};
        } else if(data.resolution === 'force') {
          message = {type: 'saveTiddler', tiddler: tiddler, wiki: data.wiki};
        } else {
          message = {type: 'import', tiddler: tiddler, wiki: data.wiki};
        }
        $tw.Bob.SendToBrowser($tw.connections[data.source_connection], message)
      })
      // Make the import list and send that tiddler too
      const importListTiddler = {
        fields: {
          title: '$:/status/Bob/importlist',
          tags: [],
          list: list
        }
      }
      message = {type: 'saveTiddler', tiddler: importListTiddler, wiki: data.wiki}
      $tw.Bob.SendToBrowser($tw.connections[data.source_connection], message)
      const message = {
        alert: 'Fetched Tiddlers, see import list',
        wikis: [data.wiki]
      };
      $tw.ServerSide.sendBrowserAlert(message);
    }
  }

  /*
    This creates a duplicate of an existing wiki, complete with any
    wiki-specific media files

    {
      wiki: callingWiki,
      fromWiki: fromWikiName,
      newWiki: newWikiName,
      copyChildren: copyChildren
    }

    fromWiki - the name of the wiki to duplicate
    newWiki - the name of the new wiki created
    copyChildren - if true than any child wikis contained in the fromWiki
    folder are also copied.

    If no fromWiki is given, or the name doesn't match an existing wiki, than
    the empty edition is used, if no newWiki is given than the default new name
    is used.
  */
  $tw.nodeMessageHandlers.duplicateWiki = function(data) {
    $tw.Bob.Shared.sendAck(data)
    // Make sure that the wiki to duplicate exists and that the target wiki
    // name isn't in use
    const authorised = $tw.Bob.AccessCheck(data.fromWiki, {"decoded":data.decoded}, 'duplicate');
    if ($tw.ServerSide.existsListed(data.fromWiki) && authorised) {
      const wikiName = getWikiName(data.newWiki);
      // Get the paths for the source and destination
      $tw.settings.wikisPath = $tw.settings.wikisPath || './Wikis';
      const source = $tw.ServerSide.getWikiPath(data.fromWiki);
      const destination = path.resolve(basePath, $tw.settings.wikisPath, wikiName);
      data.copyChildren = data.copyChildren || 'no';
      const copyChildren = data.copyChildren.toLowerCase() === 'yes'?true:false;
      // Make the duplicate
      $tw.ServerSide.specialCopy(source, destination, copyChildren, function() {
        // Refresh wiki listing
        data.update = 'true';
        $tw.nodeMessageHandlers.findAvailableWikis(data);
        const message = {
          alert: `Created wiki ` + wikiName,
          connections: [data.source_connection]
        };
        $tw.ServerSide.sendBrowserAlert(message);
      });
    }
  }
}
})()
