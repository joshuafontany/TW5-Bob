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

const path = require("path"),
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
  $tw.Bob = $tw.Bob || {};
  debugger;
  if(false){
  //$tw.Bob.logger.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version, {level:0})
  console.log('TiddlyWiki version', $tw.version, 'with Bob version', $tw.Bob.version);
  // Set up http(s) server
  const port = $tw.Bob.settings['ws-server'].port || "8080",
  host = $tw.Bob.settings['ws-server'].host || "127.0.0.1",
  pathprefix = $tw.Bob.settings['ws-server'].pathprefix,
  username = $tw.Bob.settings['ws-server'].username,
  password = $tw.Bob.settings['ws-server'].password;
  let variables = $tw.utils.extend(self.params,{
    servername: $tw.Bob.settings.serverName,
    username: username,
    password: password,
    "port": port,
    "host": host,
    "path-prefix": pathprefix,
    "root-tiddler": $tw.Bob.settings['ws-server'].rootTiddler || "$:/core/save/all",
    "root-render-type": $tw.Bob.settings['ws-server'].renderType || "text/plain",
    "root-serve-type": $tw.Bob.settings['ws-server'].serveType || "text/html",
    "debug-level": $tw.Bob.settings['ws-server'].serveType || "none",
    "gzip": $tw.Bob.settings['ws-server'].serveType || "no"
  });
	$tw.Bob.httpServer = new SimpleServer({
		wiki: this.commander.wiki,
		variables: variables
	});
	let nodeServer = $tw.Bob.httpServer.listen();
  // Set up the the WebSocketServer
  $tw.Bob.sessionManager = new SessionManager($tw.wikiName);
  $tw.Bob.wsServer = new WebSocketServer({manager: $tw.Bob.sessionManager, noServer: true}); // We roll our own Upgrade
	$tw.hooks.invokeHook("th-server-command-post-start",$tw.Bob.httpServer,nodeServer,"tiddlywiki");

  /*
    The saver components
  */
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

  const basePath = $tw.ServerSide.getBasePath();
  $tw.Bob.settings.pluginsPath = $tw.Bob.settings.pluginsPath || './Plugins';
  if(typeof $tw.Bob.settings.pluginsPath === 'string') {
    const resolvedpluginspath = path.resolve(basePath, $tw.Bob.settings.pluginsPath);
    if(process.env["TIDDLYWIKI_PLUGIN_PATH"] !== undefined && process.env["TIDDLYWIKI_PLUGIN_PATH"] !== '') {
      process.env["TIDDLYWIKI_PLUGIN_PATH"] = process.env["TIDDLYWIKI_PLUGIN_PATH"] + path.delimiter + resolvedpluginspath;
    } else {
      process.env["TIDDLYWIKI_PLUGIN_PATH"] = resolvedpluginspath;
    }
  }
  $tw.Bob.settings.themesPath = $tw.Bob.settings.themesPath || './Themes';
  if(typeof $tw.Bob.settings.themesPath === 'string') {
    const resolvedthemespath = path.resolve(basePath, $tw.Bob.settings.themesPath);
    if(process.env["TIDDLYWIKI_THEME_PATH"] !== undefined && process.env["TIDDLYWIKI_THEME_PATH"] !== '') {
      process.env["TIDDLYWIKI_THEME_PATH"] = process.env["TIDDLYWIKI_THEME_PATH"] + path.delimiter + resolvedthemespath;
    } else {
      process.env["TIDDLYWIKI_THEME_PATH"] = resolvedthemespath;
    }
  }
  $tw.Bob.settings.editionsPath = $tw.Bob.settings.editionsPath || './Editions';
  if(typeof $tw.Bob.settings.editionsPath === 'string') {
    const resolvededitionspath = path.resolve(basePath, $tw.Bob.settings.editionsPath)
    if(process.env["TIDDLYWIKI_EDITION_PATH"] !== undefined && process.env["TIDDLYWIKI_EDITION_PATH"] !== '') {
      process.env["TIDDLYWIKI_EDITION_PATH"] = process.env["TIDDLYWIKI_EDITION_PATH"] + path.delimiter + resolvededitionspath;
    } else {
      process.env["TIDDLYWIKI_EDITION_PATH"] = resolvededitionspath;
    }
  }
  $tw.Bob.settings.languagesPath = $tw.Bob.settings.languagesPath || './Languages';
  if(typeof $tw.Bob.settings.languagesPath === 'string') {
    const resolvedlanguagespath = path.resolve(basePath, $tw.Bob.settings.languagesPath)
    if(process.env["TIDDLYWIKI_LANGUAGE_PATH"] !== undefined && process.env["TIDDLYWIKI_LANGUAGE_PATH"] !== '') {
      process.env["TIDDLYWIKI_LANGUAGE_PATH"] = process.env["TIDDLYWIKI_LANGUAGE_PATH"] + path.delimiter + resolvedlanguagespath;
    } else {
      process.env["TIDDLYWIKI_LANGUAGE_PATH"] = resolvedlanguagespath;
    }
  }

  // Get the ip address to display to make it easier for other computers to
  // connect.
  const ip = require('$:/plugins/OokTech/Bob/External/IP/ip.js');
  const ipAddress = ip.address();
  $tw.Bob.settings.serverInfo = {
    name: $tw.Bob.settings.serverName,
    ipAddress: ipAddress,
    port: port,
    host: host
  }
  // Avoid a memory leak
  $tw.PruneTimeout = setInterval(function(){
    $tw.Bob.PruneConnections();
  }, 10000);
  return null;
}
};

exports.Command = Command;

})();
