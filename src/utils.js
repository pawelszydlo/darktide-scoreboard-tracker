/**
 * utils.js — Pure utility functions with no app dependencies.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const { UUID_PATTERN, COLOR_CODE_PATTERN } = App;

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

/** Format a number with k/m suffixes, keeping two decimal places. */
function formatNumber2(value) {
  if (value == null) return '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'm';
  if (absolute >= 1_000) return (value / 1_000).toFixed(2) + 'k';
  return value.toFixed(2);
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
  const processed = values.map(v => normalizeValue(v, game.durationSeconds, shouldNormalizePerMinute));
  return processed.reduce((sum, v) => sum + v, 0) / Math.min(processed.length, 4);
}

/** Compute the mean value of a property excluding a specific player from a single game. */
function computeGameMeanExcluding(game, propertyId, shouldNormalizePerMinute, excludePlayerId) {
  const values = Object.entries(game.scores)
    .filter(([pid, _]) => pid !== excludePlayerId)
    .map(([_, s]) => s[propertyId])
    .filter(v => v != null);
  if (values.length === 0) return 0;
  const processed = values.map(v => normalizeValue(v, game.durationSeconds, shouldNormalizePerMinute));
  return processed.reduce((sum, v) => sum + v, 0) / Math.min(processed.length, 3);
}

/** For each game, find the best (max or min depending on sort direction) player value. */
function precomputeGameBests(games, propertyId, normalizePerMinute, sortAscending) {
  return games.map(game => {
    const values = Object.values(game.scores)
      .map(s => s[propertyId])
      .filter(v => v != null)
      .map(v => normalizeValue(v, game.durationSeconds, normalizePerMinute));
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

// Exports
App.shiftColor = shiftColor;
App.escapeHtml = escapeHtml;
App.formatNumber = formatNumber;
App.formatNumber2 = formatNumber2;
App.formatDuration = formatDuration;
App.normalizeValue = normalizeValue;
App.computeGameMean = computeGameMean;
App.computeGameMeanExcluding = computeGameMeanExcluding;
App.precomputeGameBests = precomputeGameBests;
App.debounce = debounce;
App.isUuid = isUuid;
App.stripColorCodes = stripColorCodes;
App.generateBotIdentifier = generateBotIdentifier;
App.cleanDisplayName = cleanDisplayName;
App.expandChildDisplayName = expandChildDisplayName;
})();
