// roadworks.js — Fetches live roadworks from UK public feeds
// Sources live in sources.js (TfL, National Highways).

const axios = require('axios');
const { fetchTfL, fetchNationalHighways } = require('./sources');

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
  if (item.closure) return 'high';
  const text = (item.description + ' ' + (item.category || '') + ' ' + (item.status || '')).toLowerCase();
  if (/road closed|full closure|carriageway closed/.test(text)) return 'high';
  if (/lane closed|contraflow|traffic light|signals/.test(text)) return 'medium';
  return 'low';
}

// ── Calculate route duration using OSRM ─────────────────────────────────────
async function calculateRouteDuration(waypoints) {
  if (waypoints.length < 2) return { durationMinutes: 0, durationSeconds: 0, error: 'Need at least 2 waypoints' };

  try {
    // Build OSRM coordinates string: lng,lat;lng,lat;...
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/car/${coords}`;

    const res = await axios.get(url, {
      params: {
        overview: 'false',
        steps: 'false',
      },
      timeout: 8000,
      headers: { 'User-Agent': 'RoadworksChecker/1.0' }
    });

    if (res.data?.routes?.[0]?.duration) {
      const durationSeconds = Math.round(res.data.routes[0].duration);
      const durationMinutes = Math.round(durationSeconds / 60);
      const distanceMeters = Math.round(res.data.routes[0].distance);
      const distanceKm = (distanceMeters / 1000).toFixed(2);
      return {
        durationSeconds,
        durationMinutes,
        distanceMeters,
        distanceKm: parseFloat(distanceKm),
        estimatedSpeed: ((distanceMeters / durationSeconds) * 3.6).toFixed(1), // km/h
      };
    }
    return { durationMinutes: 0, error: 'Could not calculate duration' };
  } catch (err) {
    console.warn('[OSRM Duration]', err.message);
    return { durationMinutes: 0, error: err.message };
  }
}

// ── Identify congestion hotspots (clusters of roadworks) ─────────────────────
function identifyCongestionHotspots(works, route) {
  if (works.length === 0) return [];

  // Group nearby works (within 2km) into hotspots
  const hotspots = [];
  const visited = new Set();

  works.forEach((work, idx) => {
    if (visited.has(idx)) return;

    const cluster = [work];
    visited.add(idx);

    // Find nearby works
    works.forEach((other, otherIdx) => {
      if (visited.has(otherIdx)) return;
      const dist = haversine(work.lat, work.lng, other.lat, other.lng);
      if (dist <= 2.0) {
        cluster.push(other);
        visited.add(otherIdx);
      }
    });

    // Calculate cluster centroid
    const avgLat = cluster.reduce((sum, w) => sum + w.lat, 0) / cluster.length;
    const avgLng = cluster.reduce((sum, w) => sum + w.lng, 0) / cluster.length;

    // Find closest point on route
    let distToRoute = Infinity;
    let segmentIdx = 0;
    for (let i = 0; i < route.waypoints.length - 1; i++) {
      const dist = pointToSegmentDist(
        avgLat, avgLng,
        route.waypoints[i].lat, route.waypoints[i].lng,
        route.waypoints[i + 1].lat, route.waypoints[i + 1].lng
      );
      if (dist < distToRoute) {
        distToRoute = dist;
        segmentIdx = i;
      }
    }

    // Estimate distance from route start (cumulative)
    let distFromStart = 0;
    for (let i = 0; i < segmentIdx; i++) {
      distFromStart += haversine(
        route.waypoints[i].lat, route.waypoints[i].lng,
        route.waypoints[i + 1].lat, route.waypoints[i + 1].lng
      );
    }
    distFromStart += distToRoute;

    const severity = cluster.some(w => w.severity === 'high') ? 'high' :
                     cluster.some(w => w.severity === 'medium') ? 'medium' : 'low';

    hotspots.push({
      lat: parseFloat(avgLat.toFixed(5)),
      lng: parseFloat(avgLng.toFixed(5)),
      severity: severity,
      workCount: cluster.length,
      distFromStart: parseFloat(distFromStart.toFixed(2)),
      works: cluster.map(w => ({
        description: w.description,
        category: w.category,
        road: w.road,
      })),
    });
  });

  // Sort by distance from start
  return hotspots.sort((a, b) => a.distFromStart - b.distFromStart);
}

// ── Estimate traffic congestion level ────────────────────────────────────────
async function estimateTrafficCongestion(route, roadworks) {
  try {
    // Base congestion level: number and severity of roadworks
    let congestionScore = 0;
    let congestionDetails = {
      level: 'free',
      severity: 0, // 0-100 scale
      factors: [],
      roadworks_impact: 0,
    };

    // Factor 1: Impact from roadworks
    if (roadworks.high > 0) {
      congestionScore += roadworks.high * 30;
      congestionDetails.factors.push(`${roadworks.high} high-severity roadwork${roadworks.high > 1 ? 's' : ''}`);
    }
    if (roadworks.medium > 0) {
      congestionScore += roadworks.medium * 15;
      congestionDetails.factors.push(`${roadworks.medium} medium-severity roadwork${roadworks.medium > 1 ? 's' : ''}`);
    }
    if (roadworks.low > 0) {
      congestionScore += roadworks.low * 5;
      congestionDetails.factors.push(`${roadworks.low} low-severity roadwork${roadworks.low > 1 ? 's' : ''}`);
    }

    congestionDetails.roadworks_impact = Math.min(100, roadworks.total * 10);

    // Factor 2: Time of day heuristic (approximate rush hours)
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    let timeImpact = 0;

    if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Weekday
      if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) { // Rush hours
        timeImpact = 25;
        congestionDetails.factors.push('Rush hour detected');
      } else if (hour >= 6 && hour <= 22) { // Daytime
        timeImpact = 10;
      }
    } else { // Weekend
      timeImpact = 5;
    }
    congestionScore += timeImpact;

    // Calculate congestion level
    congestionDetails.severity = Math.min(100, congestionScore);

    if (congestionDetails.severity === 0) {
      congestionDetails.level = 'free';
    } else if (congestionDetails.severity < 20) {
      congestionDetails.level = 'light';
    } else if (congestionDetails.severity < 50) {
      congestionDetails.level = 'moderate';
    } else if (congestionDetails.severity < 75) {
      congestionDetails.level = 'heavy';
    } else {
      congestionDetails.level = 'severe';
    }

    return congestionDetails;
  } catch (err) {
    console.warn('[Traffic Estimation]', err.message);
    return { level: 'unknown', severity: 0, factors: [], error: err.message };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function checkRoadworks(route) {
  const box = boundingBox(route.waypoints);

  // Fetch all sources in parallel
  const [highways, tfl] = await Promise.all([
    fetchNationalHighways(),
    fetchTfL(box),
  ]);

  const all = [...highways, ...tfl];

  // Keep only ongoing works near this route, de-duplicated by id
  const now = Date.now();
  const seen = new Set();
  const nearby = all.filter(w => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    const start = w.startDate ? Date.parse(w.startDate) : NaN;
    const end = w.endDate ? Date.parse(w.endDate) : NaN;
    if (!isNaN(start) && start > now) return false;
    if (!isNaN(end) && end < now) return false;
    return nearRoute(w.lat, w.lng, route.waypoints);
  });

  // Add severity
  nearby.forEach(w => { w.severity = classifySeverity(w); });

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  nearby.sort((a, b) => order[a.severity] - order[b.severity]);

  // Calculate route duration
  const duration = await calculateRouteDuration(route.waypoints);

  // Estimate traffic congestion
  const congestion = await estimateTrafficCongestion(route, {
    total: nearby.length,
    high: nearby.filter(w => w.severity === 'high').length,
    medium: nearby.filter(w => w.severity === 'medium').length,
    low: nearby.filter(w => w.severity === 'low').length,
  });

  // Identify congestion hotspots
  const hotspots = identifyCongestionHotspots(nearby, route);

  return {
    routeId: route.id,
    routeName: route.name,
    checkedAt: new Date().toISOString(),
    total: nearby.length,
    high: nearby.filter(w => w.severity === 'high').length,
    medium: nearby.filter(w => w.severity === 'medium').length,
    low: nearby.filter(w => w.severity === 'low').length,
    works: nearby,
    duration: duration,
    traffic: congestion,
    hotspots: hotspots,
  };
}

module.exports = { checkRoadworks };
