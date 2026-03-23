// server.js — Express web server
'use strict';

const express = require('express');
const path = require('path');
const chalk = require('chalk');
const routes = require('./routes');
const { checkRoadworks } = require('./roadworks');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
 
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/routes — return saved routes (without checking works) ────────────
app.get('/api/routes', (req, res) => {
  res.json(routes.map(r => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    colour: r.colour,
    waypoints: r.waypoints,
  })));
});

// ── GET /api/check/:routeId — check a single route for roadworks ─────────────
app.get('/api/check/:routeId', async (req, res) => {
  const route = routes.find(r => r.id === req.params.routeId);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  console.log(chalk.cyan(`[check]`) + ` Checking roadworks for "${route.name}"…`);
  try {
    const result = await checkRoadworks(route);
    const congestionEmoji = {
      'free': '🟢',
      'light': '🟡',
      'moderate': '🟠',
      'heavy': '🔴',
      'severe': '🔴',
      'unknown': '⚪'
    }[result.traffic?.level] || '⚪';
    
    console.log(chalk.green(`[done]`) + `  ${result.total} works found (${result.high} high, ${result.medium} medium, ${result.low} low)`);
    console.log(chalk.blue(`[route]`) + `  ${result.duration.durationMinutes}min (${result.duration.distanceKm}km @ ${result.duration.estimatedSpeed}km/h)`);
    console.log(chalk.gray(`[traffic]`) + ` ${congestionEmoji} ${result.traffic.level} (score: ${result.traffic.severity}/100)`);
    
    res.json(result);
  } catch (err) {
    console.error(chalk.red('[error]'), err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/check-all — check all routes at once ────────────────────────────
app.get('/api/check-all', async (req, res) => {
  console.log(chalk.cyan(`[check-all]`) + ` Checking all ${routes.length} routes…`);
  try {
    const results = await Promise.all(routes.map(r => checkRoadworks(r)));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(chalk.bold.yellow(`
╔══════════════════════════════════════════════╗
║   🚧  Roadworks Checker — Server Running     ║
╠══════════════════════════════════════════════╣
║   Open: http://localhost:${PORT}               ║
╚══════════════════════════════════════════════╝
`));
  console.log(chalk.gray(`  Loaded ${routes.length} saved route(s):`));
  routes.forEach(r => console.log(chalk.gray(`    ${r.icon}  ${r.name}`)));
  console.log('');
});