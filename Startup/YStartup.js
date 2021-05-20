/*\
title: $:/plugins/OokTech/Bob/YStartup.js
type: application/javascript
module-type: startup

This module setup up the required Y objects

\*/
(function(){

/*jslint browser: true */
/*global $tw: false */
"use strict";

exports.name = "YStartup";
exports.after = ["BobStartup"];
exports.before = ["startup"];
exports.platforms = ["browser"];
exports.synchronous = true;

const Yutils = require('./External/yjs/y-utils.cjs');

exports.startup = function() {
  // Setup the Ydocs for the wiki in the browser
  if(!!$tw.browser) {
    let wikiDoc = Yutils.getYDoc($tw.wikiName);
    // Attach the providers 
    
    // Awareness
        
    // Initialize the wiki subdocs

  }
}

})();
