import assert from "node:assert/strict";
import { parseApiBody } from "./api-response";

assert.equal(parseApiBody<void>(""), undefined);
assert.deepEqual(parseApiBody<{ ok: boolean }>('{"ok":true}'), { ok: true });
