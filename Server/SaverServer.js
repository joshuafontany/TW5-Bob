/*\
title: $:/plugins/OokTech/Bob/SaverServer.js
type: application/javascript
module-type: library

A very stripped down "Saver" server. This can probably be extended from
$:/core/modules/server/server.js later on?

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

let http = require ("http");

/*
    A node "saver" server 
    options: 
*/
function SaverServer(options) {
  //Server.call(this, options);
  // Initialise the variables
	this.variables = $tw.utils.extend({},this.defaultVariables);
	if(options.variables) {
		for(var variable in options.variables) {
			if(options.variables[variable]) {
				this.variables[variable] = options.variables[variable];
			}
		}		
	}
	$tw.utils.extend({},this.defaultVariables,options.variables);
}

//SaverServer.prototype = Object.create(Server.prototype);
SaverServer.prototype.constructor = SaverServer;

SaverServer.prototype.defaultVariables = {
	port: "61192",
	host: "127.0.0.1",
}

SaverServer.prototype.get = function(name) {
	return this.variables[name];
};

/*
Listen for requests
port: optional port number (falls back to value of "port" variable)
host: optional host address (falls back to value of "host" variable)
prefix: optional prefix (falls back to value of "path-prefix" variable)
*/
SaverServer.prototype.listen = function(port,host) {
  var self = this;
	// Handle defaults for port and host
	port = port || this.get("port");
	host = host || this.get("host");
  const saver = http.createServer(this.handleSaverRequest);
  // Display the port number after we've started listening (the port number might have been specified as zero, in which case we will get an assigned port)
	saver.on("listening",function() {
		$tw.utils.log("Bob saver server running on " + "http" + "://" + host + ":" + port,"brown/orange");
	});
  saver.on('error', function(e) {
    if($tw.Bob.settings['ws-server'].autoIncrementPort || typeof $tw.Bob.settings['ws-server'].autoIncrementPort === 'undefined') {
      if(e.code === 'EADDRINUSE') {
        //$tw.Bob.logger.error('Port conflict with the saver server, do you have Bob running already?', e,{level:0})
        console.log('Port conflict with the saver server, do you have Bob running already?')
      }
    } else {
      //$tw.Bob.logger.error(e, {level:0});
      console.log(e)
    }
  });
  return saver.listen(port,host);
}

SaverServer.prototype.handleSaverRequest = function(request,response) {
  let body = '';
  response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-file-path, x-saver-key"});
  if(request.url.endsWith('/save')) {
    request.on('data', function(chunk){
      body += chunk;
      // We limit this to 100mb, this could change if people have gigantic
      // wkis.
      if(body.length > 100e6) {
        response.writeHead(413, {'Content-Type': 'text/plain'}).end();
        request.connection.destroy();
      }
    });
    request.on('end', function() {
      // The body should be the html text of a wiki
      body = body.replace(/^message=/, '');
      const responseData = {'ok':'no'};
      const filepath = request.headers['x-file-path'];
      const key = request.headers['x-saver-key'];
      const match = (key === $tw.Bob.settings.saver.key) || (typeof $tw.Bob.settings.saver.key === 'undefined');
      if(typeof body === 'string' && body.length > 0 && filepath && match) {
        // Write the file
        const fs = require('fs');
        const path = require('path');
        if(['.html', '.htm', '.hta'].indexOf(path.extname(filepath)) === -1) {
          response.writeHead(403, {'Content-Type': 'text/plain'}).end();
        }
        // Make sure that the path exists, if so save the wiki file
        fs.writeFile(path.resolve(filepath),body,{encoding: "utf8"},function(err) {
          if(err) {
            //$tw.Bob.logger.error(err, {level:1});
            console.log(err)
            responseData.error = err;
          } else {
            //$tw.Bob.logger.log('saved file', filepath, {level:2});
            console.log('saved file', filepath)
            responseData.ok = 'yes';
          }
          response.end(JSON.stringify(responseData));
        });
      } else {
        response.end(JSON.stringify(responseData));
      }
    });
  } else if(request.url.endsWith('/check')) {
    response.end('{"ok":"yes"}')
  }
}

exports.SaverServer = SaverServer;
});