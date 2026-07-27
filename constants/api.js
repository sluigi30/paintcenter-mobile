// ─────────────────────────────────────────────────────────────
// THE single place the backend address lives.
// New device / new network? Run `ipconfig` on the PC serving
// Laravel and change ONLY this line.
// ─────────────────────────────────────────────────────────────
const HOST = 'http://192.168.1.69:8000';

const API_URL     = `${HOST}/api`;      // REST endpoints
const STORAGE_URL = `${HOST}/storage`;  // product images, brand logos, swatches

export { HOST, API_URL, STORAGE_URL };
