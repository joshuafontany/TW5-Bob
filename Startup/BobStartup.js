/*\
title: $:/plugins/OokTech/Bob/BobStartup.js
type: application/javascript
module-type: startup

This module setup up the required objects
and initializes all the settings

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.name = "BobStartup";
exports.before = ["startup"];
exports.synchronous = true;

const WebSocketManager = require('$:/plugins/OokTech/Bob/WSManager.js').WebSocketManager,
WebSocketClient = require('$:/plugins/OokTech/Bob/WSClient.js').WebSocketClient;

exports.startup = function() {
  // Initialise objects
  $tw.Bob = $tw.Bob || {};
  $tw.Bob.logger = $tw.Bob.logger || {};
  $tw.Bob.version = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob').fields.version;
  $tw.Bob.ExcludeFilter = $tw.wiki.getTiddlerText('$:/plugins/OokTech/Bob/ExcludeSync');
  // Get the name for this wiki for websocket messages
  $tw.wikiName = $tw.wiki.getTiddlerText("$:/WikiName", "");
  // Always setup the WebSocketManager & the WebSocketClient
  let managerSerialized = JSON.parse("{}");
  $tw.Bob.wsManager = new WebSocketManager(managerSerialized);
  $tw.Bob.wsClient = new WebSocketClient();   
  // Polyfill because IE uses old javascript
  if(!String.prototype.startsWith) {
    String.prototype.startsWith = function(search, pos) {
      return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
    };
  }
}

})();
