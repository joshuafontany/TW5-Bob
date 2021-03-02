/*\
title: $:/plugins/OokTech/Bob/ServerRoutes/get-status.js
type: application/javascript
module-type: serverroute

GET /^\/api\/status\/?$/

Returns server status information

\*/
(function() {

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.method = "GET";

exports.path = /^\/api\/status\/?$/;

exports.handler = function(request,response,state) {
  // build the status objects
  let data = {
      username: state.authenticatedUsername || state.server.get("anon-username") || "",
      anonymous: !state.authenticatedUsername,
      read_only: !state.server.isAuthorized("writers",state.authenticatedUsername),
      sse_enabled: state.server.get("sse-enabled") === "yes",
      space: {
        recipe: "default"
      },
      tiddlywiki_version: $tw.version
    };
  if(state.queryParameters && state.queryParameters["session"]) {
    state.ip = request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
    request.connection.remoteAddress;
    state.username = data.username;
    state.anonymous = data.anonymous;
    state.read_only = data.read_only;
    data.session = $tw.Bob.wsServer.manager.requestSession(state);
  }
  let text = JSON.stringify(data);debugger;
  response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
  response.end(text,"utf8");
}

}());
