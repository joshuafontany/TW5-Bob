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

exports.startup = function() {
  // Initialise Bob as a $tw object
  if($tw.node) {
    const BobServer = require('./Bob.js').BobServer;
    // Initialise Bob on node
    $tw.Bob = new BobServer();
    // Load the RootWiki
    $tw.Bob.loadWiki("RootWiki");
  } else {
    const Bob = require('./Bob.js').Bob;
    // Initialise Bob in the browser
    $tw.Bob = new Bob();
    // Set this wiki as loaded
    $tw.Bob.loadWiki($tw.wiki.getTiddlerText("$:/WikiName", $tw.wiki.getTiddlerText("$:/SiteTitle", "")));
  }
}

})();
