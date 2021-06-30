/*\
title: $:/plugins/OokTech/Bob/MultiServer.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

if($tw.node) {
  const Server = require("$:/core/modules/server/server.js").Server;
  const querystring = require("querystring");

/*
  A simple node server for Bob, extended from the core server module
  options: 
*/
function MultiServer(options) {
  Server.call(this, options);
  // Reserve a connetion to the httpServer
  this.httpServer = null;
  // Initialise admin authorization principles
	var authorizedUserName = (this.get("username") && this.get("password")) ? this.get("username") : null;
  this.authorizationPrincipals['admin'] = (this.get("admin") || authorizedUserName).split(',').map($tw.utils.trim);
  // Add all the routes, this also adds authorization priciples for each wiki
  //this.addAllRoutes();
}

MultiServer.prototype = Object.create(Server.prototype);
MultiServer.prototype.constructor = MultiServer;

MultiServer.prototype.defaultVariables = Server.prototype.defaultVariables;

// This removes all but the root wiki from the routes
MultiServer.prototype.clearRoutes = function() {
  // Remove any routes that don't match the root path
  this.routes = this.routes.filter(function(thisRoute) {
    return String(thisRoute.path) === String(/^\/$/) || String(thisRoute.path) === String(/^\/favicon.ico$/);
  });
  // Remove any added authorizationPrinciples
  let baseTypes = ["admin","readers","writers"]
  let clearedPrinciples = {};
  Object.keys(this.authorizationPrinciples).forEach(function(thisType) {
    if(baseTypes.indexOf(thisType) !== -1) {
      clearedPrinciples[thisType] == authorizatonPrinciples[thisTypes];
    };
  });
  this.authorizationPrinciples = clearedPrinciples;
}

MultiServer.prototype.requestHandler = function(request,response,options) {
  options = options || {};
  // Test for OPTIONS
  if(request.method === 'OPTIONS') {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE"
    })
    response.end()
    return
  }
  // Compose the options object
  options.instance = $tw.Bob.Wikis.get(options.wikiName);
  options.wiki = options.instance.wiki;
  // Call the parent method
  Object.getPrototypeOf(MultiServer.prototype).requestHandler.call(this,request,response,options);
};

/*
  This function will try the default port, if that port is in use than it will
  increment port numbers until it finds an unused port.
  port: optional port number (falls back to value of "port" variable)
  host: optional host address (falls back to value of "host" variable)
  prefix: optional prefix (falls back to value of "path-prefix" variable)
*/
MultiServer.prototype.listen = function(port,host,prefix) {
  let listen = Server.prototype.listen.call(this,port,host,prefix);
  let self = this;
  this.httpServer.on('upgrade', function(request,socket,head) {
    if($tw.Bob.wsServer && request.headers.upgrade === 'websocket') {
      // Verify the client here
      let state = self.verifyUpgrade(request);
      if(state){
        $tw.Bob.wsServer.handleUpgrade(request,socket,head,function(ws) {
          $tw.Bob.wsServer.emit('connection',ws,request,state);
        });
      } else {
        console.log(`ws-server: Unauthorized Upgrade GET ${request.url}`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }
  });
	return listen
};

MultiServer.prototype.verifyUpgrade = function(request) {
  if(request.url.indexOf("wiki=") !== -1
  && request.url.indexOf("session=") !== -1) {
    // Compose the state object
    var state = {};
    state.server = this;
    state.ip = request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
      request.connection.remoteAddress;
    state.urlInfo = new $tw.Bob.url(request.url,this.httpServer.address);
    state.pathPrefix = request.pathPrefix || this.get("path-prefix") || "";
    // Get the principals authorized to access this resource
    var authorizationType = "readers";
    // Check whether anonymous access is granted
    state.allowAnon = this.isAuthorized(authorizationType,null);
    // Authenticate with the first active authenticator
    let fakeResponse = {
      writeHead: function(){},
      end: function(){}
    }
    if(this.authenticators.length > 0) {
      if(!this.authenticators[0].authenticateRequest(request,fakeResponse,state)) {
        // Bail if we failed (the authenticator will have -not- sent the response)
        return false;
      }		
    }
    // Authorize with the authenticated username
    if(!this.isAuthorized(authorizationType,state.authenticatedUsername)) {
      return false;
    }
    state.sessionId = state.urlInfo.searchParams.get("session");
    if($tw.Bob.hasSession(state.sessionId)) {
      let session = $tw.Bob.getSession(state.sessionId);
      return state.authenticatedUsername == session.authenticatedUsername
        && state.urlInfo.searchParams.get('wiki') == session.wikiName
        && state
    }
  } else {
    return false;
  }
};

/*
  Load the server route modules of types: serverroute, wikiroute, fileroute
*/
MultiServer.prototype.addAllRoutes = function() {
  let self = this;
  // Add route handlers
  $tw.modules.forEachModuleOfType("serverroute", function(title, routeDefinition) {
    if(typeof routeDefinition === 'function') {
      self.addRoute(routeDefinition());
    } else {
      self.addRoute(routeDefinition);
    }
  });
  $tw.modules.forEachModuleOfType("wikiroute", function(title, routeDefinition) {
    if(typeof routeDefinition === 'function') {
      self.addRoute(routeDefinition('RootWiki'));
    }
  });
  $tw.modules.forEachModuleOfType("fileroute", function(title, routeDefinition) {
    if(typeof routeDefinition === 'function') {
      self.addRoute(routeDefinition('RootWiki'));
      self.addRoute(routeDefinition(''));
    } else {
      self.addRoute(routeDefinition);
    }
  });
  this.addWikiRoutes($tw.Bob.settings.wikis, '');
};

/*
  Walk through the $tw.Bob.settings.wikis object and add a route for each listed wiki. 
  Log each wiki's authorizationPrincipals as `${wikiName}\readers` & `${wikinName}\writers`.
  The routes should make the wiki boot if it hasn't already.
*/
MultiServer.prototype.addWikiRoutes = function(inputObject,prefix) {
  if(typeof inputObject === 'object') {
    let self = this,
      readers = this.authorizationPrincipals[(prefix)? prefix+"/readers": "readers"],
      writers = this.authorizationPrincipals[(prefix)? prefix+"/writers": "writers"],
      wikis = Object.keys(inputObject);
    wikis.forEach(function(wikiName) {
      let fullName = (!!prefix)? prefix + '/' + wikiName: wikiName;
      // Add the authorized principles
      if(!!inputObject[wikiName].readers) {
        readers = inputObject[wikiName].readers.split(',').map($tw.utils.trim);
      }
      if(!!inputObject[wikiName].writers) {
        writers = inputObject[wikiName].writers.split(',').map($tw.utils.trim);
      }
      self.authorizationPrincipals[fullName+"/readers"] = readers;
      self.authorizationPrincipals[fullName+"/writers"] = writers;
      // Setup the routes
      $tw.modules.forEachModuleOfType("wikiroute", function(title, routeDefinition) {
        if(typeof routeDefinition === 'function') {
          self.addRoute(routeDefinition(fullName));
        }
      });
      $tw.modules.forEachModuleOfType("fileroute", function(title, routeDefinition) {
        if(typeof routeDefinition === 'function') {
          self.addRoute(routeDefinition(fullName));
        }
      });
      $tw.Bob.loadWiki(fullName);
      //$tw.Bob.logger.log("Added route " + String(new RegExp('^\/' + fullName + '\/?$')), {level:1})
      console.log("Added route " + String(new RegExp('^\/' + fullName + '\/?$')))
      // recurse!
      if(!!inputObject[wikiName].wikis) {
        // This needs to be a new variable or else the rest of the wikis at
        // this level will get the longer prefix as well.
        const nextPrefix = (!!prefix)? prefix + '/' + wikiName: wikiName;
        self.addWikiRoutes(inputObject[wikiName].wikis, nextPrefix);
      }
    })
  }
};

exports.MultiServer = MultiServer;

}
})();