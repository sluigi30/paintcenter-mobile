// ─────────────────────────────────────────────────────────────
// THE single place the backend address lives.
//
// Local dev:  the laragon PC's LAN address (run `ipconfig` for the
//             current IP; the device must be on the same Wi-Fi).
//             Needs a debug build — cleartext http is allowed only there.
// Tester/prod: the Laravel Cloud backend,
//             'https://ncmpaintcenter-production-omxzmn.laravel.cloud'
// Change ONLY this line.
// ─────────────────────────────────────────────────────────────
const HOST = 'http://192.168.1.69:8000';

const API_URL     = `${HOST}/api`;      // REST endpoints
const STORAGE_URL = `${HOST}/storage`;  // product images, brand logos, swatches

export { HOST, API_URL, STORAGE_URL };
