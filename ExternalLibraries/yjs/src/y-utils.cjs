const Y = require('./yjs.cjs')
const syncProtocol = require('./y-protocols/sync.cjs')
const awarenessProtocol = require('./y-protocols/awareness.cjs')
const WebsocketProvider = require('./y-wsbob.cjs').WebsocketProvider

const encoding = require('../lib0/dist/encoding.cjs')
const decoding = require('../lib0/dist/decoding.cjs')
const mutex = require('../lib0/dist/mutex.cjs')
const map = require('../lib0/dist/map.cjs')

// disable gc when using snapshots!
const gcEnabled = !!$tw.node? (process.env.GC !== 'false' && process.env.GC !== '0'): true;

const messageSync = 0
const messageAwareness = 1
// const messageAuth = 2

/**
 * @param {Uint8Array} update
 * @param {WSSession} origin
 * @param {WSSharedDoc} doc
 */
const updateHandler = (update, origin, doc) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeUpdate(encoder, update)
  const message = encoding.toUint8Array(encoder)
  doc.sessions.forEach((s, _) => send(doc, s, message))
}

class WSSharedDoc extends Y.Doc {
  /**
   * @param {string} name
   */
  constructor (name) {
    super({ gc: gcEnabled })
    this.name = name
    if(!!$tw.node) {
      this.mux = mutex.createMutex()
      /**
       * Maps from session to set of controlled user ids & session/doc specific handlers. Delete all user ids from awareness, and clear handlers when this session is closed
       * @type {Map<Object, Set<number>>}
       */
      this.sessions = new Map()
      this.handlers = new Map()
      /**
       * @type {awarenessProtocol.Awareness}
       */
      this.awareness = new awarenessProtocol.Awareness(this)
      this.awareness.setLocalState(null)
      /**
       * @param {{ added: Array<number>, updated: Array<number>, removed: Array<number> }} changes
       * @param {Object | null} session Origin is the connection that made the change
       */
      const awarenessChangeHandler = ({ added, updated, removed }, session) => {
        const changedClients = added.concat(updated, removed)
        if (session !== null) {
          const connControlledIDs = /** @type {Set<number>} */ (this.sessions.get(session))
          if (connControlledIDs !== undefined) {
            added.forEach(clientID => { connControlledIDs.add(clientID) })
            removed.forEach(clientID => { connControlledIDs.delete(clientID) })
          }
        }
        // broadcast awareness update
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageAwareness)
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients))
        const buff = encoding.toUint8Array(encoder)
        this.sessions.forEach((s, _) => {
          send(this, s, buff)
        })
      }
      this.awareness.on('update', awarenessChangeHandler)
      this.on('update', updateHandler)
    }
  }
}

/**
 * Gets a Y.Doc by name, whether in memory or on disk
 *
 * @param {string} docname - the name of the Y.Doc to find or create
 * @param {boolean} gc - whether to allow gc on the doc (applies only when created)
 * @return {WSSharedDoc}
 */
const getYDoc = (docname, gc = true) => map.setIfUndefined($tw.Bob.Ydocs, docname, () => {
  const doc = new WSSharedDoc(docname)
  doc.gc = gc
  $tw.Bob.Ydocs.set(docname, doc)
  return doc
})

exports.getYDoc = getYDoc

/**
 * Gets a Y.Doc provider by name, whether in memory or on disk
 *
 * @param {WSSession} session - the session with id to find or create
 * @param {WSSharedDoc} doc - the name of the Y.Doc to link to the session provider
 * @return {WebsocketProvider}
 */
 const getProvider = (session,docname) => {
  let sessionMap = map.setIfUndefined($tw.Bob.wsManager.yproviders, session.id, () => {
    let sessionMap = new Map();
    $tw.Bob.wsManager.yproviders.set(session.id,sessionMap)
    return sessionMap;
  });
  return map.setIfUndefined(sessionMap, docname, () => {
    const doc = getYDoc(docname)
    const provider = new WebsocketProvider(session,doc)
    sessionMap.set(docname,provider)
    return provider
  })
}

exports.getProvider = getProvider

/**
 * @param {any} session
 * @param {WSSharedDoc} doc
 * @param {Uint8Array} message
 */
const messageListener = (session, doc, message) => {
  const encoder = encoding.createEncoder()
  const decoder = decoding.createDecoder(message)
  const messageType = decoding.readVarUint(decoder)
  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, doc, null)
      if (encoding.length(encoder) > 1) {
        send(doc, session, encoding.toUint8Array(encoder))
      }
      break
    case messageAwareness: {
      awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), session)
      break
    }
  }
}

/**
 * @param {WSSharedDoc} doc
 * @param {Uuid_v4} sessionId
 * @param {Uint8Array} m
 */
 const send = (doc, session, m) => {
  try {
    let message = {
      type: "y",
      doc: doc.name,
      y: Array.from(new Uint8Array(m))
    }
    session.sendMessage(message, /** @param {any} err */ err => { err != null && closeConn(session,doc.name) })
  } catch (e) {
    closeConn(session,doc.name)
  }
}

/**
 * @param {WSSharedDoc} doc
 * @param {WSSession} session
 */
 closeConn = (session,docname) => {
  const doc = getYDoc(docname)
  if (doc.sessions.has(session.id)) {
    /**
     * @type {Set<number>}
     */
    // @ts-ignore
    const controlledIds = doc.sessions.get(session.id)
    doc.sessions.delete(session.id)
    doc.handlers.delete(session.id)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)
  }
}
exports.closeConn = closeConn

/**
 * @param {WSSession} session
 * @param {any} docname
 * @param {any} opts
 */
openConn = (session, docname, { gc = true } = {}) => {
  // get doc, initialize if it does not exist yet
  const doc = getYDoc(docname, gc)
  doc.sessions.set(session.id, new Set())

  // listen and reply to y message events
  if(!doc.handlers.has(session.id)) {
    doc.handlers.set(session.id,(event) => {
      /** @param {json} event */
      messageListener(session, doc, new Uint8Array(event.y))
    })
  }

  // send sync step 1
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeSyncStep1(encoder, doc)
  send(doc, session, encoding.toUint8Array(encoder))
  const awarenessStates = doc.awareness.getStates()
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())))
    send(doc, session, encoding.toUint8Array(encoder))
  }
}

exports.openConn = openConn
