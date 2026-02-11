/* Bundled app - all modules concatenated for file:// usage */
(function () {
'use strict';

const { createApp, ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

// ── Utilities ──────────────────────────────────────────────────────

const GROUP_COLORS = {
  'row_resource_score': '#4caf50',
  'row_team_score': '#2196f3',
  'row_defense_score': '#ff9800',
  'row_offense_score': '#e94560',
};

const GREY_SHADES = ['#666666', '#777777', '#888888', '#999999', '#555555', '#aaaaaa'];

/** Derive a visually distinct color by rotating hue/lightness based on property index. */
function shiftColor(hex, propertyIndex) {
  if (propertyIndex === 0) return hex;
  if (!hex || hex.length < 7) return hex || '#888888';
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const maximum = Math.max(red, green, blue) / 255;
  const minimum = Math.min(red, green, blue) / 255;
  const lightness = (maximum + minimum) / 2;
  let hue = 0, saturation = 0;
  if (maximum !== minimum) {
    const delta = maximum - minimum;
    saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
    const redNorm = red / 255, greenNorm = green / 255, blueNorm = blue / 255;
    if (maximum === redNorm) hue = ((greenNorm - blueNorm) / delta + (greenNorm < blueNorm ? 6 : 0)) / 6;
    else if (maximum === greenNorm) hue = ((blueNorm - redNorm) / delta + 2) / 6;
    else hue = ((redNorm - greenNorm) / delta + 4) / 6;
  }
  hue = (hue + propertyIndex * 0.07) % 1;
  const adjustedLightness = Math.max(0.15, Math.min(0.85,
    lightness + (propertyIndex % 2 === 0 ? 0.08 : -0.08)));
  const hueToRgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let redOut, greenOut, blueOut;
  if (saturation === 0) {
    redOut = greenOut = blueOut = adjustedLightness;
  } else {
    const q = adjustedLightness < 0.5
      ? adjustedLightness * (1 + saturation)
      : adjustedLightness + saturation - adjustedLightness * saturation;
    const p = 2 * adjustedLightness - q;
    redOut = hueToRgb(p, q, hue + 1 / 3);
    greenOut = hueToRgb(p, q, hue);
    blueOut = hueToRgb(p, q, hue - 1 / 3);
  }
  const toHex = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${toHex(redOut)}${toHex(greenOut)}${toHex(blueOut)}`;
}

/** Escape special HTML characters to prevent XSS in tooltip/display output. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a number with k/m suffixes for compact display. */
function formatNumber(value) {
  if (value == null) return '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'm';
  if (absolute >= 1_000) return (value / 1_000).toFixed(1) + 'k';
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

/** Format seconds into human-readable duration: "XXm", "XhYm", or "XdYhZm". */
function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '0m';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? hours + 'h' + minutes + 'm' : hours + 'h';
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  let result = days + 'd';
  if (hours > 0) result += hours + 'h';
  if (minutes > 0) result += minutes + 'm';
  return result;
}

/** Convert a raw score to per-minute rate when normalization is enabled. */
function normalizeValue(rawValue, durationSeconds, shouldNormalize) {
  if (!shouldNormalize || durationSeconds <= 0) return rawValue;
  return rawValue / (durationSeconds / 60);
}

/** Compute the mean value of a property across all players in a single game. */
function computeGameMean(game, propertyId, shouldNormalizePerMinute) {
  const values = Object.values(game.scores)
    .map(s => s[propertyId])
    .filter(v => v != null);
  if (values.length === 0) return 0;
  const processed = values.map(v => normalizeValue(v, game.duration_seconds, shouldNormalizePerMinute));
  return processed.reduce((sum, v) => sum + v, 0) / processed.length;
}

/** For each game, find the best (max or min depending on sort direction) player value. */
function precomputeGameBests(games, propertyId, normalizePerMinute, sortAscending) {
  return games.map(game => {
    const values = Object.values(game.scores)
      .map(s => s[propertyId])
      .filter(v => v != null)
      .map(v => normalizeValue(v, game.duration_seconds, normalizePerMinute));
    if (!values.length) return null;
    return sortAscending ? Math.max(...values) : Math.min(...values);
  });
}

/** Return a debounced version of callback that delays execution by `delay` ms. */
function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

// ── Constants ──────────────────────────────────────────────────────

const MISSION_NAMES = {
  'cm_habs': 'Hab Dreyko',
  'cm_raid': 'Dark Communion',
  'cm_archives': 'Chasm Logistratum',
  'lm_rails': 'Enclavum Baross',
  'lm_scavenge': 'Mercantile HL-70-04',
  'lm_cooling': 'Silo Cluster 18-66/a',
  'fm_armoury': 'Power Matrix HL-17-36',
  'fm_cargo': 'Consignment Yard HL-17-36',
  'fm_resurgence': 'Smelter Complex HL-17-36',
  'dm_stockpile': 'Ascension Riser 31',
  'dm_propaganda': 'Comms-Plex 154/2f',
  'dm_rise': 'Magistrati Oubliette TM8-707',
  'dm_forge': 'Archivum Sycorax',
  'hm_complex': 'Refinery Delta-17',
  'hm_cartel': 'Excise Vault Spireside-13',
  'hm_strain': 'Relay Station TRS-150',
  'km_enforcer': 'Warren 6-19',
  'km_station': 'Chasm Station HL-16-11',
  'km_heresy': 'Vigil Station Oblivium',
  'km_enforcer_twins': 'Orthus Offensive',
  'core_research': 'Clandestium Gloriana',
  'op_train': 'Rolling Steel',
  'op_no_mans_land': 'Battle for Tertium',
  'hub_ship': 'Mourningstar (Hub)',
  'psykhanium': 'Mortis Trials',
};

const DEFAULT_DIFFICULTY_NAMES = {
  0: 'Sedition',
  1: 'Uprising',
  2: 'Malice',
  3: 'Heresy',
  4: 'Damnation',
  5: 'Auric',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR_CODE_PATTERN = /\{#color\([^)]*\)\}|\{#reset\(\)\}/g;

const DEFAULT_GROUP_ID = 'row_resource_score';
const DEFAULT_GROUP_NAME = 'Resource & Teamwork';

const INGEST_BATCH_SIZE = 50;
const MAX_SELECTED_PROPERTIES = 5;

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

// ── Helpers ────────────────────────────────────────────────────────

/** Test whether a string matches the UUID v4 format. */
function isUuid(text) {
  return UUID_PATTERN.test(text);
}

/** Remove Darktide inline color markup from text. */
function stripColorCodes(text) {
  return text.replace(COLOR_CODE_PATTERN, '').trim();
}

/** Create a stable bot_* identifier from a raw bot display name. */
function generateBotIdentifier(rawBotName) {
  const stripped = stripColorCodes(rawBotName);
  const sanitized = stripped.toLowerCase().replace(/\[bot\]/g, '').replace(/ /g, '_').replace(/^_+|_+$/g, '');
  return `bot_${sanitized}`;
}

/** Humanize angle-bracket wrapped internal names (e.g. "<some_stat>" to "Some Stat"). */
function cleanDisplayName(name) {
  if (name.startsWith('<') && name.endsWith('>')) {
    const inner = name.slice(1, -1);
    if (inner.includes('_') && inner === inner.toLowerCase()) {
      return inner.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    return inner;
  }
  return name;
}

/** Disambiguate a single-word child property name using its parent's display name. */
function expandChildDisplayName(childDisplay, parentDisplay, siblingDisplays) {
  if (childDisplay.split(' ').length > 1) return childDisplay;
  const regex = new RegExp('\\b' + childDisplay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  if (!regex.test(parentDisplay)) return childDisplay;
  let result = parentDisplay.replace(/ \/ /g, ' ');
  for (const sibling of siblingDisplays) {
    const sibRegex = new RegExp('\\b' + sibling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    result = result.replace(sibRegex, '');
  }
  result = result.replace(/\s+/g, ' ').trim();
  return result || childDisplay;
}

// ── Components ─────────────────────────────────────────────────────

const MultiSelect = {
  props: {
    modelValue: { type: Array, required: true },
    displayLabel: { type: String, required: true },
    isOpen: Boolean,
    showAll: { type: Boolean, default: true },
    allValues: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue', 'toggle', 'close'],
  data() { return { filterText: '' }; },
  watch: {
    isOpen(open) { if (!open) this.filterText = ''; },
  },
  methods: {
    selectAll() { this.$emit('update:modelValue', [...this.allValues]); },
    selectNone() { this.$emit('update:modelValue', []); },
    onFilter() {
      const q = this.filterText.toLowerCase();
      const items = this.$refs.slotContainer;
      if (!items) return;
      for (const el of items.children) {
        if (el.classList.contains('group-header') || el.tagName === 'LABEL') {
          const text = el.textContent.toLowerCase();
          el.style.display = !q || text.includes(q) ? '' : 'none';
        }
      }
    },
    focusFilter() {
      this.$nextTick(() => { this.$refs.filterInput?.focus(); });
    },
  },
  updated() { if (this.isOpen) this.onFilter(); },
  template: `
    <div class="multi-select" @click.stop>
      <div class="multi-select-trigger" tabindex="0" role="combobox"
        :aria-expanded="isOpen" aria-haspopup="listbox"
        @click="$emit('toggle'); focusFilter()"
        @keydown.enter.prevent="$emit('toggle'); focusFilter()"
        @keydown.escape="$emit('close')">
        {{ displayLabel }}
      </div>
      <div v-if="isOpen" class="multi-select-dropdown" role="listbox">
        <div class="ms-filter-wrap">
          <input ref="filterInput" class="ms-filter" type="text" v-model="filterText"
            @input="onFilter" placeholder="Filter..." @keydown.escape="$emit('close')">
          <span v-if="filterText" class="ms-filter-clear" @click="filterText = ''; onFilter(); $refs.filterInput.focus()">&times;</span>
        </div>
        <div class="ms-actions">
          <button v-if="showAll" class="btn-sm" @click.stop="selectAll()">All</button>
          <button class="btn-sm" @click.stop="selectNone()">None</button>
        </div>
        <div ref="slotContainer" class="ms-items"><slot></slot></div>
      </div>
    </div>
  `,
};

// ── Database ───────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS games (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    filename         TEXT UNIQUE NOT NULL,
    timestamp        INTEGER NOT NULL,
    mission_id       TEXT NOT NULL,
    mission_name     TEXT NOT NULL,
    difficulty       INTEGER NOT NULL,
    modifier         TEXT NOT NULL DEFAULT '',
    result           TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_timestamp ON games(timestamp);
CREATE INDEX IF NOT EXISTS idx_games_result ON games(result);
CREATE INDEX IF NOT EXISTS idx_games_difficulty ON games(difficulty);
CREATE INDEX IF NOT EXISTS idx_games_mission_id ON games(mission_id);

CREATE TABLE IF NOT EXISTS players (
    id     TEXT PRIMARY KEY,
    is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_players (
    game_id   INTEGER NOT NULL REFERENCES games(id),
    player_id TEXT NOT NULL,
    slot      INTEGER NOT NULL,
    name      TEXT NOT NULL,
    PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_game_players_player ON game_players(player_id);

CREATE TABLE IF NOT EXISTS properties (
    id             TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    group_id       TEXT NOT NULL,
    group_name     TEXT NOT NULL,
    sort_direction TEXT NOT NULL,
    is_summary     INTEGER NOT NULL DEFAULT 0,
    parent_id      TEXT,
    child_ids      TEXT,
    row_order      INTEGER NOT NULL DEFAULT 0,
    visible        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scores (
    game_id     INTEGER NOT NULL REFERENCES games(id),
    player_id   TEXT NOT NULL,
    property_id TEXT NOT NULL,
    value       REAL NOT NULL,
    PRIMARY KEY (game_id, player_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_property ON scores(property_id);
CREATE INDEX IF NOT EXISTS idx_scores_player_property ON scores(player_id, property_id);
CREATE INDEX IF NOT EXISTS idx_scores_game_property ON scores(game_id, property_id);

CREATE TABLE IF NOT EXISTS player_settings (
    player_id   TEXT PRIMARY KEY,
    custom_name TEXT,
    color       TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
`;

let _db = null;
let _SQL = null;

const IDB_NAME = 'DarktideScoreboard';
const IDB_STORE = 'db';
const IDB_KEY = 'main';
const IDB_DIR_KEY = 'dirHandle';

let _idbConnection = null;

/** Open (or reuse) the IndexedDB connection for persistence. */
async function _getIDB() {
  if (_idbConnection) return _idbConnection;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => {
      _idbConnection = request.result;
      _idbConnection.onclose = () => { _idbConnection = null; };
      resolve(_idbConnection);
    };
    request.onerror = () => reject(request.error);
  });
}

/** Load the raw SQLite database bytes from IndexedDB. Returns null if absent. */
async function _loadFromIDB() {
  try {
    const db = await _getIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Persist raw SQLite database bytes into IndexedDB. */
async function _saveToIDB(data) {
  const db = await _getIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Save a FileSystemDirectoryHandle to IndexedDB for cross-session persistence. */
async function _saveDirHandle(handle) {
  try {
    const db = await _getIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(handle, IDB_DIR_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}

/** Load a previously saved FileSystemDirectoryHandle from IndexedDB. */
async function _loadDirHandle() {
  try {
    const db = await _getIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Load sql.js, restore DB from IndexedDB (or create fresh), and apply schema. */
async function initDatabase() {
  _SQL = await initSqlJs({
    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`,
  });

  const saved = await _loadFromIDB();
  if (saved) {
    try {
      const arr = saved instanceof Uint8Array ? saved : new Uint8Array(saved);
      _db = new _SQL.Database(arr);
      _db.run(SCHEMA_SQL);
    } catch (e) {
      console.error('Failed to load saved DB, creating fresh:', e);
      _db = new _SQL.Database();
      _db.run(SCHEMA_SQL);
    }
  } else {
    _db = new _SQL.Database();
    _db.run(SCHEMA_SQL);
  }
  return _db;
}

/** Export the in-memory SQLite DB and persist it to IndexedDB. */
async function saveDatabase() {
  if (!_db) return;
  const data = _db.export();
  await _saveToIDB(data);
}

/** Execute a SQL statement (INSERT/UPDATE/DELETE) with optional params. */
function runStatement(sql, params = []) {
  _db.run(sql, params);
}

/** Execute a SQL SELECT and return all result rows as an array of objects. */
function queryRows(sql, params = []) {
  const stmt = _db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Execute a SQL SELECT and return the first row, or null. */
function queryOne(sql, params = []) {
  const rows = queryRows(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Drop all data by replacing the DB with a fresh schema-only instance. */
async function clearDatabase() {
  if (_db) _db.close();
  _db = new _SQL.Database();
  _db.run(SCHEMA_SQL);
  await saveDatabase();
}

// ── Repository ─────────────────────────────────────────────────────

/** Batch-insert a parsed game (players, properties, scores) into the DB. */
function insertGame(game) {
  const missionName = MISSION_NAMES[game.missionId] || game.missionId;
  runStatement(
    `INSERT INTO games (filename, timestamp, mission_id, mission_name, difficulty, modifier, result, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [game.filename, game.timestamp, game.missionId, missionName,
     game.difficulty, game.modifier, game.result, game.durationSeconds]
  );

  const gameIdRow = queryOne('SELECT last_insert_rowid() as id');
  const gameId = gameIdRow.id;

  // Collect all player and game_player rows for batch insert
  const playerRows = [];
  const gamePlayerRows = [];

  for (const [slot, playerId, playerName] of game.players) {
    playerRows.push(playerId, 0);
    gamePlayerRows.push(gameId, playerId, slot, playerName);
  }
  for (const [botId, cleanName] of Object.entries(game.discoveredBots)) {
    playerRows.push(botId, 1);
    gamePlayerRows.push(gameId, botId, -1, cleanName);
  }
  for (const extraId of game.discoveredExtraPlayers) {
    playerRows.push(extraId, 0);
    gamePlayerRows.push(gameId, extraId, -1, 'Unknown');
  }

  const playerCount = playerRows.length / 2;
  if (playerCount > 0) {
    const placeholders = Array.from({ length: playerCount }, () => '(?,?)').join(',');
    runStatement(`INSERT OR IGNORE INTO players (id, is_bot) VALUES ${placeholders}`, playerRows);
  }

  const gpCount = gamePlayerRows.length / 4;
  if (gpCount > 0) {
    const placeholders = Array.from({ length: gpCount }, () => '(?,?,?,?)').join(',');
    runStatement(
      `INSERT OR IGNORE INTO game_players (game_id, player_id, slot, name) VALUES ${placeholders}`,
      gamePlayerRows
    );
  }

  // Batch property metadata
  const propEntries = Object.entries(game.propertyMetadata);
  if (propEntries.length > 0) {
    const placeholders = propEntries.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
    const params = propEntries.flatMap(([rowId, m]) => [
      rowId, m.displayName, m.groupId, m.groupName, m.sortDirection,
      m.isSummary ? 1 : 0, m.parentId, m.childIds, m.rowOrder, m.visible ? 1 : 0,
    ]);
    runStatement(
      `INSERT OR REPLACE INTO properties
       (id, display_name, group_id, group_name, sort_direction, is_summary, parent_id, child_ids, row_order, visible)
       VALUES ${placeholders}`,
      params
    );
  }

  // Batch scores in chunks
  const SCORE_BATCH = 100;
  for (let i = 0; i < game.scores.length; i += SCORE_BATCH) {
    const batch = game.scores.slice(i, i + SCORE_BATCH);
    const placeholders = batch.map(() => '(?,?,?,?)').join(',');
    const params = batch.flatMap(([propertyId, playerId, value]) => [gameId, playerId, propertyId, value]);
    runStatement(
      `INSERT OR IGNORE INTO scores (game_id, player_id, property_id, value) VALUES ${placeholders}`,
      params
    );
  }
}

/** Return all scoreboard properties grouped by category, tree-ordered. */
function getProperties() {
  const rows = queryRows(
    `SELECT id, display_name, group_id, group_name, sort_direction, is_summary, parent_id, row_order, visible
     FROM properties ORDER BY row_order`
  );

  const allProps = {};
  for (const row of rows) {
    allProps[row.id] = {
      id: row.id,
      display_name: row.display_name,
      group_id: row.group_id,
      group_name: row.group_name,
      sort_direction: row.sort_direction,
      is_summary: !!row.is_summary,
      parent_id: row.parent_id,
      row_order: row.row_order,
    };
  }

  const childrenOf = {};
  for (const [propId, prop] of Object.entries(allProps)) {
    const parent = prop.parent_id || null;
    if (!childrenOf[parent]) childrenOf[parent] = [];
    childrenOf[parent].push(propId);
  }

  function walkTree(parentId) {
    const result = [];
    for (const propId of (childrenOf[parentId] || [])) {
      result.push(allProps[propId]);
      result.push(...walkTree(propId));
    }
    return result;
  }

  const ordered = walkTree(null);
  const groups = {};
  for (const prop of ordered) {
    const gid = prop.group_id;
    if (!groups[gid]) {
      groups[gid] = { group_id: gid, group_name: prop.group_name, min_order: prop.row_order, properties: [] };
    }
    groups[gid].properties.push({
      id: prop.id, display_name: prop.display_name,
      sort_direction: prop.sort_direction, is_summary: prop.is_summary,
      parent_id: prop.parent_id, row_order: prop.row_order,
    });
  }

  return Object.values(groups).sort((a, b) => a.min_order - b.min_order).map(g => ({
    group_id: g.group_id, group_name: g.group_name, properties: g.properties,
  }));
}

/** Query distinct missions, difficulties, modifiers, and time range for filter dropdowns. */
function getFilters() {
  const missions = queryRows(
    "SELECT DISTINCT mission_id, mission_name FROM games WHERE mission_id != '' ORDER BY mission_name"
  ).map(r => ({ id: r.mission_id, name: r.mission_name }));

  const difficulties = queryRows(
    'SELECT DISTINCT difficulty FROM games ORDER BY difficulty'
  ).map(r => ({ id: r.difficulty, name: DEFAULT_DIFFICULTY_NAMES[r.difficulty] || String(r.difficulty) }));

  const modifiers = queryRows(
    "SELECT DISTINCT modifier FROM games WHERE modifier != '' ORDER BY modifier"
  ).map(r => r.modifier);

  const timeRange = queryOne('SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM games');

  return {
    missions, difficulties, modifiers,
    time_range: { min: timeRange?.min_ts || 0, max: timeRange?.max_ts || 0 },
  };
}

/** Fetch all players with their names, game counts, and custom settings. */
function getPlayers() {
  return queryRows(`
    SELECT
      p.id,
      p.is_bot,
      ps.custom_name,
      ps.color,
      COALESCE(gc.cnt, 0) as game_count,
      gn.names
    FROM players p
    LEFT JOIN player_settings ps ON ps.player_id = p.id
    LEFT JOIN (
      SELECT player_id, COUNT(*) as cnt FROM game_players GROUP BY player_id
    ) gc ON gc.player_id = p.id
    LEFT JOIN (
      SELECT player_id, GROUP_CONCAT(DISTINCT name) as names
      FROM game_players GROUP BY player_id
    ) gn ON gn.player_id = p.id
    ORDER BY p.is_bot, p.id
  `).map(r => ({
    id: r.id,
    is_bot: !!r.is_bot,
    names: r.names ? r.names.split(',') : [],
    game_count: r.game_count || 0,
    custom_name: r.custom_name || null,
    color: r.color || null,
  }));
}

/** Load games matching filter params, with player rosters and selected property scores. */
function getGames(params) {
  const propertyIds = params.propertyIds || [];
  if (propertyIds.length === 0) return [];

  const conditions = [];
  const queryParams = [];

  const resultFilter = params.resultFilter || 'all';
  if (resultFilter === 'won') {
    conditions.push("g.result = 'won'");
  } else if (resultFilter === 'won_and_long_lost') {
    conditions.push("(g.result = 'won' OR (g.result = 'lost' AND g.duration_seconds > 1200))");
  } else if (resultFilter === 'lost') {
    conditions.push("g.result = 'lost'");
  }

  if (params.difficulties && params.difficulties.length > 0) {
    const placeholders = params.difficulties.map(() => '?').join(',');
    conditions.push(`g.difficulty IN (${placeholders})`);
    queryParams.push(...params.difficulties);
  }

  if (params.missions && params.missions.length > 0) {
    const placeholders = params.missions.map(() => '?').join(',');
    conditions.push(`g.mission_id IN (${placeholders})`);
    queryParams.push(...params.missions);
  }

  if (params.modifiers && params.modifiers.length > 0) {
    const placeholders = params.modifiers.map(() => '?').join(',');
    conditions.push(`g.modifier IN (${placeholders})`);
    queryParams.push(...params.modifiers);
  }

  if (params.startTime != null) {
    conditions.push('g.timestamp >= ?');
    queryParams.push(params.startTime);
  }
  if (params.endTime != null) {
    conditions.push('g.timestamp <= ?');
    queryParams.push(params.endTime);
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  let games;
  if (params.lastNGames && params.lastNGames > 0) {
    const idRows = queryRows(
      `SELECT g.id FROM games g WHERE ${whereClause} ORDER BY g.timestamp DESC LIMIT ?`,
      [...queryParams, params.lastNGames]
    );
    if (idRows.length === 0) return [];
    const gameIds = idRows.map(r => r.id);
    const placeholders = gameIds.map(() => '?').join(',');
    games = queryRows(
      `SELECT g.* FROM games g WHERE g.id IN (${placeholders}) ORDER BY g.timestamp ASC`,
      gameIds
    );
  } else {
    games = queryRows(
      `SELECT g.* FROM games g WHERE ${whereClause} ORDER BY g.timestamp ASC`,
      queryParams
    );
  }

  if (games.length === 0) return [];

  const gameIds = games.map(g => g.id);
  const gameIdPlaceholders = gameIds.map(() => '?').join(',');

  const gamePlayers = queryRows(
    `SELECT game_id, player_id, name FROM game_players WHERE game_id IN (${gameIdPlaceholders})`,
    gameIds
  );
  const playersByGame = {};
  for (const row of gamePlayers) {
    if (!playersByGame[row.game_id]) playersByGame[row.game_id] = {};
    playersByGame[row.game_id][row.player_id] = row.name;
  }

  const propPlaceholders = propertyIds.map(() => '?').join(',');
  const scoresRows = queryRows(
    `SELECT game_id, player_id, property_id, value FROM scores
     WHERE game_id IN (${gameIdPlaceholders}) AND property_id IN (${propPlaceholders})`,
    [...gameIds, ...propertyIds]
  );
  const scoresByGame = {};
  for (const row of scoresRows) {
    if (!scoresByGame[row.game_id]) scoresByGame[row.game_id] = {};
    if (!scoresByGame[row.game_id][row.player_id]) scoresByGame[row.game_id][row.player_id] = {};
    scoresByGame[row.game_id][row.player_id][row.property_id] = row.value;
  }

  return games.map(g => ({
    id: g.id,
    timestamp: g.timestamp,
    mission_id: g.mission_id,
    mission_name: g.mission_name,
    difficulty: g.difficulty,
    modifier: g.modifier,
    result: g.result,
    duration_seconds: g.duration_seconds,
    players: playersByGame[g.id] || {},
    scores: scoresByGame[g.id] || {},
  }));
}

/** Upsert a player's custom display name and color into the DB. */
function savePlayerSettingsDB(playerId, customName, color) {
  runStatement(
    `INSERT INTO player_settings (player_id, custom_name, color) VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET custom_name = excluded.custom_name, color = excluded.color`,
    [playerId, customName, color]
  );
  saveDatabase();
}

/** Upsert a generic app setting (key-value). */
function saveAppSetting(key, value) {
  runStatement(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  saveDatabase();
}

/** Read a single app setting value by key. Returns null if absent. */
function getAppSetting(key) {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

/** Delete all rows from app_settings. */
async function clearAppSettings() {
  runStatement('DELETE FROM app_settings', []);
  await saveDatabase();
}

/** If no players are tracked yet, auto-setup the most frequent human player as "Me". */
function autoSetupDefaultPlayer() {
  const hasTracked = queryOne('SELECT 1 FROM player_settings WHERE custom_name IS NOT NULL OR color IS NOT NULL');
  if (hasTracked) return;
  const top = queryOne(`
    SELECT gp.player_id, COUNT(*) as cnt
    FROM game_players gp
    JOIN players p ON p.id = gp.player_id AND p.is_bot = 0
    GROUP BY gp.player_id
    ORDER BY cnt DESC
    LIMIT 1
  `);
  if (!top) return;
  savePlayerSettingsDB(top.player_id, 'Me', '#e94560');
}

/** Return total number of imported games. */
function getGameCount() {
  const row = queryOne('SELECT COUNT(*) as cnt FROM games');
  return row ? row.cnt : 0;
}

// ── Parser ─────────────────────────────────────────────────────────

/** Extract mission id, difficulty, modifier, result, and duration from a #mission line. */
function parseMissionLine(line, game) {
  const parts = line.split(';');
  if (parts.length < 3) return;
  game.missionId = parts[1].trim();
  game.difficulty = parseInt(parts[2], 10);
  const rawModifier = parts.length > 3 ? parts[3] : '';
  game.modifier = (rawModifier === 'nil' || rawModifier === 'default' || rawModifier === '') ? '' : rawModifier;
  game.result = parts.length > 4 ? parts[4] : 'unknown';
  game.durationSeconds = parts.length > 5 ? parseInt(parts[5], 10) : 0;
}

/** Parse the #players block, collecting slot/id/name tuples. Returns updated lineIndex. */
function parsePlayersSection(lines, lineIndex, game, knownPlayerIds) {
  const parts = lines[lineIndex].trim().split(';');
  if (parts.length < 2) return lineIndex;
  const playerCount = parseInt(parts[1], 10);
  for (let i = 0; i < playerCount; i++) {
    lineIndex++;
    if (lineIndex >= lines.length) break;
    const playerParts = lines[lineIndex].trim().split(';');
    if (playerParts.length < 2) continue;
    const slot = parseInt(playerParts[0], 10);
    const playerId = playerParts[1];
    const playerName = playerParts.length > 2 ? playerParts[2] : 'Unknown';
    game.players.push([slot, playerId, playerName]);
    knownPlayerIds.add(playerId);
  }
  return lineIndex;
}

/** Parse a #row header and its per-player data lines into property metadata and scores. */
function parseRowSection(lines, lineIndex, line, game, knownPlayerIds, currentGroupId, currentGroupName) {
  const parts = line.split(';');
  if (parts.length < 2) return lineIndex;
  const rowId = parts[1];
  const rowOrder = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  const dataLineCount = parts.length > 3 ? parseInt(parts[3], 10) : 0;
  const displayName = parts.length > 4 ? cleanDisplayName(parts[4]) : rowId;
  const sortDirection = parts.length > 5 ? parts[5] : 'ASC';
  const flagField = parts.length > 7 ? parts[7] : 'nil';
  const pluginId = parts.length > 9 ? parts[9] : '';
  const parentIdRaw = parts.length > 10 ? parts[10] : 'nil';
  const childIdsRaw = parts.length > 12 ? parts[12] : 'nil';

  const parentId = parentIdRaw === 'nil' ? null : parentIdRaw;
  const childIds = childIdsRaw === 'nil' ? null : childIdsRaw;
  const isSummary = childIds !== null && childIds.includes(':');
  const visible = flagField !== 'false';

  game.propertyMetadata[rowId] = {
    displayName, groupId: currentGroupId, groupName: currentGroupName,
    sortDirection, isSummary, parentId, childIds, rowOrder, visible, pluginId,
  };

  for (let i = 0; i < dataLineCount; i++) {
    lineIndex++;
    if (lineIndex >= lines.length) break;
    const dataLine = lines[lineIndex].trim();
    if (!dataLine || dataLine.startsWith('#')) { lineIndex--; break; }
    const dataParts = dataLine.split(';');
    const rawPlayerIdentifier = dataParts[0];
    const value = parseFloat(dataParts[1]);
    if (isNaN(value)) continue;

    let playerId;
    if (isUuid(rawPlayerIdentifier)) {
      playerId = rawPlayerIdentifier;
      if (!knownPlayerIds.has(playerId)) game.discoveredExtraPlayers.add(playerId);
    } else {
      const botId = generateBotIdentifier(rawPlayerIdentifier);
      game.discoveredBots[botId] = stripColorCodes(rawPlayerIdentifier);
      playerId = botId;
    }
    game.scores.push([rowId, playerId, value]);
  }
  return lineIndex;
}

/** Assign parentId to orphaned child properties using childIds lists and plugin grouping. */
function linkOrphanedChildren(game) {
  const candidates = {};
  for (const [rowId, metadata] of Object.entries(game.propertyMetadata)) {
    if (!metadata.childIds) continue;
    const childList = metadata.childIds.split(':');
    const childCount = childList.length;
    for (const childId of childList) {
      if (childId in game.propertyMetadata && game.propertyMetadata[childId].parentId === null) {
        if (!candidates[childId]) candidates[childId] = [];
        candidates[childId].push([rowId, childCount]);
      }
    }
  }
  for (const [childId, parentOptions] of Object.entries(candidates)) {
    parentOptions.sort((a, b) => a[1] - b[1]);
    game.propertyMetadata[childId].parentId = parentOptions[0][0];
  }

  const pluginParents = {};
  for (const [rowId, metadata] of Object.entries(game.propertyMetadata)) {
    if (metadata.pluginId && metadata.visible && metadata.parentId === null) {
      pluginParents[metadata.pluginId] = rowId;
    }
  }
  for (const [rowId, metadata] of Object.entries(game.propertyMetadata)) {
    if (metadata.parentId !== null || metadata.visible) continue;
    if (metadata.pluginId && metadata.pluginId in pluginParents && pluginParents[metadata.pluginId] !== rowId) {
      metadata.parentId = pluginParents[metadata.pluginId];
    }
  }
}

/** Rewrite single-word child display names to be more descriptive using parent context. */
function expandChildDisplayNames(game) {
  const rawNames = {};
  for (const [rid, m] of Object.entries(game.propertyMetadata)) rawNames[rid] = m.displayName;
  for (const [rowId, metadata] of Object.entries(game.propertyMetadata)) {
    if (metadata.parentId && metadata.parentId in game.propertyMetadata) {
      const parentMetadata = game.propertyMetadata[metadata.parentId];
      const siblingDisplays = Object.keys(game.propertyMetadata)
        .filter(sid => sid !== rowId && game.propertyMetadata[sid].parentId === metadata.parentId)
        .map(sid => rawNames[sid]);
      metadata.displayName = expandChildDisplayName(rawNames[rowId], parentMetadata.displayName, siblingDisplays);
    }
  }
}

/** Parse a scoreboard .lua file into a game object ready for DB insertion. */
function parseLuaContent(filename, content) {
  const timestamp = parseInt(filename.replace(/\.lua$/i, ''), 10);
  if (isNaN(timestamp)) {
    console.error('Non-numeric filename:', filename);
    return null;
  }

  const lines = content.trim().replace(/\r\n/g, '\n').split('\n');
  const game = {
    filename, timestamp,
    missionId: '', difficulty: 0, modifier: '', result: '', durationSeconds: 0,
    players: [], propertyMetadata: {}, scores: [],
    discoveredBots: {}, discoveredExtraPlayers: new Set(),
  };

  let currentGroupId = DEFAULT_GROUP_ID;
  let currentGroupName = DEFAULT_GROUP_NAME;
  const knownPlayerIds = new Set();
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    if (!line) { lineIndex++; continue; }

    if (line.startsWith('#mission')) {
      parseMissionLine(line, game);
      lineIndex++;
      continue;
    }
    if (line.startsWith('#players')) {
      lineIndex = parsePlayersSection(lines, lineIndex, game, knownPlayerIds);
      lineIndex++;
      continue;
    }
    if (line.startsWith('#group')) {
      const parts = line.split(';');
      currentGroupId = parts[1];
      currentGroupName = parts.length > 2 ? parts[2] : parts[1];
      lineIndex++;
      continue;
    }
    if (line.startsWith('#row')) {
      lineIndex = parseRowSection(lines, lineIndex, line, game, knownPlayerIds, currentGroupId, currentGroupName);
      lineIndex++;
      continue;
    }
    lineIndex++;
  }

  linkOrphanedChildren(game);
  expandChildDisplayNames(game);
  return game;
}

// ── Ingestion ──────────────────────────────────────────────────────

/** Collect .lua files from either a FileSystemDirectoryHandle or a File[] array. */
async function collectLuaFiles(source) {
  const luaFiles = [];
  if (Array.isArray(source)) {
    for (const file of source) {
      if (file.name.endsWith('.lua')) luaFiles.push(file);
    }
  } else {
    for await (const entry of source.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.lua')) luaFiles.push(entry);
    }
  }
  luaFiles.sort((a, b) => a.name.localeCompare(b.name));
  return luaFiles;
}

/** Read file content from either a File object or a FileSystemFileHandle. */
async function readFileContent(entry) {
  const file = entry instanceof File ? entry : await entry.getFile();
  return { name: file.name, content: await file.text() };
}

/** Scan a source (directory handle or File[]) for new .lua files, parse and insert in batches. */
async function ingestFiles(source, progressCallback) {
  const existingRows = queryRows('SELECT filename FROM games');
  const existingFilenames = new Set(existingRows.map(r => r.filename));

  const luaFiles = await collectLuaFiles(source);
  const newFiles = luaFiles.filter(f => !existingFilenames.has(f.name));
  if (newFiles.length === 0) {
    if (progressCallback) progressCallback(0, 0, 'All files already ingested.');
    return { ingested: 0, errors: 0, total: luaFiles.length };
  }

  let ingested = 0;
  let errors = 0;

  for (let i = 0; i < newFiles.length; i++) {
    try {
      const { name, content } = await readFileContent(newFiles[i]);
      const game = parseLuaContent(name, content);
      if (!game) { errors++; continue; }

      try {
        runStatement('SAVEPOINT game_insert');
        insertGame(game);
        runStatement('RELEASE SAVEPOINT game_insert');
        ingested++;
      } catch (e) {
        console.error('Error inserting', name, e);
        runStatement('ROLLBACK TO SAVEPOINT game_insert');
        runStatement('RELEASE SAVEPOINT game_insert');
        errors++;
      }
    } catch (e) {
      console.error('Error reading file', e);
      errors++;
    }

    if ((i + 1) % INGEST_BATCH_SIZE === 0) {
      await saveDatabase();
      if (progressCallback) progressCallback(i + 1, newFiles.length, `${i + 1}/${newFiles.length} processed...`);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  await saveDatabase();
  if (progressCallback) progressCallback(newFiles.length, newFiles.length, `Done: ${ingested} ingested, ${errors} errors.`);
  return { ingested, errors, total: luaFiles.length };
}

// ── Statistics ─────────────────────────────────────────────────────

/** Compute win/loss summary stats for a tracked player across filtered games. */
function computePlayerGeneralStats(player, games, nameFilter) {
  let totalGames = 0;
  let wonGames = 0;
  let totalPlaytime = 0;
  let winStreak = 0, maxWinStreak = 0;
  let lossStreak = 0, maxLossStreak = 0;

  for (const game of games) {
    if (!(player.id in game.scores)) continue;
    if (nameFilter && game.players[player.id] !== nameFilter) continue;
    totalGames++;
    totalPlaytime += game.duration_seconds || 0;
    if (game.result === 'won') {
      wonGames++;
      winStreak++;
      lossStreak = 0;
      if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    } else {
      lossStreak++;
      winStreak = 0;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    }
  }

  const winRate = totalGames > 0 ? Math.round(wonGames / totalGames * 100) : 0;

  return {
    playerId: player.id,
    name: player.custom_name || player.names[0] || player.id,
    color: player.color || '#888',
    totalGames,
    wonGames,
    winRate,
    totalPlaytime,
    winStreak: maxWinStreak,
    lossStreak: maxLossStreak,
  };
}

/** Compute per-property stats (average, best count, deviation) for a tracked player. */
function computePlayerStats(player, games, propertyId, sortAscending, normalizePerMinute, gameMeans, gameBests, nameFilter) {
  const values = [];
  const bestFlags = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    if (nameFilter && game.players[player.id] !== nameFilter) continue;
    const playerValue = game.scores[player.id]?.[propertyId];
    if (playerValue == null) continue;

    const displayValue = normalizeValue(playerValue, game.duration_seconds, normalizePerMinute);
    values.push({ value: displayValue, gameMean: gameMeans[i] });
    bestFlags.push(gameBests[i] != null && Math.abs(displayValue - gameBests[i]) < 1e-9);
  }

  const total = values.length;
  const average = total > 0 ? values.reduce((sum, entry) => sum + entry.value, 0) / total : 0;
  const bestCount = bestFlags.filter(Boolean).length;
  const bestPercent = total > 0 ? Math.round(bestCount / total * 100) : 0;
  const deviations = values
    .filter(entry => entry.gameMean !== 0)
    .map(entry => ((entry.value - entry.gameMean) / entry.gameMean) * 100);
  const averageDeviation = deviations.length > 0
    ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length
    : 0;

  return {
    playerId: player.id,
    name: player.custom_name || player.names[0] || player.id,
    color: player.color || '#888',
    average,
    bestCount,
    bestTotal: total,
    bestPercent,
    deviation: averageDeviation,
  };
}

// ── Chart ──────────────────────────────────────────────────────────

/** Pre-calculate the per-game team average for a property (used in vs-average mode). */
function precomputeGameAverages(games, propertyId, normalizePerMinute) {
  return games.map(game => computeGameMean(game, propertyId, normalizePerMinute));
}

/** Normalize a raw score and optionally convert to % deviation from game mean. */
function computePointValue(rawValue, game, normalizePerMinute, vsAverage, gameMean) {
  const value = normalizeValue(rawValue, game.duration_seconds, normalizePerMinute);
  if (vsAverage) {
    return gameMean !== 0 ? ((value - gameMean) / gameMean) * 100 : 0;
  }
  return value;
}

/** Build Chart.js scatter/line datasets: one dataset per player per property. */
function buildScatterPlayerDatasets(options) {
  const {
    games, propertyId, propertyIndex, propertyLabel, allPlayerIds,
    trackedIds, settingsMap, greyColorMap, selectedPropertyCount,
    hideBots, hideUnnamed, normalizePerMinute, vsAverage, xAxisMode,
    perName, trackedPlayers, hiddenLegendProperties,
  } = options;

  const useSecondAxis = !vsAverage && selectedPropertyCount > 1;
  const gameMeans = vsAverage ? precomputeGameAverages(games, propertyId, normalizePerMinute) : null;
  const datasets = [];

  /** Build a single scatter dataset for a player, optionally filtered by name. */
  function buildOneDataset(playerId, isTracked, color, label, shiftIndex, nameFilter) {
    const dataPoints = [];
    let lastGameIndex = -2;

    for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
      const game = games[gameIndex];
      if (nameFilter && game.players[playerId] !== nameFilter) continue;
      const rawValue = game.scores[playerId]?.[propertyId];
      if (rawValue == null) continue;

      const value = computePointValue(rawValue, game, normalizePerMinute, vsAverage, gameMeans?.[gameIndex] ?? 0);
      const xValue = xAxisMode === 'time' ? game.timestamp * 1000 : gameIndex;

      if (dataPoints.length > 0 && lastGameIndex !== gameIndex - 1) {
        const gapX = xAxisMode === 'time'
          ? (dataPoints[dataPoints.length - 1].x + xValue) / 2
          : gameIndex - 0.5;
        dataPoints.push({ x: gapX, y: NaN });
      }
      lastGameIndex = gameIndex;

      dataPoints.push({
        x: xValue, y: value,
        gameIndex,
        gameId: game.id,
        timestamp: game.timestamp,
        missionName: game.mission_name,
        difficulty: game.difficulty,
        result: game.result,
        playerNameInGame: game.players[playerId] || 'Unknown',
        rawValue,
        duration: game.duration_seconds,
      });
    }

    if (dataPoints.length === 0) return;

    const isPropertyHidden = hiddenLegendProperties && hiddenLegendProperties.has(propertyId);
    const shiftedColor = shiftColor(color, shiftIndex);
    datasets.push({
      label,
      data: isPropertyHidden ? [] : dataPoints,
      borderColor: shiftedColor,
      backgroundColor: shiftedColor,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: isTracked ? 2 : 1,
      showLine: true,
      spanGaps: false,
      tension: 0,
      hidden: isPropertyHidden,
      yAxisID: useSecondAxis && propertyIndex > 0 ? 'y1' : 'y',
      order: isTracked ? 0 : 1,
      _isTracked: isTracked,
      _propertyId: propertyId,
      _propertyIndex: propertyIndex,
      _playerId: playerId,
    });
  }

  for (const playerId of allPlayerIds) {
    if (hideBots && playerId.startsWith('bot_')) continue;
    const isTracked = trackedIds.has(playerId);
    if (hideUnnamed && !isTracked) continue;
    const settings = settingsMap[playerId];
    const color = settings ? settings.color : greyColorMap.get(playerId);

    if (perName && isTracked) {
      // Collect distinct names used by this player across the current games
      const nameSet = new Set();
      for (const game of games) {
        const n = game.players[playerId];
        if (n && playerId in game.scores) nameSet.add(n);
      }
      const names = [...nameSet].sort();
      names.forEach((name, nameIndex) => {
        const customName = settings?.name || '';
        const namePart = `${name} (${customName})`;
        const label = selectedPropertyCount > 1
          ? `${namePart} - ${propertyLabel}` : namePart;
        buildOneDataset(playerId, true, color, label, propertyIndex + nameIndex + 1, name);
      });
    } else {
      const playerLabel = settings?.name || '';
      const datasetLabel = selectedPropertyCount > 1
        ? `${playerLabel} - ${propertyLabel}` : playerLabel;
      buildOneDataset(playerId, isTracked, color, datasetLabel, propertyIndex, null);
    }
  }
  return datasets;
}

/** Build Chart.js grouped-bar datasets with per-slot coloring and legend entries. */
function buildBarPlayerDatasets(options) {
  const {
    games, propertyId, propertyIndex, propertyLabel, allPlayerIds,
    trackedIds, settingsMap, greyColorMap, selectedPropertyCount,
    hideBots, hideUnnamed, normalizePerMinute, vsAverage, hiddenLegendProperties,
    perName,
  } = options;

  const useSecondAxis = !vsAverage && selectedPropertyCount > 1;
  const gameMeans = vsAverage ? precomputeGameAverages(games, propertyId, normalizePerMinute) : null;

  const visiblePlayersPerGame = games.map(game => {
    return Object.keys(game.scores)
      .filter(playerId => {
        if (hideBots && playerId.startsWith('bot_')) return false;
        if (hideUnnamed && !trackedIds.has(playerId)) return false;
        return true;
      })
      .sort((a, b) => {
        const aTracked = trackedIds.has(a) ? 0 : 1;
        const bTracked = trackedIds.has(b) ? 0 : 1;
        if (aTracked !== bTracked) return aTracked - bTracked;
        return a.localeCompare(b);
      });
  });

  const maxPlayersPerGame = visiblePlayersPerGame.reduce(
    (maximum, players) => Math.max(maximum, players.length), 0
  );

  const datasets = [];
  for (let slotIndex = 0; slotIndex < maxPlayersPerGame; slotIndex++) {
    const data = [];
    const backgroundColors = [];
    const borderColors = [];
    const playerIdsPerGame = [];
    const playerNamesPerGame = [];

    for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
      const game = games[gameIndex];
      const gamePlayers = visiblePlayersPerGame[gameIndex];

      if (slotIndex >= gamePlayers.length) {
        data.push(null);
        backgroundColors.push('transparent');
        borderColors.push('transparent');
        playerIdsPerGame.push(null);
        playerNamesPerGame.push(null);
        continue;
      }

      const playerId = gamePlayers[slotIndex];
      const rawValue = game.scores[playerId]?.[propertyId];
      const value = rawValue != null
        ? computePointValue(rawValue, game, normalizePerMinute, vsAverage, gameMeans?.[gameIndex] ?? 0)
        : null;

      const playerSettings = settingsMap[playerId];
      const baseColor = playerSettings ? playerSettings.color : greyColorMap.get(playerId);
      const shiftedColor = shiftColor(baseColor, propertyIndex);
      const isPropertyHidden = hiddenLegendProperties && hiddenLegendProperties.has(propertyId);

      data.push(isPropertyHidden ? null : value);
      backgroundColors.push(isPropertyHidden ? 'transparent' : shiftedColor);
      borderColors.push(isPropertyHidden ? 'transparent' : shiftedColor);
      playerIdsPerGame.push(playerId);
      playerNamesPerGame.push(game.players[playerId] || 'Unknown');
    }

    datasets.push({
      label: `Slot ${slotIndex + 1}`,
      data,
      backgroundColor: backgroundColors,
      borderColor: borderColors,
      borderWidth: 1,
      categoryPercentage: 0.92,
      barPercentage: 1.0,
      minBarLength: 2,
      yAxisID: useSecondAxis && propertyIndex > 0 ? 'y1' : 'y',
      order: 0,
      _isTracked: false,
      _isBarSlot: true,
      _propertyIndex: propertyIndex,
      _playerIdsPerGame: playerIdsPerGame,
      _playerNamesPerGame: playerNamesPerGame,
    });
  }

  for (const playerId of allPlayerIds) {
    const playerSettings = settingsMap[playerId];
    if (!playerSettings) continue;

    if (perName) {
      // Collect distinct names used by this player across current games
      const nameSet = new Set();
      for (const game of games) {
        const n = game.players[playerId];
        if (n && playerId in game.scores) nameSet.add(n);
      }
      const names = [...nameSet].sort();
      names.forEach((name, nameIndex) => {
        const namePart = `${name} (${playerSettings.name})`;
        const label = selectedPropertyCount > 1
          ? `${namePart} - ${propertyLabel}` : namePart;
        const shiftedColor = shiftColor(playerSettings.color, propertyIndex + nameIndex + 1);
        datasets.push({
          label,
          data: [],
          backgroundColor: shiftedColor,
          borderColor: shiftedColor,
          hidden: hiddenLegendProperties && hiddenLegendProperties.has(propertyId),
          _isTracked: true,
          _propertyId: propertyId,
          _propertyIndex: propertyIndex,
        });
      });
    } else {
      const shiftedColor = shiftColor(playerSettings.color, propertyIndex);
      const playerLabel = selectedPropertyCount > 1
        ? `${playerSettings.name} - ${propertyLabel}` : playerSettings.name;

      datasets.push({
        label: playerLabel,
        data: [],
        backgroundColor: shiftedColor,
        borderColor: shiftedColor,
        hidden: hiddenLegendProperties && hiddenLegendProperties.has(propertyId),
        _isTracked: true,
        _propertyId: propertyId,
        _propertyIndex: propertyIndex,
      });
    }
  }

  return datasets;
}

/** Generate win/loss background band regions for the chart x-axis. */
function buildBackgroundBands(games, resultFilter, xAxisMode) {
  const showBackground = resultFilter === 'all' || resultFilter === 'won_and_long_lost';
  if (!showBackground || games.length === 0) return [];

  return games.map((game, index) => {
    let xMin, xMax;
    if (xAxisMode === 'time') {
      const currentX = game.timestamp * 1000;
      const previousX = index > 0 ? games[index - 1].timestamp * 1000 : currentX;
      const nextX = index < games.length - 1 ? games[index + 1].timestamp * 1000 : currentX;
      xMin = index > 0 ? (previousX + currentX) / 2 : currentX - (nextX - currentX) / 2;
      xMax = index < games.length - 1 ? (currentX + nextX) / 2 : currentX + (currentX - previousX) / 2;
    } else {
      xMin = index - 0.5;
      xMax = index + 0.5;
    }
    return { xMin, xMax, result: game.result };
  });
}

/** Validate a CSS color string; fall back to grey if invalid. */
function sanitizeCssColor(color) {
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/.test(color)) return color;
  return '#888';
}

/** Extract game-level info (mission, difficulty, result) from a tooltip data point. */
function getTooltipGameInfo(validItems, isBarMode, gameMetadata, games) {
  if (isBarMode) {
    const gameIndex = validItems[0].dataIndex;
    const m = gameMetadata[gameIndex];
    return { timestamp: m.timestamp, missionName: m.missionName, difficulty: m.difficulty, result: m.result, duration: m.duration, gameIndex };
  }
  const raw = validItems[0].raw;
  return { timestamp: raw.timestamp, missionName: raw.missionName, difficulty: raw.difficulty, result: raw.result, duration: raw.duration, gameIndex: raw.gameIndex ?? -1 };
}

/** Extract player-level info (name, value, color) from a tooltip data point. */
function getTooltipPlayerInfo(dataPoint, isBarMode) {
  if (isBarMode) {
    const ds = dataPoint.dataset;
    const colors = ds.backgroundColor;
    return {
      name: ds._playerNamesPerGame?.[dataPoint.dataIndex] || 'Unknown',
      playerId: ds._playerIdsPerGame?.[dataPoint.dataIndex],
      value: dataPoint.raw,
      dotColor: sanitizeCssColor(Array.isArray(colors) ? colors[dataPoint.dataIndex] : (colors || '#888')),
    };
  }
  return {
    name: dataPoint.raw.playerNameInGame || 'Unknown',
    playerId: dataPoint.dataset._playerId,
    value: dataPoint.raw.y,
    dotColor: sanitizeCssColor(dataPoint.dataset.borderColor || '#888'),
  };
}

/** Create a Chart.js external tooltip callback that renders HTML into #chart-tooltip. */
function createTooltipHandler(propertyIds, propertyMap, settingsMap, isBarMode, gameMetadata, isVsAverage, games, normalizePerMinute) {
  return (context) => {
    const tooltipElement = document.getElementById('chart-tooltip');
    if (!tooltipElement) return;
    const tooltip = context.tooltip;
    if (tooltip.opacity === 0) { tooltipElement.style.opacity = '0'; return; }

    const validItems = (tooltip.dataPoints || []).filter(dataPoint => {
      if (dataPoint.dataset.data.length === 0) return false;
      if (isBarMode) {
        if (dataPoint.dataset._isBarSlot) return dataPoint.raw != null;
        return false;
      }
      return dataPoint.raw && !isNaN(dataPoint.raw.y);
    });
    if (!validItems.length) { tooltipElement.style.opacity = '0'; return; }

    const gameInfo = getTooltipGameInfo(validItems, isBarMode, gameMetadata, games);
    const date = new Date(gameInfo.timestamp * 1000);
    const difficultyName = DEFAULT_DIFFICULTY_NAMES[gameInfo.difficulty] || gameInfo.difficulty;
    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationMinutes = Math.floor(gameInfo.duration / 60);
    const durationSeconds = gameInfo.duration % 60;

    let html = `<div class="tt-header">${escapeHtml(date.toLocaleDateString())} ${escapeHtml(timeString)}</div>`
      + `<div class="tt-sub">${escapeHtml(gameInfo.missionName)} &middot; ${escapeHtml(String(difficultyName))}`
      + ` &middot; ${escapeHtml(gameInfo.result)} &middot; ${durationMinutes}m${durationSeconds}s</div>`;

    const groupedByProperty = {};
    for (const dataPoint of validItems) {
      const propertyIndex = dataPoint.dataset._propertyIndex ?? 0;
      if (!groupedByProperty[propertyIndex]) groupedByProperty[propertyIndex] = [];
      groupedByProperty[propertyIndex].push(dataPoint);
    }

    for (const propertyIndex of Object.keys(groupedByProperty).map(Number).sort((a, b) => a - b)) {
      const propertyId = propertyIds[propertyIndex];
      const metadata = propertyMap[propertyId];
      const propertyName = metadata?.display_name || propertyId;
      const sortAscending = metadata?.sort_direction === 'ASC';

      const sortedGroup = groupedByProperty[propertyIndex].sort((a, b) => {
        const valueA = isBarMode ? a.raw : a.raw.y;
        const valueB = isBarMode ? b.raw : b.raw.y;
        return sortAscending ? valueB - valueA : valueA - valueB;
      });

      html += `<div class="tt-prop-name">${escapeHtml(propertyName)}`;
      if (isVsAverage && games && gameInfo.gameIndex >= 0 && gameInfo.gameIndex < games.length) {
        const avg = computeGameMean(games[gameInfo.gameIndex], propertyId, normalizePerMinute);
        html += ` <span style="color:#ffeb3b;font-weight:normal;font-size:0.85em">(avg: ${formatNumber(avg)})</span>`;
      }
      html += `</div>`;

      for (const dataPoint of sortedGroup) {
        const info = getTooltipPlayerInfo(dataPoint, isBarMode);
        const customName = info.playerId ? settingsMap[info.playerId]?.name : null;
        const label = customName ? `${info.name} (${customName})` : info.name;
        html += `<div class="tt-player">`
          + `<span class="tt-dot" style="background:${escapeHtml(info.dotColor)}"></span>`
          + `<span>${escapeHtml(label)}</span>`
          + `<span class="tt-val">${isVsAverage && info.value > 0 ? '+' : ''}${formatNumber(info.value)}${isVsAverage ? '%' : ''}</span></div>`;
      }
    }

    tooltipElement.innerHTML = html;
    tooltipElement.style.opacity = '1';

    const chartRect = context.chart.canvas.getBoundingClientRect();
    let left = tooltip.caretX + 12;
    let top = tooltip.caretY - 12;
    if (left + tooltipElement.offsetWidth > chartRect.width) {
      left = tooltip.caretX - tooltipElement.offsetWidth - 12;
    }
    if (top + tooltipElement.offsetHeight > chartRect.height) {
      top = chartRect.height - tooltipElement.offsetHeight - 4;
    }
    if (top < 0) top = 4;
    tooltipElement.style.left = left + 'px';
    tooltipElement.style.top = top + 'px';
  };
}

const verticalLinePlugin = {
  id: 'verticalCrosshair',
  afterDraw(chart) {
    if (!chart.tooltip?._active?.length) return;
    const activeElement = chart.tooltip._active[0];
    const xPosition = chart.config.type === 'bar'
      ? chart.scales.x.getPixelForValue(activeElement.index)
      : activeElement.element.x;
    const yAxis = chart.scales.y;
    const context = chart.ctx;
    context.save();
    context.beginPath();
    context.moveTo(xPosition, yAxis.top);
    context.lineTo(xPosition, yAxis.bottom);
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    context.setLineDash([4, 4]);
    context.stroke();
    context.restore();
  },
};

const gameBackgroundPlugin = {
  id: 'gameBackgrounds',
  beforeDatasetsDraw(chart) {
    const options = chart.options.plugins.gameBackgrounds;
    if (!options?.bands?.length) return;
    const { ctx } = chart;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;
    ctx.save();
    for (const band of options.bands) {
      const pixelMin = xAxis.getPixelForValue(band.xMin);
      const pixelMax = xAxis.getPixelForValue(band.xMax);
      ctx.fillStyle = band.result === 'won' ? 'rgba(0,66,3,0.2)' : 'rgba(73,0,0,0.2)';
      ctx.fillRect(pixelMin, yAxis.top, pixelMax - pixelMin, yAxis.bottom - yAxis.top);
    }
    ctx.restore();
  },
};

/** Register custom Chart.js plugins (crosshair line and win/loss backgrounds). */
function registerPlugins() {
  Chart.register(verticalLinePlugin, gameBackgroundPlugin);
}

// ── Composables ────────────────────────────────────────────────────

/** Composable: single-open dropdown management with click-outside closing. */
function useDropdown() {
  const openDropdown = ref(null);

  function toggleDropdown(name) {
    openDropdown.value = openDropdown.value === name ? null : name;
  }

  const closeDropdowns = () => { openDropdown.value = null; };

  onMounted(() => document.addEventListener('click', closeDropdowns));
  onUnmounted(() => document.removeEventListener('click', closeDropdowns));

  return { openDropdown, toggleDropdown };
}

/** Composable: filter state (properties, time range, difficulty, missions) and game loading. */
function useFilters() {
  const propertyGroups = ref([]);
  const availableMissions = ref([]);
  const availableDifficulties = ref([]);
  const availableModifiers = ref([]);
  const difficultyNames = ref({ ...DEFAULT_DIFFICULTY_NAMES });

  const selectedPropertyIds = ref(['actual_damage_dealt']);
  let skipFilterSave = true;

  const rangeMode = ref('all');
  const customStartDate = ref('');
  const customEndDate = ref('');
  const lastNGames = ref(50);
  const resultFilter = ref('won_and_long_lost');
  const selectedDifficulties = ref([]);
  const selectedMissions = ref([]);
  const selectedModifiers = ref([]);

  const games = ref([]);
  const loading = ref(false);
  const loadGeneration = ref(0);
  const errorMessage = ref('');
  const gameCountDisplay = ref(0);

  const propertyMap = computed(() => {
    const map = {};
    for (const group of propertyGroups.value) {
      for (const property of group.properties) {
        map[property.id] = { ...property, group_id: group.group_id, group_name: group.group_name };
      }
    }
    return map;
  });

  const selectedPropertyNames = computed(() => {
    if (selectedPropertyIds.value.length === 0) return 'Select property...';
    return selectedPropertyIds.value
      .map(id => propertyMap.value[id]?.display_name || id)
      .join(', ');
  });

  const difficultyLabel = computed(() => {
    if (selectedDifficulties.value.length === availableDifficulties.value.length) return 'All';
    if (selectedDifficulties.value.length === 0) return 'None';
    return selectedDifficulties.value
      .map(id => difficultyNames.value[id] || id)
      .join(', ');
  });

  const missionLabel = computed(() => {
    if (selectedMissions.value.length === availableMissions.value.length) return 'All';
    if (selectedMissions.value.length === 0) return 'None';
    return `${selectedMissions.value.length} selected`;
  });

  const modifierLabel = computed(() => {
    if (selectedModifiers.value.length === availableModifiers.value.length) return 'All';
    if (selectedModifiers.value.length === 0) return 'None';
    return `${selectedModifiers.value.length} selected`;
  });

  const propertyDepthMap = computed(() => {
    const map = propertyMap.value;
    const depths = {};
    for (const id in map) {
      let depth = 0;
      let current = id;
      const seen = new Set();
      while (map[current]?.parent_id && map[map[current].parent_id] && !seen.has(current)) {
        seen.add(current);
        current = map[current].parent_id;
        depth++;
      }
      depths[id] = depth;
    }
    return depths;
  });

  function propertyDepth(propertyId) { return propertyDepthMap.value[propertyId] || 0; }

  const PROPERTY_LEVEL_COLORS = ['#ffffff', '#a0a0b0', '#707078'];
  function propertyLevelColor(propertyId) {
    const depth = propertyDepth(propertyId);
    return PROPERTY_LEVEL_COLORS[Math.min(depth, PROPERTY_LEVEL_COLORS.length - 1)];
  }

  function removeProperty(propertyId) {
    const index = selectedPropertyIds.value.indexOf(propertyId);
    if (index !== -1) selectedPropertyIds.value.splice(index, 1);
  }

  function loadInitialData() {
    const properties = getProperties();
    const filters = getFilters();

    propertyGroups.value = properties;
    availableMissions.value = filters.missions;
    availableDifficulties.value = filters.difficulties;
    availableModifiers.value = filters.modifiers;

    const names = { ...DEFAULT_DIFFICULTY_NAMES };
    for (const d of filters.difficulties) {
      names[d.id] = d.name;
    }
    difficultyNames.value = names;

    // Defaults
    selectedDifficulties.value = filters.difficulties.map(d => d.id);
    selectedMissions.value = filters.missions
      .filter(m => m.id !== 'psykhanium')
      .map(m => m.id);
    selectedModifiers.value = [...filters.modifiers];
    gameCountDisplay.value = getGameCount();

    // Restore persisted filter settings (DB is ready at this point).
    skipFilterSave = true;
    try {
      const raw = getAppSetting('selected_properties');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const map = propertyMap.value;
          const valid = parsed.filter(id => id in map);
          if (valid.length > 0) selectedPropertyIds.value = valid;
        }
      }

      const savedRange = getAppSetting('range_mode');
      if (savedRange) rangeMode.value = savedRange;

      const savedCustomStart = getAppSetting('custom_start_date');
      if (savedCustomStart) customStartDate.value = savedCustomStart;

      const savedCustomEnd = getAppSetting('custom_end_date');
      if (savedCustomEnd) customEndDate.value = savedCustomEnd;

      const savedLastN = getAppSetting('last_n_games');
      if (savedLastN) lastNGames.value = Number(savedLastN);

      const savedResult = getAppSetting('result_filter');
      if (savedResult) resultFilter.value = savedResult;

      const savedDiffs = getAppSetting('selected_difficulties');
      if (savedDiffs) {
        const parsed = JSON.parse(savedDiffs);
        if (Array.isArray(parsed)) {
          const allIds = new Set(filters.difficulties.map(d => d.id));
          const valid = parsed.filter(id => allIds.has(id));
          if (valid.length > 0) selectedDifficulties.value = valid;
        }
      }

      const savedMissions = getAppSetting('selected_missions');
      if (savedMissions) {
        const parsed = JSON.parse(savedMissions);
        if (Array.isArray(parsed)) {
          const allIds = new Set(filters.missions.map(m => m.id));
          const valid = parsed.filter(id => allIds.has(id));
          if (valid.length > 0) selectedMissions.value = valid;
        }
      }

      const savedModifiers = getAppSetting('selected_modifiers');
      if (savedModifiers) {
        const parsed = JSON.parse(savedModifiers);
        if (Array.isArray(parsed)) {
          const allIds = new Set(filters.modifiers);
          const valid = parsed.filter(id => allIds.has(id));
          if (valid.length > 0) selectedModifiers.value = valid;
        }
      }
    } catch { /* ignore corrupt data */ }
  }

  function loadGames() {
    if (selectedPropertyIds.value.length === 0) { games.value = []; return; }
    loading.value = true;

    const params = {
      propertyIds: [...selectedPropertyIds.value],
      resultFilter: resultFilter.value,
    };

    if (selectedDifficulties.value.length < availableDifficulties.value.length) {
      params.difficulties = [...selectedDifficulties.value];
    }
    if (selectedMissions.value.length < availableMissions.value.length) {
      params.missions = [...selectedMissions.value];
    }
    if (selectedModifiers.value.length < availableModifiers.value.length) {
      params.modifiers = [...selectedModifiers.value];
    }

    if (rangeMode.value === 'last_n') {
      params.lastNGames = lastNGames.value;
    } else if (rangeMode.value === 'custom') {
      if (customStartDate.value) {
        params.startTime = Math.floor(new Date(customStartDate.value).getTime() / 1000);
      }
      if (customEndDate.value) {
        params.endTime = Math.floor(new Date(customEndDate.value + 'T23:59:59').getTime() / 1000);
      }
    } else if (rangeMode.value !== 'all') {
      const days = RANGE_DAYS[rangeMode.value] || 0;
      params.startTime = Math.floor(Date.now() / 1000) - days * 86400;
    }

    try {
      games.value = getGames(params);
      errorMessage.value = '';
    } catch (error) {
      console.error('Failed to load games:', error);
      games.value = [];
      errorMessage.value = 'Failed to load game data.';
    }
    loading.value = false;
    loadGeneration.value++;
  }

  const debouncedLoadGames = debounce(loadGames, 300);
  watch(
    [selectedPropertyIds, rangeMode, customStartDate, customEndDate,
     lastNGames, resultFilter, selectedDifficulties, selectedMissions, selectedModifiers],
    debouncedLoadGames,
    { deep: true }
  );

  // Persist all filter settings on change (skip the initial restore trigger).
  watch(
    [selectedPropertyIds, rangeMode, customStartDate, customEndDate,
     lastNGames, resultFilter, selectedDifficulties, selectedMissions, selectedModifiers],
    () => {
      if (skipFilterSave) { skipFilterSave = false; return; }
      saveAppSetting('selected_properties', JSON.stringify(selectedPropertyIds.value));
      saveAppSetting('range_mode', rangeMode.value);
      saveAppSetting('custom_start_date', customStartDate.value);
      saveAppSetting('custom_end_date', customEndDate.value);
      saveAppSetting('last_n_games', String(lastNGames.value));
      saveAppSetting('result_filter', resultFilter.value);
      saveAppSetting('selected_difficulties', JSON.stringify(selectedDifficulties.value));
      saveAppSetting('selected_missions', JSON.stringify(selectedMissions.value));
      saveAppSetting('selected_modifiers', JSON.stringify(selectedModifiers.value));
    },
    { deep: true }
  );

  // Validate persisted property IDs once propertyMap is available.
  watch(propertyMap, (map) => {
    if (Object.keys(map).length === 0) return;
    const valid = selectedPropertyIds.value.filter(id => id in map);
    if (valid.length !== selectedPropertyIds.value.length) {
      selectedPropertyIds.value = valid.length > 0 ? valid : ['actual_damage_dealt'];
    }
  });

  return {
    propertyGroups, availableMissions, availableDifficulties, availableModifiers, difficultyNames,
    selectedPropertyIds, rangeMode, customStartDate, customEndDate, lastNGames,
    resultFilter, selectedDifficulties, selectedMissions, selectedModifiers,
    games, loading, loadGeneration, errorMessage, gameCountDisplay,
    propertyMap, selectedPropertyNames, difficultyLabel, missionLabel, modifierLabel,
    propertyDepth, propertyLevelColor, removeProperty,
    loadInitialData, loadGames,
  };
}

/** Composable: player list, tracked player settings (names, colors), and CRUD operations. */
function usePlayerManagement() {
  const allPlayers = ref([]);
  const showPlayerDialog = ref(false);
  const playerEdits = reactive({});
  const minGamesFilter = ref(3);

  /** Restore persisted min games filter. Must be called after DB is ready. */
  function restorePlayerSettings() {
    try {
      const saved = getAppSetting('min_games_filter');
      if (saved) minGamesFilter.value = Number(saved);
    } catch { /* ignore */ }
  }

  watch(minGamesFilter, (val) => {
    saveAppSetting('min_games_filter', String(val));
  });

  const trackedPlayers = computed(() =>
    allPlayers.value.filter(player => player.custom_name || player.color)
  );

  const humanPlayers = computed(() =>
    allPlayers.value
      .filter(player => !player.is_bot && (player.game_count || 0) >= minGamesFilter.value)
      .sort((a, b) => {
        const aTracked = a.custom_name || a.color ? 0 : 1;
        const bTracked = b.custom_name || b.color ? 0 : 1;
        if (aTracked !== bTracked) return aTracked - bTracked;
        return (b.game_count || 0) - (a.game_count || 0);
      })
  );

  const playerSettingsMap = computed(() => {
    const map = {};
    for (const player of allPlayers.value) {
      if (player.custom_name || player.color) {
        map[player.id] = {
          name: player.custom_name || player.names[0] || player.id,
          color: player.color || '#888',
        };
      }
    }
    return map;
  });

  function loadPlayers() {
    allPlayers.value = getPlayers();
  }

  function initPlayerEdits() {
    for (const player of allPlayers.value) {
      if (player.custom_name || player.color) {
        playerEdits[player.id] = {
          custom_name: player.custom_name || '',
          color: player.color || '#888888',
        };
      }
    }
  }

  function updatePlayerEdit(playerId, field, value) {
    if (!playerEdits[playerId]) playerEdits[playerId] = { custom_name: '', color: '#888888' };
    playerEdits[playerId][field] = value;
  }

  function savePlayerSettingsAction(playerId) {
    const edit = playerEdits[playerId];
    if (!edit) return;
    savePlayerSettingsDB(playerId, edit.custom_name || null, edit.color || null);
    loadPlayers();
  }

  function clearPlayerSettingsAction(playerId) {
    delete playerEdits[playerId];
    savePlayerSettingsDB(playerId, null, null);
    loadPlayers();
  }

  return {
    allPlayers, showPlayerDialog, playerEdits, minGamesFilter,
    trackedPlayers, humanPlayers, playerSettingsMap,
    loadPlayers, initPlayerEdits, restorePlayerSettings, updatePlayerEdit,
    savePlayerSettings: savePlayerSettingsAction,
    clearPlayerSettings: clearPlayerSettingsAction,
  };
}

/** Composable: Chart.js lifecycle, dataset building, stats computation, and render loop. */
function useChart({ games, selectedPropertyIds, resultFilter, loading, loadGeneration, propertyMap, trackedPlayers, playerSettingsMap }) {
  const chartCanvas = ref(null);
  const normalizePerMinute = ref(false);
  const showVsAverage = ref(false);
  const hideUnnamed = ref(false);
  const hideBots = ref(true);
  const chartMode = ref('line');
  const xAxisMode = ref('time');
  const perName = ref(false);
  const hiddenLegendProperties = reactive(new Set());

  let skipToggleSave = true;

  /** Restore persisted chart toggle settings. Must be called after DB is ready. */
  function restoreChartSettings() {
    skipToggleSave = true;
    try {
      const saved = getAppSetting('chart_toggles');
      if (saved) {
        const t = JSON.parse(saved);
        if (t.normalizePerMinute != null) normalizePerMinute.value = t.normalizePerMinute;
        if (t.showVsAverage != null) showVsAverage.value = t.showVsAverage;
        if (t.hideUnnamed != null) hideUnnamed.value = t.hideUnnamed;
        if (t.hideBots != null) hideBots.value = t.hideBots;
        if (t.chartMode) chartMode.value = t.chartMode;
        if (t.xAxisMode) xAxisMode.value = t.xAxisMode;
        if (t.perName != null) perName.value = t.perName;
      }
    } catch { /* ignore corrupt data */ }
    nextTick(() => { skipToggleSave = false; });
  }

  let chartInstance = null;

  // Grey color assignment for untracked players
  const greyColorMap = new Map();
  let greyCounter = 0;

  const effectiveXAxisMode = computed(() =>
    chartMode.value === 'bar' ? 'index' : xAxisMode.value
  );

  const showWinRate = computed(() =>
    resultFilter.value === 'all' || resultFilter.value === 'won_and_long_lost'
  );

  const showStreaks = computed(() => resultFilter.value === 'all');

  const generalStatsData = computed(() => {
    if (games.value.length === 0 || trackedPlayers.value.length === 0) return null;
    // Build groups with parent and their sub-rows
    const groups = [];
    for (const player of trackedPlayers.value) {
      const parent = computePlayerGeneralStats(player, games.value);
      // Skip players with 0 games
      if (parent.totalGames === 0) continue;
      const group = { parent, subs: [] };
      if (perName.value) {
        const nameSet = new Set();
        for (const game of games.value) {
          const n = game.players[player.id];
          if (n && player.id in game.scores) nameSet.add(n);
        }
        for (const name of [...nameSet].sort()) {
          const sub = computePlayerGeneralStats(player, games.value, name);
          sub.name = name;
          sub._isSubName = true;
          sub._parentColor = player.color || '#888';
          group.subs.push(sub);
        }
      }
      groups.push(group);
    }
    // Sort groups by parent's total games (descending)
    groups.sort((a, b) => b.parent.totalGames - a.parent.totalGames);
    // Flatten into players array
    const players = [];
    for (const group of groups) {
      players.push(group.parent);
      players.push(...group.subs);
    }
    return { players };
  });

  const relativeStatsData = computed(() => {
    if (trackedPlayers.value.length < 2 || games.value.length === 0) return null;
    const tp = trackedPlayers.value;
    // Find main player (most games)
    const gameCounts = tp.map(p => {
      let count = 0;
      for (const game of games.value) { if (p.id in game.scores) count++; }
      return count;
    });
    // Skip if max game count is 0
    const maxGames = Math.max(...gameCounts);
    if (maxGames === 0) return null;
    const mainIdx = gameCounts.indexOf(maxGames);
    const main = tp[mainIdx];
    // Together pairs: main player + each other player
    const togetherPairs = [];
    for (let i = 0; i < tp.length; i++) {
      if (i === mainIdx) continue;
      const other = tp[i];
      // Skip players with 0 games
      if (gameCounts[i] === 0) continue;
      let together = 0, wins = 0;
      for (const game of games.value) {
        if (main.id in game.scores && other.id in game.scores) {
          together++;
          if (game.result === 'won') wins++;
        }
      }
      if (together > 0) {
        togetherPairs.push({
          nameA: main.custom_name || main.names[0] || main.id,
          nameB: other.custom_name || other.names[0] || other.id,
          colorA: main.color || '#888',
          colorB: other.color || '#888',
          gamesTogether: together,
          winRateTogether: Math.round(wins / together * 100),
        });
      }
    }
    // Apart pairs: main player without each other player
    const apartPairs = [];
    for (let i = 0; i < tp.length; i++) {
      if (i === mainIdx) continue;
      const other = tp[i];
      // Skip players with 0 games
      if (gameCounts[i] === 0) continue;
      let apart = 0, wins = 0;
      for (const game of games.value) {
        if (main.id in game.scores && !(other.id in game.scores)) {
          apart++;
          if (game.result === 'won') wins++;
        }
      }
      if (apart > 0) {
        apartPairs.push({
          nameA: main.custom_name || main.names[0] || main.id,
          nameB: other.custom_name || other.names[0] || other.id,
          colorA: main.color || '#888',
          colorB: other.color || '#888',
          gamesApart: apart,
          winRateApart: Math.round(wins / apart * 100),
        });
      }
    }
    return { togetherPairs, apartPairs };
  });

  const statsData = computed(() => {
    if (games.value.length === 0 || trackedPlayers.value.length === 0) return [];
    return selectedPropertyIds.value.map(propertyId => {
      const propertyMeta = propertyMap.value[propertyId];
      const sortAscending = propertyMeta?.sort_direction === 'ASC';
      const gameMeans = games.value.map(game =>
        computeGameMean(game, propertyId, normalizePerMinute.value)
      );
      const gameBests = precomputeGameBests(games.value, propertyId, normalizePerMinute.value, sortAscending);
      // Build groups with parent and their sub-rows
      const groups = [];
      for (const player of trackedPlayers.value) {
        const parent = computePlayerStats(player, games.value, propertyId, sortAscending, normalizePerMinute.value, gameMeans, gameBests);
        // Skip players with 0 games for this property
        if (parent.bestTotal === 0) continue;
        const group = { parent, subs: [] };
        if (perName.value) {
          const nameSet = new Set();
          for (const game of games.value) {
            const n = game.players[player.id];
            if (n && player.id in game.scores) nameSet.add(n);
          }
          for (const name of [...nameSet].sort()) {
            const sub = computePlayerStats(player, games.value, propertyId, sortAscending, normalizePerMinute.value, gameMeans, gameBests, name);
            sub.name = name;
            sub._isSubName = true;
            sub._parentColor = player.color || '#888';
            group.subs.push(sub);
          }
        }
        groups.push(group);
      }
      // Sort groups by parent's total games (descending)
      groups.sort((a, b) => b.parent.bestTotal - a.parent.bestTotal);
      // Flatten into players array
      const players = [];
      for (const group of groups) {
        players.push(group.parent);
        players.push(...group.subs);
      }
      return {
        propertyId,
        propertyName: propertyMeta?.display_name || propertyId,
        sortAscending,
        players,
      };
    });
  });

  watch(chartMode, () => { hiddenLegendProperties.clear(); });

  // Persist chart toggle settings on change.
  watch(
    [normalizePerMinute, showVsAverage, hideUnnamed, hideBots, chartMode, xAxisMode, perName],
    () => {
      if (skipToggleSave) { skipToggleSave = false; return; }
      saveAppSetting('chart_toggles', JSON.stringify({
        normalizePerMinute: normalizePerMinute.value,
        showVsAverage: showVsAverage.value,
        hideUnnamed: hideUnnamed.value,
        hideBots: hideBots.value,
        chartMode: chartMode.value,
        xAxisMode: xAxisMode.value,
        perName: perName.value,
      }));
    }
  );

  function buildChartData() {
    const currentGames = games.value;
    const propertyIds = selectedPropertyIds.value;
    const isBarMode = chartMode.value === 'bar';
    if (!currentGames.length || !propertyIds.length) {
      return { datasets: [], bands: [], labels: [], gameMetadata: [] };
    }

    const trackedIds = new Set(trackedPlayers.value.map(player => player.id));
    const settings = playerSettingsMap.value;

    const allPlayerIds = new Set();
    for (const game of currentGames) {
      for (const playerId of Object.keys(game.scores)) {
        allPlayerIds.add(playerId);
        if (!settings[playerId] && !greyColorMap.has(playerId)) {
          greyColorMap.set(playerId, GREY_SHADES[greyCounter % GREY_SHADES.length]);
          greyCounter++;
        }
      }
    }

    const datasets = [];
    for (let propertyIndex = 0; propertyIndex < propertyIds.length; propertyIndex++) {
      const propertyId = propertyIds[propertyIndex];
      const propertyMeta = propertyMap.value[propertyId];
      const propertyLabel = propertyMeta?.display_name || propertyId;

      const builderOptions = {
        games: currentGames, propertyId, propertyIndex, propertyLabel,
        allPlayerIds, trackedIds, settingsMap: settings, greyColorMap,
        selectedPropertyCount: propertyIds.length,
        hideBots: hideBots.value, hideUnnamed: hideUnnamed.value,
        normalizePerMinute: normalizePerMinute.value,
        vsAverage: showVsAverage.value, xAxisMode: effectiveXAxisMode.value,
        perName: perName.value, trackedPlayers: trackedPlayers.value,
        hiddenLegendProperties,
      };

      const playerDatasets = isBarMode
        ? buildBarPlayerDatasets(builderOptions)
        : buildScatterPlayerDatasets(builderOptions);
      datasets.push(...playerDatasets);
    }

    const bands = buildBackgroundBands(currentGames, resultFilter.value, effectiveXAxisMode.value);
    const labels = isBarMode ? currentGames.map((_, index) => index.toString()) : [];
    const gameMetadata = isBarMode
      ? currentGames.map(game => ({
          timestamp: game.timestamp, missionName: game.mission_name,
          difficulty: game.difficulty, result: game.result, duration: game.duration_seconds,
        }))
      : [];

    return { datasets, bands, labels, gameMetadata, currentGames };
  }

  function renderChart() {
    const canvas = chartCanvas.value;
    if (!canvas) return;

    const { datasets, bands, labels, gameMetadata, currentGames } = buildChartData();
    const settings = playerSettingsMap.value;
    const propertyIds = selectedPropertyIds.value;
    const propertyMapValue = propertyMap.value;
    const needsSecondAxis = propertyIds.length > 1 && !showVsAverage.value;
    const isBarMode = chartMode.value === 'bar';

    const annotations = {};
    if (showVsAverage.value) {
      annotations['avgLine'] = {
        type: 'line', yMin: 0, yMax: 0,
        borderColor: 'rgba(255, 235, 59, 0.6)', borderWidth: 2, borderDash: [6, 4],
        label: {
          display: true, content: 'Average', position: 'start',
          backgroundColor: 'rgba(255, 235, 59, 0.15)', color: '#ffeb3b', font: { size: 10 },
        },
      };
    }

    const isVsAverage = showVsAverage.value;
    const yTickCallback = isVsAverage
      ? (value) => (value > 0 ? '+' : '') + formatNumber(value) + '%'
      : (value) => formatNumber(value);
    const yAxisConfig = {
      y: {
        position: 'left', beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#a0a0b0', callback: yTickCallback },
      },
    };
    if (needsSecondAxis) {
      yAxisConfig.y1 = {
        position: 'right', beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: { color: '#a0a0b0', callback: yTickCallback },
      };
    }

    const xAxisConfig = isBarMode
      ? { type: 'category', grid: { display: false }, ticks: { color: '#a0a0b0', autoSkip: true, maxTicksLimit: 30 } }
      : {
          type: 'linear',
          min: effectiveXAxisMode.value === 'index' ? 0 : undefined,
          grid: { display: false },
          ticks: {
            color: '#a0a0b0',
            callback: (value) => effectiveXAxisMode.value === 'time'
              ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
              : Math.round(value),
            maxTicksLimit: 20,
          },
        };

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas.getContext('2d'), {
      type: isBarMode ? 'bar' : 'scatter',
      data: { labels: isBarMode ? labels : undefined, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: isBarMode ? 'index' : 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            display: true, position: 'top',
            labels: {
              color: '#e0e0e0', font: { size: 11 },
              filter: (item) => datasets[item.datasetIndex]?._isTracked,
              usePointStyle: true, pointStyle: 'circle',
            },
            onClick: (event, legendItem, legend) => {
              const dataset = legend.chart.data.datasets[legendItem.datasetIndex];
              const propertyId = dataset?._propertyId;
              if (!propertyId) return;
              if (hiddenLegendProperties.has(propertyId)) hiddenLegendProperties.delete(propertyId);
              else hiddenLegendProperties.add(propertyId);
              nextTick(renderChart);
            },
          },
          tooltip: {
            enabled: false,
            external: createTooltipHandler(
              [...propertyIds], { ...propertyMapValue }, { ...settings },
              isBarMode, gameMetadata, showVsAverage.value,
              currentGames, normalizePerMinute.value,
            ),
          },
          annotation: { annotations },
          gameBackgrounds: { bands },
        },
        scales: { x: xAxisConfig, ...yAxisConfig },
      },
    });
  }

  watch(
    [loadGeneration, normalizePerMinute, showVsAverage, hideUnnamed, hideBots, chartMode, xAxisMode, perName, trackedPlayers],
    () => {
      if (loading.value) return;
      nextTick(renderChart);
    },
    { deep: true }
  );

  onUnmounted(() => {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  });

  function deviationClass(deviation, sortAscending) {
    return (sortAscending ? deviation >= 0 : deviation <= 0) ? 'positive' : 'negative';
  }

  return {
    chartCanvas, normalizePerMinute, showVsAverage, hideUnnamed, hideBots,
    chartMode, xAxisMode, effectiveXAxisMode, perName, hiddenLegendProperties,
    showWinRate, showStreaks, generalStatsData, relativeStatsData, statsData,
    renderChart, restoreChartSettings, deviationClass,
  };
}

/** Composable: directory picker, file input fallback, ingestion, progress, and DB reset. */
function useIngestion() {
  const dbReady = ref(false);
  const ingesting = ref(false);
  const ingestProgress = ref('');
  const dirHandle = ref(null);
  const hasNativeAccess = typeof window.showDirectoryPicker === 'function';

  async function init() {
    await initDatabase();
    if (hasNativeAccess) dirHandle.value = await _loadDirHandle();
    dbReady.value = true;
  }

  async function doIngest(source, onComplete) {
    ingesting.value = true;
    ingestProgress.value = 'Starting ingestion...';
    try {
      const result = await ingestFiles(source, (current, total, msg) => {
        ingestProgress.value = msg;
      });
      if (result.ingested > 0) autoSetupDefaultPlayer();
      if (onComplete) onComplete();
      ingestProgress.value = `Done: ${result.ingested} new games ingested (${result.total} total files).`;
    } catch (e) {
      console.error('Ingestion error:', e);
      ingestProgress.value = 'Ingestion failed: ' + e.message;
    }
    ingesting.value = false;
  }

  async function pickDirectory(onComplete) {
    try {
      dirHandle.value = await window.showDirectoryPicker({ id: 'scoreboard-dir', mode: 'read' });
      await _saveDirHandle(dirHandle.value);
      await doIngest(dirHandle.value, onComplete);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Directory picker error:', e);
      }
    }
  }

  /** Fallback: open a file input with webkitdirectory to select a folder. */
  function pickFiles(onComplete) {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;
      await doIngest(files, onComplete);
    });
    input.click();
  }

  async function reingest(onComplete) {
    if (!dirHandle.value) {
      await pickDirectory(onComplete);
      return;
    }
    try {
      const perm = await dirHandle.value.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        const req = await dirHandle.value.requestPermission({ mode: 'read' });
        if (req !== 'granted') { await pickDirectory(onComplete); return; }
      }
      await doIngest(dirHandle.value, onComplete);
    } catch {
      await pickDirectory(onComplete);
    }
  }

  async function resetDB(onComplete) {
    if (!confirm('This will delete all imported data. Continue?')) return;
    await clearDatabase();
    if (onComplete) onComplete();
  }

  return { dbReady, ingesting, ingestProgress, dirHandle, hasNativeAccess, init, pickDirectory, pickFiles, reingest, resetDB };
}

// ── App Bootstrap ──────────────────────────────────────────────────

registerPlugins();

const app = createApp({
  setup() {
    const { openDropdown, toggleDropdown } = useDropdown();
    const filters = useFilters();
    const playerMgmt = usePlayerManagement();
    const ingestion = useIngestion();

    const chart = useChart({
      games: filters.games,
      selectedPropertyIds: filters.selectedPropertyIds,
      resultFilter: filters.resultFilter,
      loading: filters.loading,
      loadGeneration: filters.loadGeneration,
      propertyMap: filters.propertyMap,
      trackedPlayers: playerMgmt.trackedPlayers,
      playerSettingsMap: playerMgmt.playerSettingsMap,
    });

    function groupColor(groupId) { return GROUP_COLORS[groupId] || '#888'; }

    function reloadAll() {
      filters.loadInitialData();
      playerMgmt.loadPlayers();
      playerMgmt.initPlayerEdits();
      playerMgmt.restorePlayerSettings();
      chart.restoreChartSettings();
      // filter watcher handles loadGames via debounced reaction to filter changes
    }

    function afterReset() {
      filters.loadInitialData();
      playerMgmt.loadPlayers();
      filters.games.value = [];
      filters.loadGeneration.value++;
      filters.gameCountDisplay.value = 0;
    }

    const onEscape = (e) => {
      if (e.key === 'Escape' && playerMgmt.showPlayerDialog.value) {
        playerMgmt.showPlayerDialog.value = false;
      }
    };

    onMounted(async () => {
      window.addEventListener('keydown', onEscape);
      try {
        await ingestion.init();
        reloadAll();
      } catch (e) {
        console.error('DB init failed:', e);
        filters.errorMessage.value = 'Failed to initialize database: ' + e.message;
      }
    });

    onUnmounted(() => {
      window.removeEventListener('keydown', onEscape);
    });

    const isWindows = true; //navigator.userAgent.indexOf('Win') !== -1;
    const showPathHint = ref(false);

    function showPathHintOverlay(action) {
      if (!isWindows) { action(); return; }
      showPathHint.value = true;
      nextTick(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => action());
        });
      });
    }

    function dismissPathHint() {
      showPathHint.value = false;
    }

    watch(ingestion.ingesting, (v) => { if (v) showPathHint.value = false; });

    return {
      ...filters,
      ...playerMgmt,
      ...chart,
      // Ingestion (wrapped with callbacks)
      dbReady: ingestion.dbReady,
      ingesting: ingestion.ingesting,
      ingestProgress: ingestion.ingestProgress,
      dirHandle: ingestion.dirHandle,
      hasNativeAccess: ingestion.hasNativeAccess,
      showPathHint,
      dismissPathHint,
      pickDirectory: () => showPathHintOverlay(async () => { await ingestion.pickDirectory(reloadAll); showPathHint.value = false; }),
      pickFiles: () => showPathHintOverlay(() => ingestion.pickFiles(reloadAll)),
      reingest: () => ingestion.reingest(reloadAll),
      resetDatabase: () => ingestion.resetDB(afterReset),
      resetSettings: async () => {
        if (!confirm('Reset all settings to defaults?')) return;
        await clearAppSettings();
        location.reload();
      },
      // Dropdown
      openDropdown,
      toggleDropdown,
      // Utilities
      groupColor,
      formatNum: formatNumber,
      formatDuration,
      MAX_SELECTED_PROPERTIES,
    };
  },
});

app.component('multi-select', MultiSelect);
app.mount('#app');

})();
