/*\
title: $:/plugins/OokTech/Bob/SimpleServer.js
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
function SimpleServer(options) {
  Server.call(this, options);
  // Reserve a connetion to the httpServer
  this.httpServer = null;
  // Set the this.authorizationPrincipals['admin'] principles
  this.authorizationPrincipals['admin'] = this.get("admin").split(',').map($tw.utils.trim);
  // Add all the routes, this also adds authorization priciples for each wiki
  //this.addAllRoutes();
}

SimpleServer.prototype = Object.create(Server.prototype);
SimpleServer.prototype.constructor = SimpleServer;

SimpleServer.prototype.defaultVariables = Server.prototype.defaultVariables;
SimpleServer.prototype.defaultVariables["required-plugins"] = ["OokTech/Bob"];

SimpleServer.prototype.addRoute = function(route) {
  // Find out if the route exists
  let index = this.routes.findIndex((thisRoute) => thisRoute.path.toString() === route.path.toString());
  if (index === -1) {
    // Push the new route if not found
    this.routes.push(route);
  } else {
    // else replace the old route
    this.routes[index] = route;
  }
}

// This removes all but the root wiki from the routes
SimpleServer.prototype.clearRoutes = function() {
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

SimpleServer.prototype.findMatchingRoute = function(request,state) {
  let pathprefix = this.get("pathprefix") || "";
  pathprefix = pathprefix.startsWith("/") ? pathprefix : "/" + pathprefix;
  let pathname = decodeURIComponent(state.urlInfo.pathname);
  if(!pathname.startsWith(pathprefix)) {
    return null;
  }
  pathname = pathname.replace(pathprefix,'');
  pathname = pathname.startsWith('/') ? pathname : '/' + pathname;
  for(let t=0; t<this.routes.length; t++) {
    const potentialRoute = this.routes[t];
    let match;
    if(typeof potentialRoute.path.exec === 'function') {
      match = potentialRoute.path.exec(pathname);
    }
    if(match && request.method === potentialRoute.method) {
      request.params = [];
      for(let p=1; p<match.length; p++) {
        request.params.push(match[p]);
      }
      return potentialRoute;
    }
  }
  return null;
};

SimpleServer.prototype.requestHandler = function(request,response,options) {
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
  options.instance = $tw.Bob.Wikis.get(options.wikiName) || $tw;
  options.wiki = options.instance.wiki;
  // Call the parent method
  Object.getPrototypeOf(SimpleServer.prototype).requestHandler.call(this,request,response,options);
};

/*
  This function will try the default port, if that port is in use than it will
  increment port numbers until it finds an unused port.
  port: optional port number (falls back to value of "port" variable)
  host: optional host address (falls back to value of "host" variable)
  prefix: optional prefix (falls back to value of "path-prefix" variable)
*/
SimpleServer.prototype.listen = function(port,host,prefix) {
  var self = this;
	// Handle defaults for port and host
	port = port || this.get("port");
	host = host || this.get("host");
	prefix = prefix || this.get("path-prefix") || "";
	// Check for the port being a string and look it up as an environment variable
	if(parseInt(port,10).toString() !== port) {
		port = process.env[port] || 8080;
	}
	// Warn if required plugins are missing
	var missing = [];
	for (let index = 0; index < this.variables["required-plugins"].length; index++) {
		const r = this.variables["required-plugins"][index];
		if(!this.wiki.getTiddler("$:/plugins/"+r)) {
			missing.push(r);
		}
	}
	if(missing.length > 0) {
		var error = "Error: Plugin(s) required for client-server operation are missing from the command line or the tiddlywiki.info file: \"" + missing.join("\", \"") + "\"";
		$tw.utils.error(error);
	}
	// Create the server
	this.httpServer;
	if(this.listenOptions) {
		this.httpServer = this.transport.createServer(this.listenOptions,this.requestHandler.bind(this));
	} else {
		this.httpServer = this.transport.createServer(this.requestHandler.bind(this));
	}
	// Display the port number after we've started listening (the port number might have been specified as zero, or incremented, in which case we will get an assigned port)
	this.httpServer.on("listening",function() {
		var address = self.httpServer.address();
    self.httpServer.address = self.protocol + "://" + address.address + ":" + address.port + prefix;
		$tw.utils.log("Serving on " + self.httpServer.address,"brown/orange");
		$tw.utils.log("(press ctrl-C to exit)","red");
	});
  this.httpServer.on('error', function(e) {
    if($tw.Bob.settings['ws-server'].autoIncrementPort || typeof $tw.Bob.settings['ws-server'].autoIncrementPort === 'undefined') {
      if(e.code === 'EADDRINUSE') {
        console.log('Port ', port, ' in use, trying ', port+1);
        self.listen(Number(port)+1, host);
      }
    } else {
      //$tw.Bob.logger.error(e, {level:0});
      console.log(e);
    }
  });
  this.httpServer.on('upgrade', function(request,socket,head) {
    if($tw.Bob.wsServer && request.headers.upgrade === 'websocket') {
      // Verify the client here
      let state = self.verifyUpgrade(request);
      if(state){
        $tw.Bob.wsServer.handleUpgrade(request,socket,head,function(ws) {
          $tw.Bob.wsServer.emit('connection',ws,request,state);
        });
      }
    } else {
      console.log(`['${sesion.id}'] ws-server: upgrade request denied`);
      socket.close(4023, `['${sesion.id}'] Websocket closed by server`);
      return;
    }
  });
	// Listen
	return this.httpServer.listen(port,host);
};

SimpleServer.prototype.verifyUpgrade = function(request) {
  if(request.url.indexOf("wiki=") !== -1
  && request.url.indexOf("session=") !== -1) {
    // Compose the state object
    var state = {};
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
    state.username = state.authenticatedUsername || this.get("anon-username") || "";
    state.anonymous = !state.authenticatedUsername;
    state.readOnly = !this.isAuthorized("writers",state.authenticatedUsername);
    state.loggedIn = !state.anonymous && state.username !== "";
    state.wikiName = state.urlInfo.searchParams.get('wiki');
    state.sessionId = state.urlInfo.searchParams.get("session");
    if($tw.Bob.hasSession(state.sessionId)) {
      let session = $tw.Bob.getSession(state.sessionId);
      if(state.username == session.username
      && state.wikiName == session.wikiName) {
        return state;
      }
    } else {
      return false;
    }
  } else {
    return false;
  }
};

/*
  Load the server route modules of types: serverroute, wikiroute, fileroute
*/
SimpleServer.prototype.addAllRoutes = function() {
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
SimpleServer.prototype.addWikiRoutes = function(inputObject,prefix) {
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

exports.SimpleServer = SimpleServer;

}
})();