/* Firebase settings for the optional shared list.
 *
 * These are the same public client settings Showtime uses (same Firebase
 * project). They identify the project; they are not secrets. Access is decided
 * by the project's Firestore security rules, not by hiding this key.
 *
 * Keeping Stock only uses Firestore + Anonymous Auth (no Storage), so it works
 * on the free plan. See README.md for how the shared list is stored.
 */
window.HOMESTOCK_CONFIG = {
  firebase: {
    apiKey: "AIzaSyC-nCkVIGR5T2Hn6wYkm3sdqeNQFKXS1-c",
    authDomain: "showtime-family.firebaseapp.com",
    projectId: "showtime-family",
    messagingSenderId: "256408852477",
    appId: "1:256408852477:web:de112bb28da5fcf5fd6b94"
  }
};
