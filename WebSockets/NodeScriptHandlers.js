/*\
title: $:/plugins/OokTech/Bob/NodeScriptHandlers.js
type: application/javascript
module-type: server-messagehandlers

These are message handler functions for the web socket servers. Use this file
as a template for extending the web socket funcitons.

This handles messages sent to the node process.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

  /*
    This message lets you run a script defined in the settings.json file.
    You name and define the script there and then you can run it using this.

    The script must be listed in the settings. You send the script name with the
    message and then it takes the information for it from the settings file.

    settings file entries should be like this:

    "name": "somecommand argument argument"

    it would be easiest to write a script and then just call the script using
    this.

    If sequential is set to true than each script will only run after the
    previous script has finished in the order they are received.
    It is possible to run non-sequential scripts and sequential scripts
    simultaneously.
  */
  // This function checks if a script is currently running, if not it runs the
  // next script in the queue.
  exports.processscriptQueue = function(queue) {
    if(!$tw.Bob.scriptActive[queue] && $tw.Bob.scriptQueue[queue].length > 0) {
      $tw.Bob.childproc = require('child_process').spawn($tw.Bob.scriptQueue[queue][0].command, $tw.Bob.scriptQueue[queue][0].args, $tw.Bob.scriptQueue[queue][0].options);
      $tw.Bob.scriptActive[queue] = true;
      $tw.Bob.childproc.on('error', function(err) {
        clearQueue(queue);
        $tw.Bob.logger.log('Script error: ', err, {level:1});
      })
      $tw.Bob.childproc.on('exit', function() {
        // Remove the finished task from the queue
        if($tw.Bob.scriptQueue[queue].length > 0) {
          $tw.Bob.scriptQueue[queue].shift();
        }
        // Set the queue as inactive
        $tw.Bob.scriptActive[queue] = false;
        // Process the next task in the queue, if any.
        this.processscriptQueue(queue);
      });
    }
  }
  exports.clearQueue = function(queue) {
    $tw.Bob.scriptQueue[queue] = [];
    if($tw.Bob.scriptActive[queue]) {
      $tw.Bob.childproc.kill('SIGINT');
    }
  }
  exports.runScript = function(data) {
    const path = require('path');
    if(data.name) {
      if($tw.Bob.settings.scripts) {
        if($tw.Bob.settings.scripts[data.name]) {
          if(typeof $tw.Bob.settings.scripts[data.name] === 'string') {
            let splitThing = $tw.Bob.settings.scripts[data.name].split(" ");
            const command = splitThing.shift(),
            args = splitThing || [],
            options = {
              //cwd: path.dirname(process.argv[0]),//process.cwd(),
              cwd: path.parse(process.argv[0]).name === 'node' ? path.dirname(process.argv[0]) : process.cwd(),
              detached: false,
              stdio: "inherit"
            };
            // If a command has an item that matches a property in the input
            // object than replace it with the value from the input object.
            Object.keys(data).forEach(function(item) {
              const index = args.indexOf(item);
              if(index !== -1) {
                args[index] = data[item];
              }
            });
            if(data.sequential) {
              data.queue = data.queue || 0;
              $tw.Bob.scriptActive[data.queue] = $tw.Bob.scriptActive[data.queue] || false;
              $tw.Bob.scriptQueue[data.queue] = $tw.Bob.scriptQueue[data.queue] || [];
              // Add the current script to the queue
              $tw.Bob.scriptQueue[data.queue].push({command: command, args: args, options: options, queue: data.queue});
              // Process the queue to run a command
              this.processscriptQueue(data.queue);
            } else {
              $tw.Bob.childproc = require('child_process').spawn(command, args, options);
              $tw.Bob.childproc.on('error', function(err) {
                const message = {
                  alert: 'Script error: ' + err,
                  connections: [data.source_connection]
                };
                $tw.ServerSide.sendBrowserAlert(message);
                $tw.Bob.logger.log('Script error: ', err, {level:1});
              })
            }
          }
        }
      }
    }
  }
  // Stop any currently running script queues
  exports.stopScripts = function(data) {
    data.queue = data.queue || 0;
    this.clearQueue(data.queue);
    const message = {
      alert: 'Stopped all running scripts.',
      wikis: [data.wiki]
    };
    $tw.ServerSide.sendBrowserAlert(message);
  }

})();
