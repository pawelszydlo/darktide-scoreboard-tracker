/**
 * stats.js — Statistics computation.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const { FLOAT_EPSILON } = App;
const { normalizeValue, computeGameMean, computeGameMeanExcluding } = App;

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
    totalPlaytime += game.durationSeconds || 0;
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
    name: player.customName || player.names[0] || player.id,
    color: player.color || '#888',
    isMain: player.isMain,
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

    const displayValue = normalizeValue(playerValue, game.durationSeconds, normalizePerMinute);
    values.push({ value: displayValue, gameMean: gameMeans[i] });
    bestFlags.push(gameBests[i] != null && Math.abs(displayValue - gameBests[i]) < FLOAT_EPSILON);
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
    name: player.customName || player.names[0] || player.id,
    color: player.color || '#888',
    isMain: player.isMain,
    average,
    bestCount,
    bestTotal: total,
    bestPercent,
    deviation: averageDeviation,
  };
}

/** Pre-calculate the per-game team average for a property (used in vs-average mode). */
function precomputeGameAverages(games, propertyId, normalizePerMinute, excludePlayerId) {
  if (excludePlayerId) {
    return games.map(game => computeGameMeanExcluding(game, propertyId, normalizePerMinute, excludePlayerId));
  }
  return games.map(game => computeGameMean(game, propertyId, normalizePerMinute));
}

/** Normalize a raw score and optionally convert to % deviation from game mean. */
function computePointValue(rawValue, game, normalizePerMinute, vsAverage, gameMean) {
  const value = normalizeValue(rawValue, game.durationSeconds, normalizePerMinute);
  if (vsAverage) {
    return gameMean !== 0 ? ((value - gameMean) / gameMean) * 100 : 0;
  }
  return value;
}

// Exports
App.computePlayerGeneralStats = computePlayerGeneralStats;
App.computePlayerStats = computePlayerStats;
App.precomputeGameAverages = precomputeGameAverages;
App.computePointValue = computePointValue;
})();
