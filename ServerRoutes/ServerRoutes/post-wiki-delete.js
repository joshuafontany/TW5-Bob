/*\
title: $:/plugins/OokTech/Bob/ServerRoutes/post-wiki-delete.js
type: application/javascript
module-type: serverroute

POST /^\/api\/wiki\/delete\/<<wikiName>>\/?/

Delete a wiki

\*/
(function() {

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const thePath = /^\/api\/wiki\/delete\/(.+?)\/?$/;
exports.method = "POST";
exports.path = thePath;
exports.handler = function(request,response,state) {
  $tw.Bob.settings.API = $tw.Bob.settings.API || {};
  if($tw.Bob.settings.API.enableDelete === 'yes') {
    const URL = require('url')
    const parsed = URL.parse(request.url);
    const params = {};
    if(parsed.query) {
      parsed.query.split('&').forEach(function(item) {
        const parts = item.split('=');
        params[parts[0]] = decodeURIComponent(parts[1]);
      })
    }
    const token = $tw.utils.getCookie(request.headers.cookie, 'token');
    const deleteChildren = params['deletechildren'];
    const toDelete = request.params[0];
    const authorised = $tw.Bob.wsServer.AccessCheck(toDelete, token, 'delete', 'wiki');
    if(authorised) {
      const data = {
        decoded: authorised,
        deleteWiki: toDelete,
        deleteChildren: deleteChildren
      }
      $tw.ServerSide.deleteWiki(data, cb);
      function cb(e) {
        if(e) {
          response.writeHead(500, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
          response.end("{status:'error', error: "+e+"}");
        }
        response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
        response.end("{status:'ok'}");
      }
    } else {
      response.writeHead(403);
      response.end();
    }
  }
}

}());
