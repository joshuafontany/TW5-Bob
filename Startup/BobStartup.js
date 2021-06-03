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

const Bob = require('./Bob.js').Bob;

exports.startup = function() {
  // Initialise Bob as a $tw object
  $tw.Bob = new Bob();
  if(!!$tw.node) {
    // Initialise Bob on node
    $tw.Bob.serverSide();
  } else {
    // Initialise Bob in the browser
    $tw.Bob.browserSide();
    // Get the name for this wiki for websocket messages
    $tw.wikiName = $tw.wiki.getTiddlerText("$:/WikiName", $tw.wiki.getTiddlerText("$:/SiteTitle", "")) || "RootWiki";
    // Set this wiki as loaded
    $tw.Bob.Wikis.set($tw.wikiName,$tw);
    // Setup the Ydocs for the wiki
    let wikiDoc = $tw.Bob.getYDoc($tw.wikiName);

    // Attach the providers 

    // Awareness
        
    // Initialize the wiki subdocs


  }
}

})();
