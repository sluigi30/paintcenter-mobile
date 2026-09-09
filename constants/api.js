// ─────────────────────────────────────────────────────────────
// THE single place the backend address lives.
//
// Production: the Laravel Cloud backend.
// Local dev:  swap to the laragon PC's LAN address, e.g.
//             'http://192.168.1.69:8000' (run `ipconfig` for the current IP).
// Change ONLY this line.
// ─────────────────────────────────────────────────────────────
const HOST = 'https://ncmpaintcenter-production-omxzmn.laravel.cloud';

const API_URL     = `${HOST}/api`;      // REST endpoints
const STORAGE_URL = `${HOST}/storage`;  // product images, brand logos, swatches

export { HOST, API_URL, STORAGE_URL };
