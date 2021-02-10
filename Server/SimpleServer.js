/*\
title: $:/plugins/OokTech/Bob/SimpleServer.js
type: application/javascript
module-type: library


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const Server = require("$:/core/modules/server/server.js").Server

/*
  A simple node server for Bob, extended from the core server module
  options: 
*/
function SimpleServer(options) {
  Server.call(this, options);
  this.addOtherRoutes();
}

SimpleServer.prototype = Object.create(Server.prototype);
SimpleServer.prototype.constructor = SimpleServer;

Server.prototype.defaultVariables = Server.defaultVariables;
Server.prototype.defaultVariables["required-plugins"] = ["OokTech/Bob"];

// Add methods to the Server prototype here.
// Add route but make sure it isn't a duplicate. (Un-used?)
SimpleServer.prototype.updateRoute = function(route) {
  // Remove any routes that have the same path as the input
  this.routes = this.routes.filter(function(thisRoute) {
    return String(thisRoute.path) !== String(route.path);
  });
  // Push on the new route.
  this.routes.push(route);
}

// This removes all but the root wiki from the routes
SimpleServer.prototype.clearRoutes = function() {
  // Remove any routes that don't match the root path
  this.routes = this.routes.filter(function(thisRoute) {
    return String(thisRoute.path) === String(/^\/$/) || String(thisRoute.path) === String(/^\/favicon.ico$/);
  });
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
  debugger;
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
  options.wiki = "RootWiki"; // Set Wiki here
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
		if (!this.wiki.getTiddler("$:/plugins/"+r)) {
			missing.push(r);
		}
	}
	if(missing.length > 0) {
		var warning = "Warning: Plugin(s) required for client-server operation are missing from tiddlywiki.info file: \"" + missing.join("\", \"") + "\"";
		$tw.utils.warning(warning);
	}
	// Create the server
	var server;
	if(this.listenOptions) {
		server = this.transport.createServer(this.listenOptions,this.requestHandler.bind(this));
	} else {
		server = this.transport.createServer(this.requestHandler.bind(this));
	}
	// Display the port number after we've started listening (the port number might have been specified as zero, or incremented, in which case we will get an assigned port)
	server.on("listening",function() {
		var address = server.address();
		$tw.utils.log("Serving on " + self.protocol + "://" + address.address + ":" + address.port + prefix,"brown/orange");
		$tw.utils.log("(press ctrl-C to exit)","red");
	});
  server.on('error', function(e) {
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
  server.on('upgrade', function(request,socket,head) {
    if(self.wss && request.headers.upgrade === 'websocket') {
      if(request.url === '/') {
        self.wss.handleUpgrade(request, socket, head, function(ws) {
          self.wss.emit('connection', ws, request);
        });
      } /*else if(request.url === '/api/federation/socket' && $tw.federationWss && $tw.Bob.settings.enableFederation === 'yes') {
        $tw.federationWss.handleUpgrade(request, socket, head, function(ws) {
          console.log('WSS federation upgrade')
          $tw.federationWss.emit('connection', ws, request);
        })
      }*/
    }
  });
	// Listen
	return server.listen(port,host);
};

/*
  Walk through the $tw.Bob.settings.wikis object and add a route for each listed wiki. The routes should make the wiki boot if it hasn't already.
*/
SimpleServer.prototype.addOtherRoutes = function() {
  // Add route handlers
  $tw.modules.forEachModuleOfType("serverroute", function(title, routeDefinition) {
    if(typeof routeDefinition === 'function') {
      $tw.Bob.httpServer.addRoute(routeDefinition());
    } else {
      $tw.Bob.httpServer.addRoute(routeDefinition);
    }
  });
  $tw.modules.forEachModuleOfType("wikiroute", function(title, routeDefinition) {
    if(typeof routeDefinition === 'function') {
      $tw.Bob.httpServer.addRoute(routeDefinition('RootWiki'));
    }
  });
  $tw.modules.forEachModuleOfType("fileroute", function(title, routeDefinition) {
    if(typeof routeDefinition === 'function') {
      $tw.Bob.httpServer.addRoute(routeDefinition('RootWiki'));
      $tw.Bob.httpServer.addRoute(routeDefinition(''));
    } else {
      $tw.Bob.httpServer.addRoute(routeDefinition);
    }
  });
  addRoutesThing($tw.Bob.settings.wikis, '');
}

SimpleServer.prototype.addRoutesThing = function(inputObject,prefix) {
  if(typeof inputObject === 'object') {
    Object.keys(inputObject).forEach(function(wikiName) {
      if(typeof inputObject[wikiName] === 'string') {
        let fullName = wikiName;
        if(prefix !== '') {
          if(wikiName !== '__path') {
            fullName = prefix + '/' + wikiName;
          } else {
            fullName = prefix;
          }
        }

        $tw.modules.forEachModuleOfType("wikiroute", function(title, routeDefinition) {
          if(typeof routeDefinition === 'function') {
            $tw.Bob.httpServer.addRoute(routeDefinition(fullName));
          }
        });
        $tw.modules.forEachModuleOfType("fileroute", function(title, routeDefinition) {
          if(typeof routeDefinition === 'function') {
            $tw.Bob.httpServer.addRoute(routeDefinition(fullName));
          }
        });
        //$tw.Bob.logger.log("Added route " + String(new RegExp('^\/' + fullName + '\/?$')), {level:1})
        console.log("Added route " + String(new RegExp('^\/' + fullName + '\/?$')))
      } else {
        // recurse!
        // This needs to be a new variable or else the rest of the wikis at
        // this level will get the longer prefix as well.
        const nextPrefix = prefix===''?wikiName:prefix + '/' + wikiName;
        this.addRoutesThing(inputObject[wikiName], nextPrefix);
      }
    })
  }
}

exports.SimpleServer = SimpleServer;

});