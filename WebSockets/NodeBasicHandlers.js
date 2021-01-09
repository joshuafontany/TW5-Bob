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
    $tw.BrowserTiddlerList[data.source_connection] = data.titles;
    $tw.Bob.Shared.sendAck(data);
  }

  /*
    For a lazily loaded wiki this gets the skinny tiddler list.
  */
  $tw.nodeMessageHandlers.getSkinnyTiddlers = function(data) {
    $tw.Bob.Shared.sendAck(data);
    // We need at least the name of the wiki
    if(data.wiki) {
      $tw.ServerSide.loadWiki(data.wiki);
      // Get the skinny tiddlers
      const tiddlers = []
      $tw.Bob.Wikis[data.wiki].wiki.allTitles().forEach(function(title) {
        if(title.slice(0,3) !== '$:/') {
          tiddlers.push($tw.Bob.Wikis[data.wiki].wiki.getTiddler(title).getFieldStrings({exclude:['text']}))
        }
      })
      const message = {
        type: 'skinnyTiddlers',
        tiddlers: tiddlers
      }
      $tw.Bob.Shared.sendMessage(message, data.source_connection)
    }
  }

  /*
    For lazy loading this gets a full tiddler
  */
  $tw.nodeMessageHandlers.getFullTiddler = function(data) {
    $tw.Bob.Shared.sendAck(data);
    $tw.ServerSide.loadWiki(data.wiki);
    const tiddler = $tw.Bob.Wikis[data.wiki].wiki.getTiddler(data.title)
    const message = {
      type: 'loadTiddler',
      tiddler: tiddler || {}
    }
    $tw.Bob.Shared.sendMessage(message, data.source_connection)
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
    if(data.heartbeat) {
      message.heartbeat = true;
    }
    // When the server receives a ping it sends back a pong.
    const response = JSON.stringify(message);
    $tw.connections[data.source_connection].socket.send(response);
  }

  /*
    This handles saveTiddler messages sent from the browser.

    If we always want to ignore draft tiddlers,
    use `[is[draft]]` in $:/plugins/OokTech/Bob/ExcludeSync
  */
  $tw.nodeMessageHandlers.saveTiddler = function(data) {
    // Acknowledge the message.
    $tw.Bob.Shared.sendAck(data);
    // Make sure there is actually a tiddler sent & it has fields
    if(data.tiddler && data.tiddler.fields) {
      const prefix = data.wiki || '';
      // Set the saved tiddler as no longer being edited. It isn't always
      // being edited but checking each time is more complex than just
      // always setting it this way and doesn't benifit us.
      $tw.nodeMessageHandlers.cancelEditingTiddler({
        tiddler:{
          fields:{
            title:data.tiddler.fields.title
          }
        },
        wiki: prefix
      });
      debugger;
      $tw.Bob.logger.log('Node Message Save Tiddler', data, {level: 4}); 
      $tw.Bob.logger.log(prefix+' ['+data.source_connection+'] adaptorInfo', JSON.stringify(data.adaptorInfo), {level: 3});  
      let promiseSaveTiddler = util.promisify($tw.syncadaptor.saveTiddler);
      promiseSaveTiddler(data.tiddler,
        {
          prefix: prefix, 
          connectionInd: data.source_connection
        })
      .then(fileInfo => {
        $tw.Bob.logger.log("Saved file", fileInfo.filepath, {level: 3}); 
        delete $tw.Bob.EditingTiddlers[data.wiki][data.tiddler.fields.title];
        $tw.ServerSide.UpdateEditingTiddlers(false, data.wiki);
        return;
      })
      .catch(err => {
        if(err) {
          if(fileInfo.writeError == true){
            $tw.Bob.logger.log(`Sync error while processing Save of '${data.tiddler.fields.title}'. Retrying.`, err, {level: 1});
            //Retry Save message
            $tw.nodeMessageHandlers.saveTiddler({
              tiddler: data.tiddler,
              wiki: prefix
            });
          } else {
            $tw.Bob.logger.log(`Sync error. Unable to save '${data.tiddler.fields.title}'`, err, {level: 1});
          }
        }
        return;
      });
    }
  }

  /*
    This is the handler for when the browser sends the deleteTiddler message.
  */
  $tw.nodeMessageHandlers.deleteTiddler = function(data) {
    // Acknowledge the message.
    $tw.Bob.Shared.sendAck(data);
    $tw.Bob.logger.log('Node Message Delete Tiddler', data, {level: 4});
    $tw.Bob.logger.log(prefix+' ['+data.source_connection+'] adaptorInfo', JSON.stringify(data.adaptorInfo), {level: 3});
    data.tiddler = data.tiddler || {};
    data.tiddler.fields = data.tiddler.fields || {};
    const title = data.tiddler.fields.title;
    if(title) {
      // Delete the tiddler file from the file system
      let promiseDeleteTiddler = util.promisify($tw.syncadaptor.deleteTiddler);
      promiseDeleteTiddler(title,
        {
          prefix: data.wiki, 
          connectionInd: data.source_connection
        })
      .then(fileInfo => {
        $tw.Bob.logger.log("Deleted tiddler '" + data.tiddler.fields.title + "' file at "+fileInfo.filepath, {level: 2}); 
        // Remove the tiddler from the list of tiddlers being edited.
        if($tw.Bob.EditingTiddlers[data.wiki][title]) {
          delete $tw.Bob.EditingTiddlers[data.wiki][title];
          $tw.ServerSide.UpdateEditingTiddlers(false, data.wiki);
        }
        return;
      })
      .catch((err, fileInfo) => {
        if(err) {
          $tw.Bob.logger.log("Error deleteing tiddler '" + data.tiddler.fields.title + "'file at "+fileInfo.filepath, err, {level: 2});
        }
        return;
      });
    }
  }

  /*
    This is the handler for when a browser sends the editingTiddler message.
  */
  $tw.nodeMessageHandlers.editingTiddler = function(data) {
    // Acknowledge the message.
    $tw.Bob.Shared.sendAck(data);
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
    // Acknowledge the message.
    $tw.Bob.Shared.sendAck(data);
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
    $tw.Bob.Shared.sendAck(data);
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
    $tw.Bob.Shared.sendAck(data);
    const viewableWikis = $tw.ServerSide.getViewableWikiList(data);
    // Send viewableWikis back to the browser
    const message = {
      type: 'setViewableWikis',
      list: $tw.utils.stringifyList(viewableWikis),
      wiki: data.wiki
    };
    $tw.Bob.SendToBrowser($tw.connections[data.source_connection], message);
  }

  /*
    This looks in the wikis folder set in the configuration
    $tw.setting.wikisPath
    If none is set it uses ./Wikis

    This walks though subfolders too.
  */
  $tw.nodeMessageHandlers.findAvailableWikis = function (data) {
    $tw.Bob.Shared.sendAck(data);
    $tw.ServerSide.updateWikiListing(data);
  }

  /*
    This handles ack messages.
  */
  $tw.nodeMessageHandlers.ack = $tw.Bob.Shared.handleAck;

}
}
})();