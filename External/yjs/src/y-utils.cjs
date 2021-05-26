const Y = require('./yjs.cjs')
const syncProtocol = require('./y-protocols/sync.cjs')
const awarenessProtocol = require('./y-protocols/awareness.cjs')

const encoding = require('../lib0/dist/encoding.cjs')
const decoding = require('../lib0/dist/decoding.cjs')
const mutex = require('../lib0/dist/mutex.cjs')
const map = require('../lib0/dist/map.cjs')

const {Base64} = require('../js-base64/base64.js');

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
       * @param {Object | null} origin Origin is the connection that made the change
       */
      const awarenessChangeHandler = ({ added, updated, removed }, origin) => {
        const changedClients = added.concat(updated, removed)
        if (origin !== null) {
          const connControlledIDs = /** @type {Set<number>} */ (this.sessions.get(origin))
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

exports.WSSharedDoc = WSSharedDoc

/**
 * Gets a Y.Doc by name, whether in memory or on disk
 *
 * @param {Map} store - the map storing the Ydocs
 * @param {string} docname - the name of the Y.Doc to find or create
 * @param {boolean} gc - whether to allow gc on the doc (applies only when created)
 * @return {WSSharedDoc || Y.doc}
 */
const getYDoc = (store, docname, gc = true) => map.setIfUndefined(store, docname, () => {
  const doc = !!$tw.node? new WSSharedDoc(docname): new Y.doc(docname)
  doc.gc = gc
  store.set(docname, doc)
  return doc
})

exports.getYDoc = getYDoc

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
      y: Base64.fromUint8Array(new Uint8Array(m))
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
      messageListener(session, doc, Base64.toUint8Array(event.y))
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
