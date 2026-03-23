# 🚧 Roadworks Checker

One-touch roadworks alerts for your saved UK routes. Built with Node.js + Express.

---

## Quick Start

```bash
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

---

## Setup Your Routes

Edit **`routes.js`** to add your own routes:

```js
{
  id: "home-work",
  name: "Home → Work",
  icon: "🏠",
  colour: "#3b82f6",
  waypoints: [
    { lat: 51.5177, lng: -0.0810, label: "My House" },
    { lat: 51.5074, lng: -0.0278, label: "Office" }
  ]
}
```

**Find your coordinates:** Right-click any location on [Google Maps](https://maps.google.com) → "What's here?" — or use [latlong.net](https://www.latlong.net/).

Add as many waypoints as you need to accurately trace your route. Works within **2.5km either side** of your path.

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                  Roadworks Checker                       │
│                                                         │
│  1. ROUTE LOAD   ──►  routes.js → browser UI            │
│                                                         │
│  2. BUTTON PRESS ──►  GET /api/check/:routeId           │
│                                                         │
│  3. DATA FETCH   ──►  Three parallel sources:           │
│                       ├─ One.Network (streetworks)      │
│                       ├─ National Highways DATEX II     │
│                       └─ TfL (London only)              │
│                                                         │
│  4. FILTER       ──►  Works within 2.5km of your route  │
│                                                         │
│  5. ALERT        ──►  Severity-coded results + toast    │
└─────────────────────────────────────────────────────────┘
```

---

## Data Sources

| Source | Coverage | Auth needed |
|---|---|---|
| **One.Network** | All UK streetworks | None (public API) |
| **National Highways** | Motorways & major A-roads | None (open data) |
| **TfL** | Greater London roads | None (public API) |

---

## Severity Levels

| Level | Triggers |
|---|---|
| 🔴 **HIGH** | Road closed, full closure, carriageway closed |
| 🟡 **MEDIUM** | Lane closure, contraflow, traffic signals |
| 🟢 **LOW** | General works, monitoring, minor disruption |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/routes` | List all saved routes |
| `GET /api/check/:routeId` | Check one route for roadworks |
| `GET /api/check-all` | Check all routes at once |

---

## Configuration

In **`roadworks.js`** you can adjust:
- `padDeg` (default `0.15`) — how far outside waypoints to search
- `thresholdKm` (default `2.5`) — how close to the route path a work must be

In **`server.js`** you can change the port:
```bash
PORT=8080 node server.js
```
