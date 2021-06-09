/*\
title: $:/plugins/OokTech/Bob/Server/Routes/get-ws-session.js
type: application/javascript
module-type: route

GET /^\/api\/status\/?$/

Returns server status information

\*/
(function() {

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.method = "GET";

exports.path = /^\/api\/ws-session$/;

exports.handler = function(request,response,state) {
  // build the session objects
  let doc, session;
  if(state.queryParameters && state.queryParameters["wiki"] && state.queryParameters["session"]) {
    doc = $tw.Bob.getYDoc(state.queryParameters["wiki"]);
    session = $tw.Bob.getSession(state.queryParameters["session"],doc,{
      connect: false,
      awareness: null,
      client: false,
      wikiName: state.queryParameters["wiki"],
      authenticatedUsername: state.authenticatedUsername? state.authenticatedUsername: uuid_v4(),
      username: state.authenticatedUsername || state.server.get("anon-username") || "",
      access: $tw.Bob.wsServer.getUserAccess((!state.authenticatedUsername)? null: state.authenticatedUsername,state.queryParameters["wiki"]),
      isLoggedIn: !!state.authenticatedUsername,
      isReadOnly: !state.server.isAuthorized("writers",state.authenticatedUsername),
      isAnonymous: !state.authenticatedUsername,
    });debugger;
    // Log the current ip & url
    session.ip = request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
    request.connection.remoteAddress;
    session.url = state.urlInfo;
    console.log(`['${session.id}'] IP: ${session.ip} GET ${session.url.href}`);
    // Set a new login token and login tokenEOL. Only valid for 60 seconds.
    $tw.Bob.refreshSession(session,1000*60)
  }
  let text = JSON.stringify(session.toJSON());
  response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
  response.end(text,"utf8");
}

}());
