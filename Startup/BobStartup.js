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
  // Set the wiki as loaded in the browser
  if(!!$tw.browser && $tw.wikiName) {
    $tw.Bob.Wikis.set($tw.wikiName,$tw);
  }
}

})();
