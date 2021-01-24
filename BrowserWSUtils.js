/*\
module-type: utils
tags: 
title: $:/plugins/OokTech/Bob/BrowserWSUtils.js
type: application/javascript

Various websocket utility functions added to $tw.utils

\*/
(function(){
    /*jslint node: true, browser: true */
    /*global $tw: false */
    "use strict";
    /*
        Sets a browser cookie. Set the value to "" to clear the cookie.
    */
    exports.setcookie = function(cookieName, cookieValue) {
        if($tw.browser) {
            if(cookieName && cookieValue) {
                document.cookie = cookieName + "=" + cookieValue;
            } else if(cookieName) {
                // Clear the cookie if no value given.
                document.cookie = cookieName + "= ; expires = Thu, 01 Jan 1970 00:00:00 GMT";
            }
        }
    }
    
    /*

    
    exports.wildcardToRegExp = function (s) {
        return new RegExp(s.split(/\*+/).map($tw.utils.regExpEscape).join('.*'));
    }*/
    
})();