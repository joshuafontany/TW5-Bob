'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var Y = require('./yjs');
var idb = require('../lib0/dist/indexeddb.cjs');
var mutex = require('../lib0/dist/mutex.cjs');
var observable_js = require('../lib0/dist/observable.cjs');

const customStoreName = 'custom';
const updatesStoreName = 'updates';

const PREFERRED_TRIM_SIZE = 500;

/**
 * @param {IndexeddbPersistence} idbPersistence
 */
const fetchUpdates = idbPersistence => {
  const [updatesStore] = idb.transact(/** @type {IDBDatabase} */ (idbPersistence.db), [updatesStoreName]); // , 'readonly')
  return idb.getAll(updatesStore, idb.createIDBKeyRangeLowerBound(idbPersistence._dbref, false)).then(updates =>
    idbPersistence._mux(() =>
      idbPersistence.doc.transact(() =>
        updates.forEach(val => Y.applyUpdate(idbPersistence.doc, val))
      )
    )
  )
    .then(() => idb.getLastKey(updatesStore).then(lastKey => { idbPersistence._dbref = lastKey + 1; }))
    .then(() => idb.count(updatesStore).then(cnt => { idbPersistence._dbsize = cnt; }))
    .then(() => updatesStore)
};

/**
 * @param {IndexeddbPersistence} idbPersistence
 * @param {boolean} forceStore
 */
const storeState = (idbPersistence, forceStore = true) =>
  fetchUpdates(idbPersistence)
    .then(updatesStore => {
      if (forceStore || idbPersistence._dbsize >= PREFERRED_TRIM_SIZE) {
        idb.addAutoKey(updatesStore, Y.encodeStateAsUpdate(idbPersistence.doc))
          .then(() => idb.del(updatesStore, idb.createIDBKeyRangeUpperBound(idbPersistence._dbref, true)))
          .then(() => idb.count(updatesStore).then(cnt => { idbPersistence._dbsize = cnt; }));
      }
    });

/**
 * @param {string} name
 */
const clearDocument = name => idb.deleteDB(name);

/**
 * @extends Observable<string>
 */
class IndexeddbPersistence extends observable_js.Observable {
  /**
   * @param {string} name
   * @param {Y.Doc} doc
   */
  constructor (name, doc) {
    super();
    this.doc = doc;
    this.name = name;
    this._mux = mutex.createMutex();
    this._dbref = 0;
    this._dbsize = 0;
    /**
     * @type {IDBDatabase|null}
     */
    this.db = null;
    this.synced = false;
    this._db = idb.openDB(name, db =>
      idb.createStores(db, [
        ['updates', { autoIncrement: true }],
        ['custom']
      ])
    );
    /**
     * @type {Promise<IndexeddbPersistence>}
     */
    this.whenSynced = this._db.then(db => {
      this.db = db;
      const currState = Y.encodeStateAsUpdate(doc);
      return fetchUpdates(this).then(updatesStore => idb.addAutoKey(updatesStore, currState)).then(() => {
        this.emit('synced', [this]);
        this.synced = true;
        return this
      })
    });
    /**
     * Timeout in ms untill data is merged and persisted in idb.
     */
    this._storeTimeout = 1000;
    /**
     * @type {any}
     */
    this._storeTimeoutId = null;
    /**
     * @param {Uint8Array} update
     */
    this._storeUpdate = update =>
      this._mux(() => {
        if (this.db) {
          const [updatesStore] = idb.transact(/** @type {IDBDatabase} */ (this.db), [updatesStoreName]);
          idb.addAutoKey(updatesStore, update);
          if (++this._dbsize >= PREFERRED_TRIM_SIZE) {
            // debounce store call
            if (this._storeTimeoutId !== null) {
              clearTimeout(this._storeTimeoutId);
            }
            this._storeTimeoutId = setTimeout(() => {
              storeState(this, false);
              this._storeTimeoutId = null;
            }, this._storeTimeout);
          }
        }
      });
    doc.on('update', this._storeUpdate);
    this.destroy = this.destroy.bind(this);
    doc.on('destroy', this.destroy);
  }

  destroy () {
    if (this._storeTimeoutId) {
      clearTimeout(this._storeTimeoutId);
    }
    this.doc.off('update', this._storeUpdate);
    this.doc.off('destroy', this.destroy);
    return this._db.then(db => {
      db.close();
    })
  }

  /**
   * Destroys this instance and removes all data from indexeddb.
   *
   * @return {Promise<void>}
   */
  clearData () {
    return this.destroy().then(() => {
      idb.deleteDB(this.name);
    })
  }

  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @return {Promise<String | number | ArrayBuffer | Date | any>}
   */
  get (key) {
    return this._db.then(db => {
      const [custom] = idb.transact(db, [customStoreName], 'readonly');
      return idb.get(custom, key)
    })
  }

  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @param {String | number | ArrayBuffer | Date} value
   * @return {Promise<String | number | ArrayBuffer | Date>}
   */
  set (key, value) {
    return this._db.then(db => {
      const [custom] = idb.transact(db, [customStoreName]);
      return idb.put(custom, value, key)
    })
  }

  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @return {Promise<undefined>}
   */
  del (key) {
    return this._db.then(db => {
      const [custom] = idb.transact(db, [customStoreName]);
      return idb.del(custom, key)
    })
  }
}

exports.IndexeddbPersistence = IndexeddbPersistence;
exports.PREFERRED_TRIM_SIZE = PREFERRED_TRIM_SIZE;
exports.clearDocument = clearDocument;
exports.fetchUpdates = fetchUpdates;
exports.storeState = storeState;
