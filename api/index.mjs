import { bridge } from "../manager/bridge.mjs";
export default { fetch: (request) => bridge(request) };
