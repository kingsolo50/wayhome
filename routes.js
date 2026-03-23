// routes.js — Add, edit, or remove your saved routes here.
// Each route needs a name, and waypoints as [latitude, longitude] pairs.
// Add as many waypoints as you like to define the path accurately.
// 
// Tip: Find coordinates at https://www.latlong.net/ or Google Maps (right-click → "What's here?")

module.exports = [
  {
    id: "home-work",
    name: "Home → Work",
    icon: "🏠",
    colour: "#3b82f6",
    waypoints: [
      // Example: London Liverpool Street → Canary Wharf
      { lat: 51.5177, lng: -0.0810, label: "Liverpool Street" },
      { lat: 51.5074, lng: -0.0278, label: "Canary Wharf" }
    ]
  },
  {
    id: "work-home",
    name: "Work → Home",
    icon: "💼",
    colour: "#10b981",
    waypoints: [
      { lat: 51.5074, lng: -0.0278, label: "Canary Wharf" },
      { lat: 51.5177, lng: -0.0810, label: "Liverpool Street" }
    ]
  },
  {
    id: "weekend-drive",
    name: "Weekend Drive",
    icon: "🌿",
    colour: "#f59e0b",
    waypoints: [
      { lat: 51.5074, lng: -0.1278, label: "Central London" },
      { lat: 51.4694, lng: -0.4502, label: "Heathrow" },
      { lat: 51.4308, lng: -0.9738, label: "Reading" }
    ]
  }
];
