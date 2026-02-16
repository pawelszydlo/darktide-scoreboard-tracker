/**
 * chart-tooltip.js — Tooltip logic for Chart.js.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const { DEFAULT_DIFFICULTY_NAMES } = App;
const { escapeHtml, formatNumber, formatNumber2, normalizeValue, computeGameMean, computeGameMeanExcluding } = App;

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
      rawValue: null,
      duration: null,
      dotColor: sanitizeCssColor(Array.isArray(colors) ? colors[dataPoint.dataIndex] : (colors || '#888')),
    };
  }
  return {
    name: dataPoint.raw.playerNameInGame || 'Unknown',
    playerId: dataPoint.dataset._playerId,
    value: dataPoint.raw.y,
    rawValue: dataPoint.raw.rawValue,
    duration: dataPoint.raw.duration,
    dotColor: sanitizeCssColor(dataPoint.dataset.borderColor || '#888'),
  };
}

/** Create a Chart.js external tooltip callback that renders HTML into #chart-tooltip. */
function createTooltipHandler(propertyIds, propertyMap, settingsMap, isBarMode, gameMetadata, isVsAverage, games, normalizePerMinute, isVsOthers, vsOthersPlayerId) {
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

    let html = `<div class="tt-header">${escapeHtml(date.toLocaleDateString('sv-SE'))} ${escapeHtml(timeString)}</div>`
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
      const propertyName = metadata?.displayName || propertyId;
      const sortAscending = metadata?.sortDirection === 'ASC';

      const sortedGroup = groupedByProperty[propertyIndex].sort((a, b) => {
        const valueA = isBarMode ? a.raw : a.raw.y;
        const valueB = isBarMode ? b.raw : b.raw.y;
        return sortAscending ? valueB - valueA : valueA - valueB;
      });

      html += `<div class="tt-prop-name">${escapeHtml(propertyName)}`;
      if (isVsAverage && games && gameInfo.gameIndex >= 0 && gameInfo.gameIndex < games.length) {
        const avg = isVsOthers
          ? computeGameMeanExcluding(games[gameInfo.gameIndex], propertyId, normalizePerMinute, vsOthersPlayerId)
          : computeGameMean(games[gameInfo.gameIndex], propertyId, normalizePerMinute);
        const avgLabel = isVsOthers ? "Others' avg" : 'avg';
        html += ` <span style="color:#ffeb3b;font-weight:normal;font-size:0.85em">(${avgLabel}: ${formatNumber2(avg)})</span>`;
      }
      html += `</div>`;

      for (const dataPoint of sortedGroup) {
        const info = getTooltipPlayerInfo(dataPoint, isBarMode);
        const customName = info.playerId ? settingsMap[info.playerId]?.name : null;
        const isQuitter = info.playerId && games && gameInfo.gameIndex >= 0 && games[gameInfo.gameIndex]?.quitters?.has(info.playerId);
        const quitterTag = isQuitter ? ' <span style="color:#e94560;font-weight:bold">Q</span>' : '';
        const label = customName ? `${info.name} (${customName})` : info.name;
        if (isVsAverage) {
          // Compute normalized actual value for display
          let actualValue;
          if (info.rawValue != null && info.duration != null) {
            actualValue = normalizeValue(info.rawValue, info.duration, normalizePerMinute);
          } else if (games && gameInfo.gameIndex >= 0 && info.playerId) {
            const game = games[gameInfo.gameIndex];
            const rv = game?.scores[info.playerId]?.[propertyId];
            actualValue = rv != null ? normalizeValue(rv, game.durationSeconds, normalizePerMinute) : null;
          }
          const pctValue = info.value;
          const pctSign = pctValue > 0 ? '+' : '';
          const pctColor = (sortAscending ? pctValue >= 0 : pctValue <= 0) ? '#4caf50' : '#e94560';
          html += `<div class="tt-player">`
            + `<span class="tt-dot" style="background:${escapeHtml(info.dotColor)}"></span>`
            + `<span class="tt-name">${escapeHtml(label)}${quitterTag}</span>`
            + `<span class="tt-val">${actualValue != null ? formatNumber(actualValue) : '?'}</span>`
            + `<span class="tt-pct" style="color:${pctColor}">(${pctSign}${formatNumber(pctValue)}%)</span></div>`;
        } else {
          html += `<div class="tt-player">`
            + `<span class="tt-dot" style="background:${escapeHtml(info.dotColor)}"></span>`
            + `<span>${escapeHtml(label)}${quitterTag}</span>`
            + `<span class="tt-val">${formatNumber(info.value)}</span></div>`;
        }
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

// Exports
App.sanitizeCssColor = sanitizeCssColor;
App.getTooltipGameInfo = getTooltipGameInfo;
App.getTooltipPlayerInfo = getTooltipPlayerInfo;
App.createTooltipHandler = createTooltipHandler;
})();
