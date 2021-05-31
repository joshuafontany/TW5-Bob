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
      authenticatedUsername: state.authenticatedUsername,
      username: state.authenticatedUsername || state.server.get("anon-username") || "",
      anonymous: !state.authenticatedUsername,
      read_only: !state.server.isAuthorized("writers",state.authenticatedUsername),
      sse_enabled: state.server.get("sse-enabled") === "yes",
      space: {
        recipe: "default"
      },
      tiddlywiki_version: $tw.version,
      session: null
    };
  if(state.queryParameters && state.queryParameters["wiki"] && state.queryParameters["session"]) {
    let session = $tw.Bob.wsManager.getSession(state.queryParameters["session"],{
      url: state.urlInfo,
      ip: request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
      request.connection.remoteAddress,
      wikiName: state.queryParameters["wiki"],
      authenticatedUsername: !data.anonymous? data.authenticatedUsername: uuid_v4(),
      username: data.username,
      access: this.getUserAccess((data.anonymous)? null: data.authenticatedUsername,state.queryParameters["wiki"]),
      isLoggedIn: !!data.authenticatedUsername,
      isReadOnly: !!data.read_only,
      isAnonymous: !!data.anonymous
    });
    // Set a new login token and login tokenEOL. Only valid for 60 seconds.
    // These will be replaced with a session token during the "handshake".
    $tw.Bob.wsManager.refreshSession(session,1000*60)
    // Log the session in this.authorizedUsers or this.anonymousUsers
    // $tw.Bob.wsManager.updateUser(session);
    data.session = session.toJson();
  }
  let text = JSON.stringify(data);
  response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
  response.end(text,"utf8");
}

}());
