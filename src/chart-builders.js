/**
 * chart-builders.js — Chart dataset construction.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const { shiftColor } = App;
const { precomputeGameAverages, computePointValue } = App;

/** Build Chart.js scatter/line datasets: one dataset per player per property. */
function buildScatterPlayerDatasets(options) {
  const {
    games, propertyId, propertyIndex, propertyLabel, allPlayerIds,
    trackedIds, settingsMap, greyColorMap, selectedPropertyCount,
    hideBots, hideUnnamed, normalizePerMinute, vsAverage, xAxisMode,
    perName, trackedPlayers, hiddenLegendProperties,
    vsOthers, mainPlayerId,
  } = options;

  const isDeviation = vsAverage || vsOthers;
  const useSecondAxis = !isDeviation && selectedPropertyCount > 1;
  const gameMeans = isDeviation ? precomputeGameAverages(games, propertyId, normalizePerMinute, vsOthers ? mainPlayerId : undefined) : null;
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

      const value = computePointValue(rawValue, game, normalizePerMinute, isDeviation, gameMeans?.[gameIndex] ?? 0);
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
        missionName: game.missionName,
        difficulty: game.difficulty,
        result: game.result,
        playerNameInGame: game.players[playerId] || 'Unknown',
        rawValue,
        duration: game.durationSeconds,
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
    if (vsOthers && playerId !== mainPlayerId) continue;
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
        const label = `${namePart} - ${propertyLabel}`;
        buildOneDataset(playerId, true, color, label, propertyIndex + nameIndex + 1, name);
      });
    } else {
      const playerLabel = settings?.name || '';
      const datasetLabel = `${playerLabel} - ${propertyLabel}`;
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
    perName, vsOthers, mainPlayerId,
  } = options;

  const isDeviation = vsAverage || vsOthers;
  const useSecondAxis = !isDeviation && selectedPropertyCount > 1;
  const gameMeans = isDeviation ? precomputeGameAverages(games, propertyId, normalizePerMinute, vsOthers ? mainPlayerId : undefined) : null;

  const visiblePlayersPerGame = games.map(game => {
    return Object.keys(game.scores)
      .filter(playerId => {
        if (vsOthers && playerId !== mainPlayerId) return false;
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
        ? computePointValue(rawValue, game, normalizePerMinute, isDeviation, gameMeans?.[gameIndex] ?? 0)
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
        const label = `${namePart} - ${propertyLabel}`;
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
      const playerLabel = `${playerSettings.name} - ${propertyLabel}`;

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

// Exports
App.buildScatterPlayerDatasets = buildScatterPlayerDatasets;
App.buildBarPlayerDatasets = buildBarPlayerDatasets;
App.buildBackgroundBands = buildBackgroundBands;
})();
