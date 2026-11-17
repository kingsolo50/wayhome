// sources.js — Live road works / closure feeds
//   • TfL Unified API (London)            — no key required
//   • National Highways DATEX II feed     — set NH_API_KEY (free from
//     https://developer.data.nationalhighways.co.uk); override the endpoint
//     with NH_API_URL if needed.

const axios = require('axios');
const xml2js = require('xml2js');

const HEADERS = { 'User-Agent': 'RoadworksChecker/1.0 (UK Route Monitor)' };
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

// Cache per-feed responses so checking several routes doesn't hammer the APIs
async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = await loader();
  cache.set(key, { at: Date.now(), data });
  return data;
}

// ── TfL road disruptions (works + closures) ──────────────────────────────────
const LONDON_BOX = { minLat: 51.2, maxLat: 51.75, minLng: -0.6, maxLng: 0.35 };

function overlapsLondon(box) {
  return box.maxLat >= LONDON_BOX.minLat && box.minLat <= LONDON_BOX.maxLat &&
         box.maxLng >= LONDON_BOX.minLng && box.minLng <= LONDON_BOX.maxLng;
}

// TfL geography is GeoJSON (lng,lat); `point` is a "[lng,lat]" string
function tflCoords(d) {
  const g = d.geography;
  if (g?.type === 'Point' && Array.isArray(g.coordinates)) return g.coordinates;
  if (typeof d.point === 'string') {
    try { return JSON.parse(d.point); } catch { /* fall through */ }
  }
  return [];
}

async function fetchTfL(box) {
  if (!overlapsLondon(box)) return [];
  try {
    const data = await cached('tfl', async () => {
      const res = await axios.get('https://api.tfl.gov.uk/Road/all/Disruption', {
        timeout: 15000, headers: HEADERS,
      });
      return res.data || [];
    });
    return data
      .filter(d => /works|closure|collision|accident|planned/i.test(d.category || ''))
      .map(d => {
        const [lng, lat] = tflCoords(d);
        const text = [d.comments, d.currentUpdate].filter(Boolean).join(' ');
        return {
          source: 'TfL',
          id: `tfl-${d.id}`,
          description: (d.hasClosures ? 'Road closure. ' : '') + (text || 'TfL road disruption'),
          category: d.category || 'Road Works',
          status: d.status || 'Active',
          road: d.corridorIds?.[0] ? d.location || d.corridorIds[0] : d.location || 'London road',
          startDate: d.startDateTime || null,
          endDate: d.endDateTime || null,
          closure: !!d.hasClosures,
          lat: parseFloat(lat) || 0,
          lng: parseFloat(lng) || 0,
        };
      })
      .filter(w => w.lat !== 0 && w.lng !== 0);
  } catch (err) {
    console.warn('[TfL] fetch failed:', err.message);
    return [];
  }
}

// ── National Highways DATEX II (motorways & A-roads, England) ────────────────
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ');
  if (typeof v === 'object') return textOf(v._ ?? v.value ?? v.values ?? Object.values(v));
  return String(v);
}

// Depth-first search for the first value stored under any of `keys`
function findKey(node, keys) {
  if (!node || typeof node !== 'object') return undefined;
  for (const k of Object.keys(node)) {
    if (keys.includes(k.replace(/^.*:/, ''))) return node[k];
  }
  for (const k of Object.keys(node)) {
    const found = findKey(node[k], keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectRecords(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const k of Object.keys(node)) {
    if (/(^|:)situationRecord$/.test(k)) {
      [].concat(node[k]).forEach(r => out.push(r));
    } else {
      collectRecords(node[k], out);
    }
  }
  return out;
}

async function fetchNationalHighways() {
  const key = process.env.NH_API_KEY;
  if (!key) return [];
  const url = process.env.NH_API_URL ||
    'https://api.data.nationalhighways.co.uk/roads/v2.0/closures';
  try {
    const records = await cached('nh', async () => {
      const res = await axios.get(url, {
        timeout: 20000,
        headers: { ...HEADERS, 'Ocp-Apim-Subscription-Key': key },
        responseType: 'text',
      });
      const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
      return collectRecords(parsed);
    });

    return records.map(r => {
      const lat = parseFloat(textOf(findKey(r, ['latitude'])));
      const lng = parseFloat(textOf(findKey(r, ['longitude'])));
      const type = (r.$ && r.$['xsi:type']) || '';
      const comment = textOf(findKey(r, ['generalPublicComment', 'comment']));
      const roadName = textOf(findKey(r, ['roadName', 'roadNumber', 'name']));
      const mgmt = textOf(findKey(r, ['roadOrCarriagewayOrLaneManagementType', 'networkManagementType']));
      const text = `${comment} ${mgmt}`;
      return {
        source: 'National Highways',
        id: `nh-${r.$?.id || textOf(findKey(r, ['situationRecordCreationReference']))}`,
        description: comment || mgmt || 'Highways works',
        category: /closure|closed/i.test(text) ? 'Road Closure' : (type.replace(/^.*:/, '') || 'Road Works'),
        status: textOf(findKey(r, ['validityStatus'])) || 'Active',
        road: roadName || 'Major road',
        startDate: textOf(findKey(r, ['overallStartTime'])) || null,
        endDate: textOf(findKey(r, ['overallEndTime'])) || null,
        closure: /road ?closed|carriageway ?closed|full closure/i.test(text),
        lat: lat || 0,
        lng: lng || 0,
      };
    }).filter(w => w.lat !== 0 && w.lng !== 0);
  } catch (err) {
    console.warn('[National Highways] fetch failed:', err.message);
    return [];
  }
}

module.exports = { fetchTfL, fetchNationalHighways };
