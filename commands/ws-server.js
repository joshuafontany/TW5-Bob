/*\
title: $:/plugins/OokTech/Bob/commands/ws-server.js
type: application/javascript
module-type: command

Serve tiddlers using a two-way websocket server over http

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.info = {
  name: "ws-server",
  synchronous: true,
	namedParameterMode: true,
	mandatoryParameters: []
};

exports.platforms = ["node"];

const SaverServer = require('../SaverServer.js').SaverServer,
  MultiServer = require('../MultiServer.js').MultiServer,
  WebSocketServer = require('../WSServer.js').WebSocketServer;

const Command = function(params,commander,callback) {
  this.params = params;
  this.commander = commander;
  this.callback = callback;
};

Command.prototype.execute = function() {
  let self = this;
  if(!$tw.boot.wikiTiddlersPath) {
    $tw.utils.warning("Warning: Wiki folder '" + $tw.boot.wikiPath + "' does not exist or is missing a tiddlywiki.info file");
    return;
  }
  // The single-file saver components
  if($tw.Bob.settings.enableBobSaver !== 'no') {
    let options = {
      port: $tw.Bob.settings.saver.port
    }
    if($tw.Bob.settings.saver.host && $tw.Bob.settings.acceptance === 'I Will Not Get Tech Support For This') {
      options.host = $tw.Bob.settings.saver.host;
    }
    // Create single file saver server
    $tw.saverServer = new SaverServer(options);
    $tw.saverServer.listen();
  }
  // Set up http(s) server as $tw.Bob.server.httpServer
  let requiredPlugins = "OokTech/Bob," + $tw.Bob.settings['ws-server'].syncadaptor;
  let variables = $tw.utils.extend(self.params,$tw.Bob.settings['ws-server']);
	$tw.Bob.server = new MultiServer({
		wiki: this.commander.wiki,
    requiredPlugins: requiredPlugins,
		variables: variables
	});
	let httpServer = $tw.Bob.server.listen();
  // Set up the the WebSocketServer
  $tw.Bob.wsServer = new WebSocketServer({
    clientTracking: false, 
    noServer: true // We roll our own Upgrade
  });
	$tw.hooks.invokeHook("th-server-command-post-start",httpServer,$tw.Bob.server,"tiddlywiki");
  //$tw.Bob.logger.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version, {level:0})
  console.log(`TiddlyWiki v${$tw.version} with Bob v${$tw.Bob.version}`);
  return null;
};

exports.Command = Command;

})();
