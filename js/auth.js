var Auth = (function () {
  'use strict';

  var _currentUser = null;

  // Resolves once with the initial auth state (null = not logged in)
  function waitForUser() {
    return new Promise(function (resolve) {
      var unsub = firebase.auth().onAuthStateChanged(function (user) {
        unsub();
        _currentUser = user;
        resolve(user);
      });
    });
  }

  // Fires the callback on every future auth state change
  function onAuthStateChange(callback) {
    firebase.auth().onAuthStateChanged(function (user) {
      _currentUser = user;
      callback(user);
    });
  }

  async function login(email, password) {
    try {
      var cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      _currentUser = cred.user;
      return { success: true, user: cred.user };
    } catch (e) {
      // First-run: auto-create the admin account if it doesn't exist yet
      if ((e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') &&
          email.toLowerCase() === 'admin@garments.com') {
        try {
          var newCred = await firebase.auth().createUserWithEmailAndPassword(email, password);
          _currentUser = newCred.user;
          return { success: true, user: newCred.user };
        } catch (ce) {
          return { success: false, error: _msg(ce.code) };
        }
      }
      return { success: false, error: _msg(e.code) };
    }
  }

  async function logout() {
    try {
      await firebase.auth().signOut();
      _currentUser = null;
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  }

  function getCurrentUser() { return _currentUser; }

  function getDisplayName() {
    if (!_currentUser) return '';
    if (_currentUser.displayName) return _currentUser.displayName;
    var email = _currentUser.email || '';
    return email.split('@')[0] || email;
  }

  function _msg(code) {
    var map = {
      'auth/invalid-email':          'Invalid email address.',
      'auth/user-disabled':          'This account is disabled.',
      'auth/user-not-found':         'No account found with this email.',
      'auth/wrong-password':         'Incorrect password.',
      'auth/invalid-credential':     'Invalid email or password.',
      'auth/weak-password':          'Password must be at least 6 characters (try "admin1").',
      'auth/email-already-in-use':   'An account with this email already exists.',
      'auth/too-many-requests':      'Too many attempts — please try again later.',
      'auth/network-request-failed':     'Network error. Check your connection.',
      'auth/configuration-not-found':    'Email/Password sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.'
    };
    return map[code] || 'Authentication failed. Please try again.';
  }

  return {
    waitForUser:       waitForUser,
    onAuthStateChange: onAuthStateChange,
    login:             login,
    logout:            logout,
    getCurrentUser:    getCurrentUser,
    getDisplayName:    getDisplayName
  };
})();
