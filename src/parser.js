/**
 * parser.js — Lua file parsing and ingestion.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME, INGEST_BATCH_SIZE } = App;
const { isUuid, generateBotIdentifier, stripColorCodes, cleanDisplayName, expandChildDisplayName } = App;
const { runStatement, queryRows, saveDatabase, insertGame } = App;

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

  runStatement('BEGIN');
  for (let i = 0; i < newFiles.length; i++) {
    try {
      const { name, content } = await readFileContent(newFiles[i]);
      const game = parseLuaContent(name, content);
      if (!game) { errors++; continue; }

      try {
        insertGame(game);
        ingested++;
      } catch (e) {
        console.error('Error inserting', name, e);
        errors++;
      }
    } catch (e) {
      console.error('Error reading file', e);
      errors++;
    }

    if ((i + 1) % INGEST_BATCH_SIZE === 0) {
      runStatement('COMMIT');
      await saveDatabase();
      runStatement('BEGIN');
      if (progressCallback) progressCallback(i + 1, newFiles.length, `${i + 1}/${newFiles.length} processed...`);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  runStatement('COMMIT');

  if (ingested > 0) backfillUnknownPlayerNames();
  await saveDatabase();
  if (progressCallback) progressCallback(newFiles.length, newFiles.length, `Done: ${ingested} ingested, ${errors} errors.`);
  return { ingested, errors, total: luaFiles.length };
}

/** Update game_players rows named 'Unknown' using known names from other games. */
function backfillUnknownPlayerNames() {
  runStatement(`
    UPDATE game_players
    SET name = (
      SELECT gp2.name FROM game_players gp2
      WHERE gp2.player_id = game_players.player_id
        AND gp2.name != 'Unknown'
      LIMIT 1
    )
    WHERE name = 'Unknown'
      AND EXISTS (
        SELECT 1 FROM game_players gp2
        WHERE gp2.player_id = game_players.player_id
          AND gp2.name != 'Unknown'
      )
  `);
}

// Exports
App.parseLuaContent = parseLuaContent;
App.collectLuaFiles = collectLuaFiles;
App.readFileContent = readFileContent;
App.ingestFiles = ingestFiles;
App.backfillUnknownPlayerNames = backfillUnknownPlayerNames;
})();
