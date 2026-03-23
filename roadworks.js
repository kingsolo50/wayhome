// roadworks.js — Fetches live roadworks from UK public feeds
// Sources:
//   1. One.Network public GeoJSON API  (streetworks, council works)
//   2. Highways England DATEX II feed  (motorway & A-road works)

const axios = require('axios');
const xml2js = require('xml2js');

// ── Bounding box around a set of waypoints (with padding) ─────────────────────
function boundingBox(waypoints, padDeg = 0.15) {
  const lats = waypoints.map(w => w.lat);
  const lngs = waypoints.map(w => w.lng);
  return {
    minLat: Math.min(...lats) - padDeg,
    maxLat: Math.max(...lats) + padDeg,
    minLng: Math.min(...lngs) - padDeg,
    maxLng: Math.max(...lngs) + padDeg,
  };
}

// ── Point-in-box check ────────────────────────────────────────────────────────
function inBox(lat, lng, box) {
  return lat >= box.minLat && lat <= box.maxLat &&
         lng >= box.minLng && lng <= box.maxLng;
}

// ── Haversine distance (km) ───────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Distance from point to line segment ──────────────────────────────────────
function pointToSegmentDist(pLat, pLng, aLat, aLng, bLat, bLng) {
  const dx = bLng - aLng, dy = bLat - aLat;
  if (dx === 0 && dy === 0) return haversine(pLat, pLng, aLat, aLng);
  const t = Math.max(0, Math.min(1,
    ((pLng - aLng) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy)
  ));
  return haversine(pLat, pLng, aLat + t * dy, aLng + t * dx);
}

// ── Is a point near the route path? ──────────────────────────────────────────
function nearRoute(lat, lng, waypoints, thresholdKm = 2.5) {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const dist = pointToSegmentDist(
      lat, lng,
      waypoints[i].lat, waypoints[i].lng,
      waypoints[i + 1].lat, waypoints[i + 1].lng
    );
    if (dist <= thresholdKm) return true;
  }
  return false;
}

// ── Severity classifier ───────────────────────────────────────────────────────
function classifySeverity(item) {
  const text = (item.description + ' ' + (item.category || '') + ' ' + (item.status || '')).toLowerCase();
  if (/road closed|full closure|carriageway closed/.test(text)) return 'high';
  if (/lane closed|contraflow|traffic light|signals/.test(text)) return 'medium';
  return 'low';
}

// ── 1. One.Network streetworks feed ──────────────────────────────────────────
async function fetchOneNetwork(box) {
  // One.Network public works search endpoint (no auth required)
  const url = 'https://one.network/api/works_search.json';
  try {
    const res = await axios.get(url, {
      params: {
        bbox: `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`,
        status: 'open,proposed',
        limit: 200,
      },
      timeout: 10000,
      headers: { 'User-Agent': 'RoadworksChecker/1.0 (UK Route Monitor)' }
    });

    const features = res.data?.features || res.data?.works || [];
    return features.map(f => {
      const props = f.properties || f;
      const coords = f.geometry?.coordinates || [];
      const [lng, lat] = Array.isArray(coords[0]) ? coords[0] : coords;
      return {
        source: 'One.Network',
        id: props.works_reference || props.id || Math.random().toString(36).slice(2),
        description: props.works_description || props.description || 'Streetworks in progress',
        category: props.works_category || props.category || 'Streetworks',
        status: props.works_status || props.status || 'In Progress',
        road: props.street_name || props.road || 'Unknown road',
        startDate: props.proposed_start_date || props.start_date || null,
        endDate: props.proposed_end_date || props.end_date || null,
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
      };
    }).filter(w => w.lat !== 0 && w.lng !== 0);
  } catch (err) {
    console.warn('[One.Network] fetch failed:', err.message);
    return [];
  }
}

// ── 2. Highways England DATEX II (motorways & major A-roads) ─────────────────
async function fetchHighwaysEngland() {
  const url = 'https://api.data.gov.uk/v1/datastore/source/' +
    'highways-england/road-works?_format=json&_size=500';
  try {
    const res = await axios.get(url, { timeout: 12000 });
    const records = res.data?.result?.records || [];
    return records.map(r => ({
      source: 'Highways England',
      id: r.id || r.reference || Math.random().toString(36).slice(2),
      description: r.description || r.title || 'Highway works',
      category: r.category || 'Major Works',
      status: r.status || 'Active',
      road: r.road_name || r.road || r.location || 'Major road',
      startDate: r.start_date || null,
      endDate: r.end_date || null,
      lat: parseFloat(r.latitude || r.lat) || 0,
      lng: parseFloat(r.longitude || r.lng || r.lon) || 0,
    })).filter(w => w.lat !== 0 && w.lng !== 0);
  } catch {
    // Fallback: try the DATEX II XML feed
    return fetchHighwaysEnglandXML();
  }
}

async function fetchHighwaysEnglandXML() {
  // National Highways open data DATEX II feed
  const url = 'https://data.highways.gov.uk/roadworks/planned';
  try {
    const res = await axios.get(url, { timeout: 12000 });
    const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
    const situations = parsed?.d2LogicalModel?.payloadPublication?.situation || [];
    const arr = Array.isArray(situations) ? situations : [situations];
    return arr.map(s => {
      const record = s.situationRecord || {};
      const loc = record.groupOfLocations?.linearExtension?.openlrLinearLocationReference || {};
      return {
        source: 'National Highways',
        id: s.$?.id || Math.random().toString(36).slice(2),
        description: record.generalPublicComment?.comment?.values?.value?._ || 'Planned roadworks',
        category: 'Planned Works',
        status: record.validity?.validityStatus || 'Active',
        road: record.groupOfLocations?.locationContainedInItinerary?.location?.locationForDisplay?.name?.values?.value?._ || 'Major road',
        startDate: record.validity?.validityTimeSpecification?.overallStartTime || null,
        endDate: record.validity?.validityTimeSpecification?.overallEndTime || null,
        lat: parseFloat(record.groupOfLocations?.locationContainedInItinerary?.location?.locationForDisplay?.latitude) || 0,
        lng: parseFloat(record.groupOfLocations?.locationContainedInItinerary?.location?.locationForDisplay?.longitude) || 0,
      };
    }).filter(w => w.lat !== 0 && w.lng !== 0);
  } catch (err) {
    console.warn('[National Highways XML] fetch failed:', err.message);
    return [];
  }
}

// ── 3. TfL (London) road disruptions ─────────────────────────────────────────
async function fetchTfL(box) {
  // Only call TfL if the bounding box overlaps London roughly
  const londonBox = { minLat: 51.3, maxLat: 51.7, minLng: -0.5, maxLng: 0.3 };
  const overlaps = box.maxLat >= londonBox.minLat && box.minLat <= londonBox.maxLat &&
                   box.maxLng >= londonBox.minLng && box.minLng <= londonBox.maxLng;
  if (!overlaps) return [];

  try {
    const res = await axios.get('https://api.tfl.gov.uk/Road/all/Disruption', {
      params: { categories: 'RoadWorks', severities: 'Serious,Moderate,Minor' },
      timeout: 10000,
    });
    return (res.data || []).map(d => ({
      source: 'TfL',
      id: d.id || Math.random().toString(36).slice(2),
      description: d.description || d.comments || 'TfL road disruption',
      category: d.category || 'Road Works',
      status: d.status || 'Active',
      road: d.street || d.location || 'London road',
      startDate: d.startDateTime || null,
      endDate: d.endDateTime || null,
      lat: parseFloat(d.geography?.coordinates?.[1] || d.lat) || 0,
      lng: parseFloat(d.geography?.coordinates?.[0] || d.lng) || 0,
    })).filter(w => w.lat !== 0 && w.lng !== 0);
  } catch {
    return [];
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function checkRoadworks(route) {
  const box = boundingBox(route.waypoints);

  // Fetch all sources in parallel
  const [oneNet, highways, tfl] = await Promise.all([
    fetchOneNetwork(box),
    fetchHighwaysEngland(),
    fetchTfL(box),
  ]);

  const all = [...oneNet, ...highways, ...tfl];

  // Filter to works that are actually near this route
  const nearby = all.filter(w => nearRoute(w.lat, w.lng, route.waypoints));

  // Add severity
  nearby.forEach(w => { w.severity = classifySeverity(w); });

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  nearby.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    routeId: route.id,
    routeName: route.name,
    checkedAt: new Date().toISOString(),
    total: nearby.length,
    high: nearby.filter(w => w.severity === 'high').length,
    medium: nearby.filter(w => w.severity === 'medium').length,
    low: nearby.filter(w => w.severity === 'low').length,
    works: nearby,
  };
}

module.exports = { checkRoadworks };
