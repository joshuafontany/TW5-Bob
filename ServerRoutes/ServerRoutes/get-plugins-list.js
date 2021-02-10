/*\
title: $:/plugins/OokTech/Bob/ServerRoutes/get-plugins-list.js
type: application/javascript
module-type: serverroute

GET /^\/api\/plugins\/list\/?$/

fetch a list of available plugins

\*/
(function() {

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.method = "GET";

exports.path = /^\/api\/plugins\/list\/?$/;

exports.handler = function(request,response,state) {
  $tw.Bob.settings.API = $tw.Bob.settings.API || {};
  if($tw.Bob.settings.API.pluginLibrary === 'yes') {
    const token = $tw.utils.getCookie(request.headers.cookie, 'token');
    const pluginList = $tw.ServerSide.getViewablePluginsList({decoded: token})
    response.writeHead(200, {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"})
    response.end(JSON.stringify(pluginList))
  } else {
    response.writeHead(403).end()
  }
};

}());
