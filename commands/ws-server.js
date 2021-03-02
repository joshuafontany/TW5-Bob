/*\
title: $:/plugins/OokTech/Bob/commands/wsserver.js
type: application/javascript
module-type: command

Serve tiddlers using a two-way websocket server over http

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.info = {
  name: "wsserver",
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
  // Set up http(s) server
  $tw.Bob.settings['ws-server']['required-plugins'].push($tw.Bob.settings.wikis['RootWiki'].syncadaptor);
  let variables = $tw.utils.extend(self.params,$tw.Bob.settings['ws-server']);
	this.server = new SimpleServer({
		wiki: this.commander.wiki,
		variables: variables
	});
	$tw.Bob.httpServer = this.server.listen();
  // Set up the the WebSocketServer
  $tw.Bob.wsServer = new WebSocketServer({
    clientTracking: false, 
    noServer: true // We roll our own Upgrade
  });
  // Setup the SessionManager and wire them all together.
  $tw.Bob.sessionManager = new SessionManager({
    admin: $tw.Bob.settings.wikis['RootWiki'].admin.split(','),
    httperver: $tw.Bob.httpServer,
    wsServer: $tw.Bob.wsServer
  });
  $tw.Bob.httpServer.manager = $tw.Bob.sessionManager;
  $tw.Bob.wsServer.manager = $tw.Bob.sessionManager;
	$tw.hooks.invokeHook("th-server-command-post-start",this.server,$tw.Bob.httpServer,"tiddlywiki");
  //$tw.Bob.logger.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version, {level:0})
  console.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version);
  return null;
};

exports.Command = Command;

})();
