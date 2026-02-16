/**
 * db.js — Database layer: schema, IndexedDB persistence, queries, and repositories.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const { MISSION_NAMES, DEFAULT_DIFFICULTY_NAMES, LONG_GAME_THRESHOLD_SECONDS } = App;

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
    quitter   INTEGER NOT NULL DEFAULT 0,
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
    color       TEXT,
    is_main     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
`;

const MIGRATIONS = [
  `ALTER TABLE game_players ADD COLUMN quitter INTEGER NOT NULL DEFAULT 0`,
];

function runMigrations() {
  for (const sql of MIGRATIONS) {
    try { _db.run(sql); } catch (_) { /* column already exists */ }
  }
}

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
  _SQL = await initSqlJs();

  const saved = await _loadFromIDB();
  if (saved) {
    try {
      const arr = saved instanceof Uint8Array ? saved : new Uint8Array(saved);
      _db = new _SQL.Database(arr);
      _db.run(SCHEMA_SQL);
      runMigrations();
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
  try {
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
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
    gamePlayerRows.push(gameId, playerId, slot, playerName, 0);
  }
  for (const [botId, cleanName] of Object.entries(game.discoveredBots)) {
    playerRows.push(botId, 1);
    gamePlayerRows.push(gameId, botId, -1, cleanName, 0);
  }
  for (const extraId of game.discoveredExtraPlayers) {
    playerRows.push(extraId, 0);
    gamePlayerRows.push(gameId, extraId, -1, 'Unknown', 1);
  }

  const playerCount = playerRows.length / 2;
  if (playerCount > 0) {
    const placeholders = Array.from({ length: playerCount }, () => '(?,?)').join(',');
    runStatement(`INSERT OR IGNORE INTO players (id, is_bot) VALUES ${placeholders}`, playerRows);
  }

  const gpCount = gamePlayerRows.length / 5;
  if (gpCount > 0) {
    const placeholders = Array.from({ length: gpCount }, () => '(?,?,?,?,?)').join(',');
    runStatement(
      `INSERT OR IGNORE INTO game_players (game_id, player_id, slot, name, quitter) VALUES ${placeholders}`,
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
  const SCORE_BATCH = 500;
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
      displayName: row.display_name,
      groupId: row.group_id,
      groupName: row.group_name,
      sortDirection: row.sort_direction,
      isSummary: !!row.is_summary,
      parentId: row.parent_id,
      rowOrder: row.row_order,
    };
  }

  const childrenOf = {};
  for (const [propId, prop] of Object.entries(allProps)) {
    const parent = prop.parentId || null;
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
    const gid = prop.groupId;
    if (!groups[gid]) {
      groups[gid] = { groupId: gid, groupName: prop.groupName, minOrder: prop.rowOrder, properties: [] };
    }
    groups[gid].properties.push({
      id: prop.id, displayName: prop.displayName,
      sortDirection: prop.sortDirection, isSummary: prop.isSummary,
      parentId: prop.parentId, rowOrder: prop.rowOrder,
    });
  }

  return Object.values(groups).sort((a, b) => a.minOrder - b.minOrder).map(g => ({
    groupId: g.groupId, groupName: g.groupName, properties: g.properties,
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
    timeRange: { min: timeRange?.min_ts || 0, max: timeRange?.max_ts || 0 },
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
      ps.is_main,
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
    isBot: !!r.is_bot,
    names: r.names ? r.names.split(',') : [],
    gameCount: r.game_count || 0,
    customName: r.custom_name || null,
    color: r.color || null,
    isMain: !!r.is_main,
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
    conditions.push(`(g.result = 'won' OR (g.result = 'lost' AND g.duration_seconds > ${LONG_GAME_THRESHOLD_SECONDS}))`);
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
    `SELECT game_id, player_id, name, quitter FROM game_players WHERE game_id IN (${gameIdPlaceholders})`,
    gameIds
  );
  const playersByGame = {};
  const quittersByGame = {};
  for (const row of gamePlayers) {
    if (!playersByGame[row.game_id]) playersByGame[row.game_id] = {};
    playersByGame[row.game_id][row.player_id] = row.name;
    if (row.quitter) {
      if (!quittersByGame[row.game_id]) quittersByGame[row.game_id] = new Set();
      quittersByGame[row.game_id].add(row.player_id);
    }
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
    missionId: g.mission_id,
    missionName: g.mission_name,
    difficulty: g.difficulty,
    modifier: g.modifier,
    result: g.result,
    durationSeconds: g.duration_seconds,
    players: playersByGame[g.id] || {},
    scores: scoresByGame[g.id] || {},
    quitters: quittersByGame[g.id] || new Set(),
  }));
}

/** Upsert a player's custom display name and color into the DB. */
function savePlayerSettingsDB(playerId, customName, color) {
  if (!customName && !color) {
    runStatement(`DELETE FROM player_settings WHERE player_id = ?`, [playerId]);
  } else {
    runStatement(
      `INSERT INTO player_settings (player_id, custom_name, color) VALUES (?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET custom_name = excluded.custom_name, color = excluded.color`,
      [playerId, customName, color]
    );
  }
  saveDatabase();
}

/** Designate a player as the main player (clearing any previous main). */
function saveMainPlayer(playerId) {
  runStatement(`UPDATE player_settings SET is_main = 0 WHERE is_main = 1`, []);
  runStatement(
    `INSERT INTO player_settings (player_id, is_main) VALUES (?, 1)
     ON CONFLICT(player_id) DO UPDATE SET is_main = 1`,
    [playerId]
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
  saveMainPlayer(top.player_id);
}

/** Return total number of imported games. */
function getGameCount() {
  const row = queryOne('SELECT COUNT(*) as cnt FROM games');
  return row ? row.cnt : 0;
}

// Exports
App._saveDirHandle = _saveDirHandle;
App._loadDirHandle = _loadDirHandle;
App.initDatabase = initDatabase;
App.saveDatabase = saveDatabase;
App.runStatement = runStatement;
App.queryRows = queryRows;
App.queryOne = queryOne;
App.clearDatabase = clearDatabase;
App.insertGame = insertGame;
App.getProperties = getProperties;
App.getFilters = getFilters;
App.getPlayers = getPlayers;
App.getGames = getGames;
App.savePlayerSettingsDB = savePlayerSettingsDB;
App.saveMainPlayer = saveMainPlayer;
App.saveAppSetting = saveAppSetting;
App.getAppSetting = getAppSetting;
App.clearAppSettings = clearAppSettings;
App.autoSetupDefaultPlayer = autoSetupDefaultPlayer;
App.getGameCount = getGameCount;
})();
