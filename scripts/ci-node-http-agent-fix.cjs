/**
 * firebase-tools (via google-auth-library → node-fetch@2) can fail token exchange
 * with "Premature close" on Node 22.23.0 when HTTP keepAlive is enabled.
 * See: https://github.com/firebase/firebase-tools/issues/10692
 */
require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;
