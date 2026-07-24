/**
 * Cloth Shop Firebase - Data Layer Module
 * Abstraction over Firestore operations. All modules interact with Firestore through this layer.
 * Provides generic CRUD, batch operations, atomic increments, and connectivity state management.
 */
var DataLayer = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _db = null;
  var _online = true;
  var _connectionCallbacks = [];

  // ─── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initializes the data layer by obtaining the Firestore db instance
   * from FirebaseConfig and setting up connectivity listeners.
   * @returns {Promise<void>}
   */
  async function init() {
    _db = FirebaseConfig.getDb();

    if (!_db) {
      throw new Error('DataLayer: Firestore database instance is not available. Ensure FirebaseConfig.init() has been called successfully.');
    }

    _setupConnectivityListener();
  }

  /**
   * Sets up listeners for online/offline state changes.
   * Uses navigator.onLine events and Firestore snapshot metadata.
   * @private
   */
  function _setupConnectivityListener() {
    // Use browser online/offline events if available
    if (typeof window !== 'undefined') {
      _online = navigator.onLine;

      window.addEventListener('online', function () {
        _setOnlineState(true);
      });

      window.addEventListener('offline', function () {
        _setOnlineState(false);
      });
    }

    // Additionally use Firestore's special connectivity document if available
    // The .info/connected reference is only available in Realtime Database,
    // so for Firestore we rely on snapshot metadata (hasPendingWrites/fromCache)
    // and the navigator events above.
  }

  /**
   * Updates online state and notifies registered callbacks.
   * @param {boolean} isOnline - New connectivity state
   * @private
   */
  function _setOnlineState(isOnline) {
    var previousState = _online;
    _online = isOnline;

    if (previousState !== _online) {
      for (var i = 0; i < _connectionCallbacks.length; i++) {
        try {
          _connectionCallbacks[i](_online);
        } catch (e) {
          console.error('DataLayer: Connection callback error:', e);
        }
      }
    }
  }

  // ─── Generic CRUD Operations ────────────────────────────────────────────────

  /**
   * Adds a new document to the specified Firestore collection.
   * @param {string} collection - Collection name
   * @param {object} data - Document data to store
   * @returns {Promise<string>} The generated document ID
   */
  async function addDocument(collection, data) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!collection) throw new Error('DataLayer: Collection name is required.');
    if (!data || typeof data !== 'object') throw new Error('DataLayer: Document data must be a non-null object.');

    var docRef = await _db.collection(collection).add(data);
    return docRef.id;
  }

  /**
   * Retrieves a single document by ID from the specified collection.
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID
   * @returns {Promise<object|null>} Document data with id field, or null if not found
   */
  async function getDocument(collection, docId) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!collection) throw new Error('DataLayer: Collection name is required.');
    if (!docId) throw new Error('DataLayer: Document ID is required.');

    var docRef = _db.collection(collection).doc(docId);
    var snapshot = await docRef.get();

    if (!snapshot.exists) {
      return null;
    }

    var data = snapshot.data();
    data.id = snapshot.id;
    return data;
  }

  /**
   * Updates an existing document in the specified collection.
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID to update
   * @param {object} data - Fields to update (partial update)
   * @returns {Promise<void>}
   */
  async function updateDocument(collection, docId, data) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!collection) throw new Error('DataLayer: Collection name is required.');
    if (!docId) throw new Error('DataLayer: Document ID is required.');
    if (!data || typeof data !== 'object') throw new Error('DataLayer: Update data must be a non-null object.');

    var docRef = _db.collection(collection).doc(docId);
    await docRef.update(data);
  }

  /**
   * Deletes a document from the specified collection.
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID to delete
   * @returns {Promise<void>}
   */
  async function deleteDocument(collection, docId) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!collection) throw new Error('DataLayer: Collection name is required.');
    if (!docId) throw new Error('DataLayer: Document ID is required.');

    var docRef = _db.collection(collection).doc(docId);
    await docRef.delete();
  }

  /**
   * Queries documents from a collection with optional constraints.
   * @param {string} collection - Collection name
   * @param {object} [queryConstraints] - Query constraints object
   * @param {Array} [queryConstraints.where] - Array of where clauses: [{field, op, value}]
   * @param {Array} [queryConstraints.orderBy] - Array of orderBy clauses: [{field, direction}]
   * @param {number} [queryConstraints.limit] - Maximum number of documents to return
   * @returns {Promise<Array<object>>} Array of document objects with id field
   */
  async function queryDocuments(collection, queryConstraints) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!collection) throw new Error('DataLayer: Collection name is required.');

    var query = _db.collection(collection);

    if (queryConstraints) {
      // Apply where clauses
      if (queryConstraints.where && Array.isArray(queryConstraints.where)) {
        for (var i = 0; i < queryConstraints.where.length; i++) {
          var clause = queryConstraints.where[i];
          if (clause.field && clause.op && clause.value !== undefined) {
            query = query.where(clause.field, clause.op, clause.value);
          }
        }
      }

      // Apply orderBy clauses
      if (queryConstraints.orderBy && Array.isArray(queryConstraints.orderBy)) {
        for (var j = 0; j < queryConstraints.orderBy.length; j++) {
          var order = queryConstraints.orderBy[j];
          if (order.field) {
            query = query.orderBy(order.field, order.direction || 'asc');
          }
        }
      }

      // Apply limit
      if (queryConstraints.limit && typeof queryConstraints.limit === 'number' && queryConstraints.limit > 0) {
        query = query.limit(queryConstraints.limit);
      }
    }

    var snapshot = await query.get();
    var results = [];

    snapshot.forEach(function (doc) {
      var data = doc.data();
      data.id = doc.id;
      results.push(data);
    });

    return results;
  }

  // ─── Batch Operations ───────────────────────────────────────────────────────

  /**
   * Executes a Firestore batch write with an array of operations.
   * All operations succeed or fail atomically.
   * @param {Array<object>} operations - Array of operation objects
   * @param {string} operations[].type - Operation type: 'set', 'update', or 'delete'
   * @param {string} operations[].collection - Target collection name
   * @param {string} operations[].docId - Document ID (for update/delete; optional for set to auto-generate)
   * @param {object} [operations[].data] - Document data (for set/update operations)
   * @returns {Promise<void>}
   */
  async function executeBatch(operations) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      throw new Error('DataLayer: Operations array must be a non-empty array.');
    }

    // Firestore batch limit is 500 operations
    if (operations.length > 500) {
      throw new Error('DataLayer: Batch operations cannot exceed 500.');
    }

    var batch = _db.batch();

    for (var i = 0; i < operations.length; i++) {
      var op = operations[i];

      if (!op.collection) {
        throw new Error('DataLayer: Operation at index ' + i + ' is missing collection.');
      }
      if (!op.type) {
        throw new Error('DataLayer: Operation at index ' + i + ' is missing type.');
      }

      var docRef;

      switch (op.type) {
        case 'set':
          if (op.docId) {
            docRef = _db.collection(op.collection).doc(op.docId);
          } else {
            docRef = _db.collection(op.collection).doc();
          }
          batch.set(docRef, op.data || {});
          break;

        case 'update':
          if (!op.docId) {
            throw new Error('DataLayer: Update operation at index ' + i + ' requires a docId.');
          }
          docRef = _db.collection(op.collection).doc(op.docId);
          batch.update(docRef, op.data || {});
          break;

        case 'delete':
          if (!op.docId) {
            throw new Error('DataLayer: Delete operation at index ' + i + ' requires a docId.');
          }
          docRef = _db.collection(op.collection).doc(op.docId);
          batch.delete(docRef);
          break;

        default:
          throw new Error('DataLayer: Unknown operation type "' + op.type + '" at index ' + i + '. Use "set", "update", or "delete".');
      }
    }

    await batch.commit();
  }

  // ─── Atomic Field Increment ─────────────────────────────────────────────────

  /**
   * Atomically increments a numeric field in a document.
   * Uses firebase.firestore.FieldValue.increment() for safe concurrent updates.
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID
   * @param {string} field - Field name to increment
   * @param {number} amount - Amount to increment by (can be negative for decrement)
   * @returns {Promise<void>}
   */
  async function incrementField(collection, docId, field, amount) {
    if (!_db) throw new Error('DataLayer: Not initialized.');
    if (!collection) throw new Error('DataLayer: Collection name is required.');
    if (!docId) throw new Error('DataLayer: Document ID is required.');
    if (!field) throw new Error('DataLayer: Field name is required.');
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('DataLayer: Amount must be a valid number.');
    }

    var docRef = _db.collection(collection).doc(docId);
    var updateData = {};
    updateData[field] = firebase.firestore.FieldValue.increment(amount);

    await docRef.update(updateData);
  }

  // ─── Connectivity Management ────────────────────────────────────────────────

  /**
   * Registers a callback that fires when connectivity state changes.
   * @param {Function} callback - Function called with true (online) or false (offline)
   */
  function onConnectionChange(callback) {
    if (typeof callback !== 'function') {
      throw new Error('DataLayer: Callback must be a function.');
    }
    _connectionCallbacks.push(callback);
  }

  /**
   * Returns the current connection state.
   * @returns {boolean} true if online, false if offline
   */
  function isOnline() {
    return _online;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    addDocument: addDocument,
    getDocument: getDocument,
    updateDocument: updateDocument,
    deleteDocument: deleteDocument,
    queryDocuments: queryDocuments,
    executeBatch: executeBatch,
    incrementField: incrementField,
    onConnectionChange: onConnectionChange,
    isOnline: isOnline
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataLayer;
}
