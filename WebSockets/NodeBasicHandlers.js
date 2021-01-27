/*\
title: $:/plugins/OokTech/Bob/NodeBasicHandlers.js
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

exports.startup = function() {
if($tw.node) {
  const util = require("util");
  $tw.nodeMessageHandlers = $tw.nodeMessageHandlers || {};
  $tw.Bob.Shared = require('$:/plugins/OokTech/Bob/SharedFunctions.js');
  /*
    This handles when the browser sends the list of all tiddlers that currently
    exist in the browser version of the wiki. This is different than the list of
    all tiddlers in files.
  */
  $tw.nodeMessageHandlers.browserTiddlerList = function(data) {
    // Save the list of tiddlers in the browser as part of the $tw object so it
    // can be used elsewhere.
    const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
    $tw.BrowserTiddlerList[connectionIndex] = data.titles;
  }

  /*
    For a lazily loaded wiki this gets the skinny tiddler list.
  */
  $tw.nodeMessageHandlers.getSkinnyTiddlers = function(data) {
    // We need at least the name of the wiki
    if(data.wiki) {
      const prefix = data.wiki || 'RootWiki';
      const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
      let promiseLoadWiki = util.promisify($tw.ServerSide.loadWiki);
      promiseLoadWiki(prefix)
      .then(prefix => {
        // Get the skinny tiddlers
        const tiddlers = []
        $tw.Bob.Wikis[prefix].wiki.allTitles().forEach(function(title) {
          if(title.slice(0,3) !== '$:/') {
            tiddlers.push($tw.Bob.Wikis[prefix].wiki.getTiddler(title).getFieldStrings({exclude:['text']}))
          }
        })
        const message = {
          type: 'skinnyTiddlers',
          tiddlers: tiddlers
        }
        $tw.Bob.Shared.sendMessage(message, connectionIndex)
      })
      .catch(err => {
        $tw.Bob.logger.log(`${prefix}[${connectionIndex}] Handler error. Unable to getSkinnyTiddlers`, err, {level: 1});
        return;
      });
    }
  }

  /*
    For lazy loading this gets a full tiddler
  */
  $tw.nodeMessageHandlers.getFullTiddler = function(data) {
    const prefix = data.wiki || 'RootWiki';
    const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
    let promiseLoadWiki = util.promisify($tw.ServerSide.loadWiki);
    promiseLoadWiki(prefix)
    .then(prefix => {
      const tiddler = $tw.Bob.Wikis[prefix].wiki.getTiddler(data.title)
      const message = {
        type: 'loadTiddler',
        tiddler: tiddler || {}
      }
      $tw.Bob.Shared.sendMessage(message, connectionIndex)
    })
    .catch(err => {
      $tw.Bob.logger.log(`${prefix}[${connectionIndex}] Handler error. Unable to getFullTiddler for '${data.title}'`, err, {level: 1});
      return;
    });
  }

  /*
    This responds to a ping from the browser. This is used to check and make sure
    that the browser and server are connected.
    It also echos back any data that was sent. This is used by the heartbeat to
    make sure that the server and browser are still connected.
  */
  $tw.nodeMessageHandlers.ping = function(data) {
    let message = {};
    Object.keys(data).forEach(function (key) {
      message[key] = data[key];
    })
    message.type = 'pong';
    message.id = "heartbeat";
    // When the server receives a ping it sends back a pong.
    const response = JSON.stringify(message);
    const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
    $tw.connections[connectionIndex].socket.send(response);
  }

  /*
    This handles saveTiddler messages sent from the browser.

    If we always want to ignore draft tiddlers,
    use `[is[draft]]` in $:/plugins/OokTech/Bob/ExcludeSync
  */
  $tw.nodeMessageHandlers.saveTiddler = function(data) {
    // Make sure there is actually a tiddler sent & it has fields
    if(data.tiddler && data.tiddler.fields) {
      const prefix = data.wiki || 'RootWiki';
      const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
      // Set the saved tiddler as no longer being edited. It isn't always
      // being edited but checking each time is more complex than just
      // always setting it this way and doesn't benifit us.
      /*$tw.nodeMessageHandlers.cancelEditingTiddler({
        tiddler:{
          fields:{
            title:data.tiddler.fields.title
          }
        },
        wiki: prefix
      });*/
      // Save the tiddler to the wiki
      let promiseLoadWiki = util.promisify($tw.ServerSide.loadWiki);
      promiseLoadWiki(prefix)
      .then(prefix => {
        $tw.Bob.logger.log(`[${prefix}][${connectionIndex}] Save Tiddler`, data.tiddler.fields.title, {level: 2});
        $tw.Bob.Wikis[prefix].wiki.addTiddler(new $tw.Tiddler(data.tiddler.fields));
        if($tw.Bob.Wikis[prefix].tiddlers.indexOf(data.tiddler.fields.title) === -1) {
          $tw.Bob.Wikis[prefix].tiddlers.push(data.tiddler.fields.title);
        }
        //Mark as modified
        $tw.Bob.Wikis[prefix].modified = true;
        $tw.hooks.invokeHook('wiki-modified', prefix);
        delete $tw.Bob.EditingTiddlers[data.wiki][data.tiddler.fields.title];
        $tw.ServerSide.UpdateEditingTiddlers(false, data.wiki);
        // Notify the other connections
        const message = {
          type: 'saveTiddler',
          wiki: prefix,
          tiddler: {
            fields: data.tiddler.fields
          }
        };
        $tw.Bob.SendToBrowsers(message, connectionIndex);
        return;
      })
      .catch(err => {
        debugger;
        $tw.Bob.logger.error(`[${prefix}][${connectionIndex}] Handler error. Unable to save '${data.tiddler.fields.title}'`, err, {level: 1});
        return;
      });
    }
  }

  /*
    This is the handler for when the browser sends the deleteTiddler message.
  */
  $tw.nodeMessageHandlers.deleteTiddler = function(data) {
    data.tiddler = data.tiddler || {};
    data.tiddler.fields = data.tiddler.fields || {};
    const title = data.tiddler.fields.title;
    if(title) {
      const prefix = data.wiki || '';
      const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
      $tw.Bob.logger.log(`[${prefix}][${connectionIndex}] Delete Tiddler`, data.tiddler.fields.title, {level: 2});
      // Delete the tiddler file from the wiki
      let promiseLoadWiki = util.promisify($tw.ServerSide.loadWiki);
      promiseLoadWiki(prefix)
      .then(prefix => {
        $tw.Bob.logger.log(`[${prefix}][${connectionIndex}] deleteTiddler`, {level: 3}); 
        $tw.Bob.Wikis[prefix].wiki.deleteTiddler(title);
        if($tw.Bob.Wikis[prefix].tiddlers.indexOf(title) > -1){
          $tw.Bob.Wikis[prefix].tiddlers.splice($tw.Bob.Wikis[prefix].tiddlers.indexOf(title), 1)
        }
        // I guess unconditionally say the wiki is modified in this case.
        $tw.Bob.Wikis[prefix].modified = true;
        $tw.hooks.invokeHook('wiki-modified', prefix);
        // Remove the tiddler from the list of tiddlers being edited.
        if($tw.Bob.EditingTiddlers[data.wiki][title]) {
          delete $tw.Bob.EditingTiddlers[data.wiki][title];
          $tw.ServerSide.UpdateEditingTiddlers(false, data.wiki);
        }
        // Create a message saying to remove the tiddler
        const message = {type: 'deleteTiddler', tiddler: {fields:{title: title}}, wiki: prefix};
        // Send the message to each connected browser
        $tw.Bob.SendToBrowsers(message);
        return;
      })
      .catch(err => {
        $tw.Bob.logger.error(`[${prefix}][${connectionIndex}] Handler error. Unable to delete '${data.tiddler.fields.title}'`, err, {level: 1});
        return;
      });
    }
  }

  /*
    This is the handler for when a browser sends the editingTiddler message.
  */
  $tw.nodeMessageHandlers.editingTiddler = function(data) {
    data.tiddler = data.tiddler || {};
    data.tiddler.fields = data.tiddler.fields || {};
    const title = data.tiddler.fields.title;
    if(title) {
      // Add the tiddler to the list of tiddlers being edited to prevent
      // multiple people from editing it at the same time.
      $tw.ServerSide.UpdateEditingTiddlers(title, data.wiki);
    }
  }

  /*
    This is the handler for when a browser stops editing a tiddler.
  */
  $tw.nodeMessageHandlers.cancelEditingTiddler = function(data) {
    data.tiddler = data.tiddler || {};
    data.tiddler.fields = data.tiddler.fields || {};
    let title = data.tiddler.fields.title;
    if(title) {
      // Make sure that the tiddler title is a string
      if(data.tiddler.fields["draft.of"]) {
        title = data.tiddler.fields["draft.of"]
      }
      // Remove the current tiddler from the list of tiddlers being edited.
      if($tw.Bob.EditingTiddlers[data.wiki][title]) {
        delete $tw.Bob.EditingTiddlers[data.wiki][title];
      }
      $tw.ServerSide.UpdateEditingTiddlers(false, data.wiki);
    }
  }

  /*
    This updates what wikis are being served and where they are being served
  */
  $tw.nodeMessageHandlers.updateRoutes = function (data) {
    // Then clear all the routes to the non-root wiki
    $tw.httpServer.clearRoutes();
    // The re-add all the routes from the settings
    // This reads the settings so we don't need to give it any arguments
    $tw.httpServer.addOtherRoutes();
  }

  /*
    This sends back a list of all wikis that are viewable using the current access token.
  */
  $tw.nodeMessageHandlers.getViewableWikiList = function (data) {
    data = data || {};
    const viewableWikis = $tw.ServerSide.getViewableWikiList(data);
    const connectionIndex = Number.isInteger(+data.source_connection) ? data.source_connection : null;
    // Send viewableWikis back to the browser
    const message = {
      type: 'setViewableWikis',
      list: $tw.utils.stringifyList(viewableWikis),
      wiki: data.wiki
    };
    $tw.Bob.SendToBrowser($tw.connections[connectionIndex], message);
  }

  /*
    This looks in the wikis folder set in the configuration
    $tw.setting.wikisPath
    If none is set it uses ./Wikis

    This walks though subfolders too.
  */
  /*
  $tw.nodeMessageHandlers.findAvailableWikis = function (data) {
    $tw.ServerSide.updateWikiListing(data);
  }
  */

  /*
    This handles ack messages.
  */
  $tw.nodeMessageHandlers.ack = $tw.Bob.Shared.handleAck;

}
}
})();