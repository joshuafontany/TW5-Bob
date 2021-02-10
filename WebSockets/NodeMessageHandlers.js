/*\
title: $:/plugins/OokTech/Bob/NodeMessageHandlers.js
type: application/javascript
module-type: node-messagehandlers

These are message handler functions for the web socket servers. Use this file
as a template for extending the web socket funcitons.

This handles messages sent to the node process.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

  /*
    This is just a test function to make sure that everthing is working.
    It displays the contents of the received data in the console.
  */
  exports.test = function(data) {
    $tw.Bob.logger.log(data, {level:0});
  }
})()
