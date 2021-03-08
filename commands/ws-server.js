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

const SaverServer = require('$:/plugins/OokTech/Bob/SaverServer.js').SaverServer,
  SimpleServer = require('$:/plugins/OokTech/Bob/SimpleServer.js').SimpleServer,
  WebSocketServer = require('$:/plugins/OokTech/Bob/WSServer.js').WebSocketServer,
  SessionManager = require('$:/plugins/OokTech/Bob/SessionManager.js').SessionManager;

const Command = function(params,commander,callback) {
  this.params = params;
  this.commander = commander;
  this.callback = callback;
};

Command.prototype.execute = function() {
  let self = this;
  if(!$tw.boot.wikiTiddlersPath) {
    $tw.utils.warning("Warning: Wiki folder '" + $tw.boot.wikiPath + "' does not exist or is missing a tiddlywiki.info file");
  }
  // Initialise node specific Bob objects
  $tw.Bob.Wikis = $tw.Bob.Wikis || new Map();
  // Initialise the scriptQueue objects ???
  $tw.Bob.scriptQueue = {};
  $tw.Bob.scriptActive = {};
  $tw.Bob.childproc = false;
  // Init ServerSide utils
  $tw.ServerSide = $tw.ServerSide || require('$:/plugins/OokTech/Bob/ServerSide.js');
  // Initialise the $tw.Bob.settings object & load the user settings
  $tw.Bob.settings = JSON.parse($tw.wiki.getTiddler('$:/plugins/OokTech/Bob/DefaultSettings').fields.text || "{}");
  $tw.ServerSide.loadSettings($tw.Bob.settings,$tw.boot.wikiPath);
  // Load the RootWiki
  $tw.ServerSide.loadWiki("RootWiki");
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
  $tw.Bob.settings['ws-server']['required-plugins'].push($tw.Bob.settings['ws-server'].syncadaptor);
  let variables = $tw.utils.extend(self.params,$tw.Bob.settings['ws-server']);
	$tw.Bob.server = new SimpleServer({
		wiki: this.commander.wiki,
		variables: variables
	});
	let httpServer = $tw.Bob.server.listen();
  // Set up the the WebSocketServer
  $tw.Bob.wsServer = new WebSocketServer({
    clientTracking: false, 
    noServer: true // We roll our own Upgrade
  });
  // Setup the SessionManager and wire them all together.
  let managerSerialized = JSON.parse("{}");
  $tw.Bob.sessionManager = new SessionManager(managerSerialized);
  $tw.Bob.server.manager = $tw.Bob.sessionManager;
  $tw.Bob.wsServer.manager = $tw.Bob.sessionManager;
	$tw.hooks.invokeHook("th-server-command-post-start",httpServer,$tw.Bob.server,"tiddlywiki");
  //$tw.Bob.logger.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version, {level:0})
  console.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version);
  return null;
};

exports.Command = Command;

})();
