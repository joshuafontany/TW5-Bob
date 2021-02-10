/*\
title: $:/plugins/OokTech/Bob/ServerRoutes/post-delete-tiddler.js
type: application/javascript
module-type: serverroute

POST /^\/api\/tiddlers\/delete\/<<wikiname>>\/?$/

Delete a tiddler from a wiki

\*/
(function() {

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

const thePath = /^\/api\/tiddlers\/delete\/(.+?)\/?$/;
exports.method = "POST";
exports.path = thePath;
exports.handler = function(request,response,state) {
  $tw.Bob.settings.API = $tw.Bob.settings.API || {};
  if($tw.Bob.settings.API.enableDelete === 'yes') {
    const token = $tw.utils.getCookie(request.headers.cookie, 'token');
    const fromWiki = request.params[0];
    const authorised = $tw.Bob.wsServer.AccessCheck(fromWiki, token, 'edit', 'wiki');
    if(authorised) {
      let body = ''
      request.on('data', function(chunk){
        body += chunk;
        // We limit the size of a push to 5mb for now.
        if(body.length > 1e6) {
          response.writeHead(413, {'Content-Type': 'text/plain'}).end();
          request.connection.destroy();
        }
      });
      request.on('end', function() {
        try {
          const titleArray = JSON.parse(body).tiddlers;
          for(let i = 0; i < titleArray.length - 1; i++) {
            $tw.syncadaptor.deleteTiddler(titleArray[i], {prefix: fromWiki}, cbTest);
          }
          $tw.syncadaptor.deleteTiddler(titleArray[titleArray.length-1], {prefix: fromWiki}, cb);
          function cbTest(err, fileInfo){
            if(err){
              $tw.Bob.logger.log('API tiddlers/delete Error', fileInfo.filepath, err, {level: 3});
            }
            $tw.Bob.logger.log('API tiddlers/delete deleted file', fileInfo.filepath, {level: 3})
          }
          function cb(err, fileInfo) {
            if(err){
              $tw.Bob.logger.log('API tiddlers/delete Error', fileInfo.filepath, err, {level: 3});
            }
            $tw.Bob.logger.log('API tiddlers/delete deleted file', fileInfo.filepath, {level: 3})
            response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*"});
            response.end("{status:'ok'}");
          }
        } catch (e) {
          console.log(e)
          response.writeHead(403).end();
        }
      });
      request.on('error', function() {
        response.writeHead(403).end();
      });
    } else {
      response.writeHead(403).end();
    }
  }
}

}());
