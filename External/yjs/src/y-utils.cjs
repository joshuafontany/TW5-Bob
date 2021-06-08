'use strict';

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
const closeConn = (session,docname) => {
  const doc = getYDoc($tw.Bob.Ydocs, docname)
  if(doc.sessions.has(session.id)) {
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
const openConn = (session, docname, { gc = true } = {}) => {
  // get doc, initialize if it does not exist yet
  const doc = getYDoc($tw.Bob.Ydocs, docname, gc)
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

/**
 * @param {WSSession} session
 * @param {any} docname
 * @param {any} opts
 */
const handleMessage = (eventData,session) => {
  // get doc, initialize if it does not exist yet
  const doc = getYDoc($tw.Bob.Ydocs, eventData.doc)
  if(doc.handlers.has(session.id)) {
    let handler = doc.handlers.get(session.id)
    handler(eventData)
  }
}
exports.handleMessage = handleMessage
