import * as common from './common.js';
import * as auth from './auth.js';
import * as home from './home.js';
import * as receive from './receive.js';
import * as putaway from './putaway.js';
import * as pick from './pick.js';
import * as packship from './packship.js';
import * as count from './count.js';
import * as transfer from './transfer.js';
import * as gate from './gate.js';
import * as map from './map.js';
import * as map3d from './map3d.js';

const files = [common, auth, home, receive, putaway, pick, packship, count, transfer, gate, map, map3d];

function merge(lang) {
  const out = {};
  for (const file of files) {
    for (const [key, value] of Object.entries(file[lang])) {
      if (key in out) throw new Error(`Duplicate message key: ${key}`);
      out[key] = value;
    }
  }
  return out;
}

export const messages = { en: merge('en'), vi: merge('vi') };
