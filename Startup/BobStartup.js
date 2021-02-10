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
exports.platforms = ["browser","node"];
exports.synchronous = true;

exports.startup = function() {
  // Get the name for this wiki for websocket messages
  $tw.wikiName = $tw.wikiName || this.wiki.getTiddlerText("$:/WikiName", "");
  // Initialise objects
  $tw.Bob = $tw.Bob || {};
  $tw.Bob.ExcludeFilter = $tw.wiki.getTiddlerText('$:/plugins/OokTech/Bob/ExcludeSync'); 
  $tw.Bob.version = $tw.wiki.getTiddler('$:/plugins/OokTech/Bob').fields.version;
  debugger;
  if($tw.node) {
    // ServerSide methods
    $tw.ServerSide = $tw.ServerSide || require('$:/plugins/OokTech/Bob/ServerSide.js').ServerSide;
    // Load the node-messagehandlers modules
    $tw.modules.applyMethods("node-messagehandlers",$tw.Bob.nodeMessageHandlers);  	
    // Initialise node specific Bob objects
    $tw.Bob.Wikis = $tw.Bob.Wikis || {};
    $tw.Bob.Files = $tw.Bob.Files || {};
    $tw.Bob.logger = $tw.Bob.logger || {};
    // Initialise the scriptQueue objects
    $tw.Bob.scriptQueue = {};
    $tw.Bob.scriptActive = {};
    $tw.Bob.childproc = false;
    // Initialise the $tw.Bob.settings object & load the user settings
    $tw.Bob.settings = JSON.parse($tw.wiki.getTiddler('$:/plugins/OokTech/Bob/DefaultSettings').fields.text);
    $tw.ServerSide.loadSettings($tw.Bob.settings, $tw.boot.wikiPath);
    // Load the RootWiki
    $tw.ServerSide.loadWiki("RootWiki");
  } else {
    // Polyfill because IE uses old javascript
    if(!String.prototype.startsWith) {
      String.prototype.startsWith = function(search, pos) {
        return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
      };
    }
    // Load the browser-messagehandlers modules
  	$tw.modules.applyMethods("browser-messagehandlers",$tw.Bob.browserMessageHandlers);
    // Set up the the WebSocketClient
    const WebSocketClient = require('$:/plugins/OokTech/Bob/WSClient.js').WebSocketClient;
    $tw.Bob.wsClient = new WebSocketClient({wiki: $tw.wikiName});
  }
}

})();
