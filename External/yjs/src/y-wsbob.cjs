'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

require('./yjs.cjs');
const bc = require('../lib0/dist/broadcastchannel.cjs');
const encoding = require('../lib0/dist/encoding.cjs');
const decoding = require('../lib0/dist/decoding.cjs');
const syncProtocol = require('./y-protocols/sync.cjs');
const authProtocol = require('./y-protocols/auth.cjs');
const awarenessProtocol = require('./y-protocols/awareness.cjs');
const mutex = require('../lib0/dist/mutex.cjs');
const observable_js = require('../lib0/dist/observable.cjs');
const {Base64} = require('../js-base64/base64.js');

/*
Unlike stated in the LICENSE file, it is not necessary to include the copyright notice and permission notice when you copy code from this file.
*/

const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;
const messageQueryAwareness = 3;
const messageSyncSubdoc = 4;

/**
 *                       encoder,          decoder,          provider,          emitSynced, messageType
 * @type {Array<function(encoding.Encoder, decoding.Decoder, WebsocketProvider, boolean,    number):void>}
 */
const messageHandlers = [];

messageHandlers[messageSync] = (encoder, decoder, provider, emitSynced, messageType) => {
  encoding.writeVarUint(encoder, messageSync);
  const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, provider.doc, provider);
  if (emitSynced && syncMessageType === syncProtocol.messageYjsSyncStep2 && !provider.synced) {
    provider.synced = true;
  }
};

messageHandlers[messageQueryAwareness] = (encoder, decoder, provider, emitSynced, messageType) => {
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(provider.awareness, Array.from(provider.awareness.getStates().keys())));
};

messageHandlers[messageAuth] = (encoder, decoder, provider, emitSynced, messageType) => {
  authProtocol.readAuthMessage(decoder, provider.doc, permissionDeniedHandler);
};

messageHandlers[messageAwareness] = (encoder, decoder, provider, emitSynced, messageType) => {
  awarenessProtocol.applyAwarenessUpdate(provider.awareness, decoding.readVarUint8Array(decoder), provider);
};

messageHandlers[messageSyncSubdoc] = (encoder, decoder, provider, emitSynced, messageType) => {
  encoding.writeVarUint(encoder, messageSyncSubdoc);
  const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, provider.doc, provider);
  if (emitSynced && syncMessageType === syncProtocol.messageYjsSyncStep2 && !provider.synced) {
    provider.synced = true;
  }
};

/**
 * @param {WebsocketProvider} provider
 * @param {string} reason
 */
const permissionDeniedHandler = (provider, reason) => console.warn(`Permission denied to access ${provider.url}.\n${reason}`);

/**
 * @param {WebsocketProvider} provider
 * @param {Uint8Array} buf
 * @param {boolean} emitSynced
 * @return {encoding.Encoder}
 */
const readMessage = (provider, buf, emitSynced) => {
  const decoder = decoding.createDecoder(buf);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);
  const messageHandler = provider.messageHandlers[messageType];
  if (/** @type {any} */ (messageHandler)) {
    messageHandler(encoder, decoder, provider, emitSynced, messageType);
  } else {
    console.error('Unable to compute message');
  }
  return encoder
};

/**
 * @param {WebsocketProvider} provider
 */
const setupWS = provider => {
  if (provider.session && provider.session.isReady()) {
    provider.wsconnected = true;
    provider.synced = false;
    // listen and reply to y message events
    if(!provider.handler) {
      provider.handler = event => {
        const encoder = readMessage(provider, Base64.toUint8Array(event.y), true);
        if (encoding.length(encoder) > 1) {
          let message = {
            type: "y",
            doc: provider.doc.name,
            y: Base64.fromUint8Array(new Uint8Array(encoding.toUint8Array(encoder)))
          }
          provider.session.sendMessage(message);
        }
      };
    }
    provider.emit('status', [{
      status: 'connected'
    }]);
    // always send sync step 1 when connected
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, provider.doc);
    let message = {
      type: "y",
      doc: provider.doc.name,
      y: Base64.fromUint8Array(new Uint8Array(encoding.toUint8Array(encoder)))
    }
    provider.session.sendMessage(message);
    // broadcast local awareness state
    if (provider.awareness.getLocalState() !== null) {
      const encoderAwarenessState = encoding.createEncoder();
      encoding.writeVarUint(encoderAwarenessState, messageAwareness);
      encoding.writeVarUint8Array(encoderAwarenessState, awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [provider.doc.clientID]));
      let message = {
        type: "y",
        doc: provider.doc.name,
        y: Base64.fromUint8Array(new Uint8Array(encoding.toUint8Array(encoderAwarenessState)))
      }
      provider.session.sendMessage(message);
    }
  }
};

/**
 * @param {WebsocketProvider} provider
 * @param {ArrayBuffer} buf
 */
const broadcastMessage = (provider, buf) => {
  if (provider.session) {
    let message = {
      type: "y",
      doc: provider.doc.name,
      y: Base64.fromUint8Array(new Uint8Array(buf).values())
    }
    provider.session.sendMessage(message);
  }
  if (provider.bcconnected) {
    provider.mux(() => {
      bc.publish(provider.bcChannel, buf);
    });
  }
};

/**
 * Websocket Provider for Yjs. Creates a websocket connection to sync the shared document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 *   import * as Y from 'yjs'
 *   import { WebsocketProvider } from 'y-websocket'
 *   const doc = new Y.Doc()
 *   const provider = new WebsocketProvider('http://localhost:1234', 'my-document-name', doc)
 *
 * @extends {Observable<string>}
 */
class WebsocketProvider extends observable_js.Observable {
  /**
   * @param {WSSession} session
   * @param {Y.Doc} doc
   * @param {object} [opts]
   * @param {awarenessProtocol.Awareness} [opts.awareness]
   * @param {number} [opts.resyncInterval] Request server state every `resyncInterval` milliseconds
   */
  constructor (session, doc, {awareness = new awarenessProtocol.Awareness(doc), resyncInterval = -1} = {}) {
    super();
    this.session = session;
    this.bcChannel = session.url.hostname + session.url.pathname;
    this.roomname = session.wikiName;
    this.doc = doc;
    this.awareness = awareness;
    this.wsconnected = false;
    this.bcconnected = false;
    this.messageHandlers = messageHandlers.slice();
    this.mux = mutex.createMutex();
    /**
     * @type {boolean}
     */
    this._synced = false;

    /**
     * @type {number}
     */
    this._resync = () => {
      if(this.session.isReady()) {
        // resend sync step 1
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeSyncStep1(encoder, doc);
        let message = {
          type: "y",
          doc: this.doc.name,
          y: Base64.fromUint8Array(new Uint8Array(encoding.toUint8Array(encoder)))
        }
        this.session.sendMessage(message);
      }
    }

    /**
     * @param {ArrayBuffer} data
     */
    this._bcSubscriber = data => {
      this.mux(() => {
        const encoder = readMessage(this, new Uint8Array(data), false);
        if (encoding.length(encoder) > 1) {
          bc.publish(this.bcChannel, encoding.toUint8Array(encoder));
        }
      });
    };
    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._updateHandler = (update, origin) => {
      if (origin !== this) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      }
    };
    this.doc.on('update', this._updateHandler);
    /**
     * @param {any} changed
     * @param {any} origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
      broadcastMessage(this, encoding.toUint8Array(encoder));
    };
    if(!!$tw.browser) {
      window.addEventListener('beforeunload', () => {
        awarenessProtocol.removeAwarenessStates(this.awareness, [doc.clientID], 'window unload');
      });
    }
    awareness.on('update', this._awarenessUpdateHandler);

    this.destroy = () => {
      this.closeConn();
      this.awareness.off('update', this._awarenessUpdateHandler);
      this.doc.off('update', this._updateHandler);
      super.destroy();
    }

    this.closeConn = () => {
      if (this.wsconnected) {
        let provider = this;
        provider.wsconnected = false;
        provider.synced = false;
        // update awareness (all users except local left)
        awarenessProtocol.removeAwarenessStates(provider.awareness, Array.from(provider.awareness.getStates().keys()).filter(client => client !== provider.doc.clientID), provider);
        provider.emit('status', [{
          status: 'disconnected'
        }]);
      }
      this.disconnectBc();
    }
  
    this.openConn = () =>{
      if(!this.wsconnected) {
        setupWS(this);
      }
      this.connectBc();
    }

    this.openConn();
  }

  /**
   * @type {boolean}
   */
  get synced () {
    return this._synced
  }

  set synced (state) {
    if (this._synced !== state) {
      this._synced = state;
      this.emit('synced', [state]);
      this.emit('sync', [state]);
    }
  }

  connectBc () {
    if (!this.bcconnected) {
      bc.subscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = true;
    }
    // send sync step1 to bc
    this.mux(() => {
      // write sync step 1
      const encoderSync = encoding.createEncoder();
      encoding.writeVarUint(encoderSync, messageSync);
      syncProtocol.writeSyncStep1(encoderSync, this.doc);
      bc.publish(this.bcChannel, encoding.toUint8Array(encoderSync));
      // broadcast local state
      const encoderState = encoding.createEncoder();
      encoding.writeVarUint(encoderState, messageSync);
      syncProtocol.writeSyncStep2(encoderState, this.doc);
      bc.publish(this.bcChannel, encoding.toUint8Array(encoderState));
      // write queryAwareness
      const encoderAwarenessQuery = encoding.createEncoder();
      encoding.writeVarUint(encoderAwarenessQuery, messageQueryAwareness);
      bc.publish(this.bcChannel, encoding.toUint8Array(encoderAwarenessQuery));
      // broadcast local awareness state
      const encoderAwarenessState = encoding.createEncoder();
      encoding.writeVarUint(encoderAwarenessState, messageAwareness);
      encoding.writeVarUint8Array(encoderAwarenessState, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
      bc.publish(this.bcChannel, encoding.toUint8Array(encoderAwarenessState));
    });
  }

  disconnectBc () {
    // broadcast message with local awareness state set to null (indicating disconnect)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID], new Map()));
    broadcastMessage(this, encoding.toUint8Array(encoder));
    if (this.bcconnected) {
      bc.unsubscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = false;
    }
  }
}

exports.WebsocketProvider = WebsocketProvider;

