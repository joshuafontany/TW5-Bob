/*\
title: $:/plugins/OokTech/Bob/Server/Routes/get-status.js
type: application/javascript
module-type: route

GET /^\/status\/?$/

Returns server status information

\*/
(function() {

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.method = "GET";

exports.path = /^\/status$/;

exports.handler = function(request,response,state) {
  // build the status objects
  let session;
  if(state.queryParameters && state.queryParameters["wiki"] && state.queryParameters["session"]) {
    session = $tw.Bob.createSession({
      id: state.queryParameters["session"],
      wikiName: state.queryParameters["wiki"],
      authenticatedUsername: state.authenticatedUsername? state.authenticatedUsername: uuid_v4(),
      username: state.authenticatedUsername || state.server.get("anon-username") || "",
      access: $tw.Bob.wsServer.getUserAccess((!state.authenticatedUsername)? null: state.authenticatedUsername,state.queryParameters["wiki"]),
      isLoggedIn: !!state.authenticatedUsername,
      isReadOnly: !state.server.isAuthorized("writers",state.authenticatedUsername),
      isAnonymous: !state.authenticatedUsername,
      doc: $tw.Bob.getYDoc(state.queryParameters["wiki"]),
      client: false,
      connect: false,
      ip: request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
      request.connection.remoteAddress
    });
    session.url = state.urlInfo;
    // Set a login window for 60 seconds.
    $tw.Bob.refreshSession(session,1000*60)
    console.log(`['${session.id}'] IP: ${session.ip} GET ${session.url.href}`);
  }
  let text = {
		username: state.authenticatedUsername || state.server.get("anon-username") || "",
		anonymous: !state.authenticatedUsername,
		read_only: !state.server.isAuthorized("writers",state.authenticatedUsername),
		sse_enabled: state.server.get("sse-enabled") === "yes",
		space: {
			recipe: "default"
		},
		tiddlywiki_version: $tw.version,
    session: session.toJSON()
	}
  response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
  response.end(JSON.stringify(text),"utf8");
}

}());
