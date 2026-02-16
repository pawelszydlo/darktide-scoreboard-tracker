/**
 * app.js — Vue composables and app bootstrap.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App;

const { createApp, ref, reactive, computed, watch, nextTick, onMounted, onUnmounted, shallowRef } = Vue;

// ── Import from App namespace ──────────────────────────────────────

const {
  GROUP_COLORS, GREY_SHADES, DEFAULT_DIFFICULTY_NAMES,
  MAX_SELECTED_PROPERTIES, RANGE_DAYS, PROPERTY_LEVEL_COLORS,
} = App;

const {
  shiftColor, formatNumber, formatDuration, normalizeValue,
  computeGameMean, computeGameMeanExcluding, precomputeGameBests, debounce,
} = App;

const { MultiSelect } = App;

const {
  _saveDirHandle, _loadDirHandle,
  initDatabase, saveDatabase, clearDatabase,
  getProperties, getFilters, getPlayers, getGames,
  savePlayerSettingsDB, saveMainPlayer, saveAppSetting, getAppSetting,
  clearAppSettings, autoSetupDefaultPlayer, getGameCount,
} = App;

const { ingestFiles } = App;

const {
  computePlayerGeneralStats, computePlayerStats,
  precomputeGameAverages, computePointValue,
} = App;

const { buildScatterPlayerDatasets, buildBarPlayerDatasets, buildBackgroundBands } = App;

const { createTooltipHandler } = App;

const { registerPlugins } = App;

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
        map[property.id] = { ...property, groupId: group.groupId, groupName: group.groupName };
      }
    }
    return map;
  });

  const selectedPropertyNames = computed(() => {
    if (selectedPropertyIds.value.length === 0) return 'Select property...';
    return selectedPropertyIds.value
      .map(id => propertyMap.value[id]?.displayName || id)
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
      while (map[current]?.parentId && map[map[current].parentId] && !seen.has(current)) {
        seen.add(current);
        current = map[current].parentId;
        depth++;
      }
      depths[id] = depth;
    }
    return depths;
  });

  function propertyDepth(propertyId) { return propertyDepthMap.value[propertyId] || 0; }

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

  // Load games on any filter change; also persist filter settings (skipping the initial restore trigger).
  watch(
    [selectedPropertyIds, rangeMode, customStartDate, customEndDate,
     lastNGames, resultFilter, selectedDifficulties, selectedMissions, selectedModifiers],
    () => {
      debouncedLoadGames();
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
    allPlayers.value.filter(player => player.customName || player.color)
  );

  const humanPlayers = computed(() =>
    allPlayers.value
      .filter(player => !player.isBot && (player.gameCount || 0) >= minGamesFilter.value)
      .sort((a, b) => {
        const aTracked = a.customName || a.color ? 0 : 1;
        const bTracked = b.customName || b.color ? 0 : 1;
        if (aTracked !== bTracked) return aTracked - bTracked;
        return (b.gameCount || 0) - (a.gameCount || 0);
      })
  );

  const playerSettingsMap = computed(() => {
    const map = {};
    for (const player of allPlayers.value) {
      if (player.customName || player.color) {
        map[player.id] = {
          name: player.customName || player.names[0] || player.id,
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
      if (player.customName || player.color) {
        playerEdits[player.id] = {
          customName: player.customName || '',
          color: player.color || '#888888',
        };
      }
    }
  }

  function updatePlayerEdit(playerId, field, value) {
    if (!playerEdits[playerId]) playerEdits[playerId] = { customName: '', color: '#888888' };
    playerEdits[playerId][field] = value;
  }

  function savePlayerSettingsAction(playerId) {
    const edit = playerEdits[playerId];
    if (!edit) return;
    savePlayerSettingsDB(playerId, edit.customName || null, edit.color || null);
    loadPlayers();
  }

  function clearPlayerSettingsAction(playerId) {
    delete playerEdits[playerId];
    savePlayerSettingsDB(playerId, null, null);
    loadPlayers();
  }

  function setMainPlayer(playerId) {
    saveMainPlayer(playerId);
    loadPlayers();
  }

  return {
    allPlayers, showPlayerDialog, playerEdits, minGamesFilter,
    trackedPlayers, humanPlayers, playerSettingsMap,
    loadPlayers, initPlayerEdits, restorePlayerSettings, updatePlayerEdit,
    savePlayerSettings: savePlayerSettingsAction,
    clearPlayerSettings: clearPlayerSettingsAction,
    setMainPlayer,
  };
}

/** Composable: Chart.js lifecycle, dataset building, stats computation, and render loop. */
function useChart({ games, selectedPropertyIds, resultFilter, loading, loadGeneration, propertyMap, trackedPlayers, playerSettingsMap }) {
  const chartCanvas = ref(null);
  const normalizePerMinute = ref(false);
  const showVsAverage = ref(false);
  const showVsOthers = ref(false);
  const hasMainPlayer = computed(() => trackedPlayers.value.some(p => p.isMain));
  const mainPlayerId = computed(() => trackedPlayers.value.find(p => p.isMain)?.id ?? null);
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
        if (t.showVsOthers != null) showVsOthers.value = t.showVsOthers;
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
  let lastChartType = null;

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
    // Sort groups: main player first, then by total games (descending)
    groups.sort((a, b) => {
      if (a.parent.isMain !== b.parent.isMain) return a.parent.isMain ? -1 : 1;
      return b.parent.totalGames - a.parent.totalGames;
    });
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
    // Find main player (marked as main, or fall back to most games)
    const gameCounts = tp.map(p => {
      let count = 0;
      for (const game of games.value) { if (p.id in game.scores) count++; }
      return count;
    });
    const maxGames = Math.max(...gameCounts);
    if (maxGames === 0) return null;
    let mainIdx = tp.findIndex(p => p.isMain);
    if (mainIdx === -1) {
      mainIdx = gameCounts.indexOf(maxGames);
    }
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
          nameA: main.customName || main.names[0] || main.id,
          nameB: other.customName || other.names[0] || other.id,
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
          nameA: main.customName || main.names[0] || main.id,
          nameB: other.customName || other.names[0] || other.id,
          colorA: main.color || '#888',
          colorB: other.color || '#888',
          gamesApart: apart,
          winRateApart: Math.round(wins / apart * 100),
        });
      }
    }
    return { togetherPairs, apartPairs };
  });

  // Note: precomputeGameAverages and precomputeGameBests are called per-property inside this
  // computed because they depend on propertyId and normalizePerMinute. They cannot be hoisted
  // outside the loop without duplicating the dependency tracking logic.
  const statsData = computed(() => {
    if (games.value.length === 0 || trackedPlayers.value.length === 0) return [];
    return selectedPropertyIds.value.map(propertyId => {
      const propertyMeta = propertyMap.value[propertyId];
      const sortAscending = propertyMeta?.sortDirection === 'ASC';
      const gameMeans = showVsOthers.value && mainPlayerId.value
        ? precomputeGameAverages(games.value, propertyId, normalizePerMinute.value, mainPlayerId.value)
        : games.value.map(game => computeGameMean(game, propertyId, normalizePerMinute.value));
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
      // Sort groups: main player first, then by total games (descending)
      groups.sort((a, b) => {
        if (a.parent.isMain !== b.parent.isMain) return a.parent.isMain ? -1 : 1;
        return b.parent.bestTotal - a.parent.bestTotal;
      });
      // Flatten into players array
      const players = [];
      for (const group of groups) {
        players.push(group.parent);
        players.push(...group.subs);
      }
      return {
        propertyId,
        propertyName: propertyMeta?.displayName || propertyId,
        sortAscending,
        players,
      };
    });
  });

  watch(chartMode, () => { hiddenLegendProperties.clear(); });

  // Persist chart toggle settings on change.
  watch(
    [normalizePerMinute, showVsAverage, showVsOthers, hideUnnamed, hideBots, chartMode, xAxisMode, perName],
    () => {
      if (skipToggleSave) { skipToggleSave = false; return; }
      saveAppSetting('chart_toggles', JSON.stringify({
        normalizePerMinute: normalizePerMinute.value,
        showVsAverage: showVsAverage.value,
        showVsOthers: showVsOthers.value,
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
      const propertyLabel = propertyMeta?.displayName || propertyId;

      const builderOptions = {
        games: currentGames, propertyId, propertyIndex, propertyLabel,
        allPlayerIds, trackedIds, settingsMap: settings, greyColorMap,
        selectedPropertyCount: propertyIds.length,
        hideBots: hideBots.value, hideUnnamed: hideUnnamed.value,
        normalizePerMinute: normalizePerMinute.value,
        vsAverage: showVsAverage.value, vsOthers: showVsOthers.value,
        mainPlayerId: mainPlayerId.value,
        xAxisMode: effectiveXAxisMode.value,
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
          timestamp: game.timestamp, missionName: game.missionName,
          difficulty: game.difficulty, result: game.result, duration: game.durationSeconds,
        }))
      : [];

    return { datasets, bands, labels, gameMetadata, currentGames };
  }

  function buildChartConfig() {
    const { datasets, bands, labels, gameMetadata, currentGames } = buildChartData();
    const settings = playerSettingsMap.value;
    const propertyIds = selectedPropertyIds.value;
    const propertyMapValue = propertyMap.value;
    const isVsDeviation = showVsAverage.value || showVsOthers.value;
    const needsSecondAxis = propertyIds.length > 1 && !isVsDeviation;
    const isBarMode = chartMode.value === 'bar';

    const annotations = {};
    if (isVsDeviation) {
      annotations['avgLine'] = {
        type: 'line', yMin: 0, yMax: 0,
        borderColor: 'rgba(255, 235, 59, 0.6)', borderWidth: 2, borderDash: [6, 4],
        label: {
          display: true, content: showVsOthers.value ? "Others' average" : 'Average', position: 'start',
          backgroundColor: 'rgba(255, 235, 59, 0.15)', color: '#ffeb3b', font: { size: 10 },
        },
      };
    }

    const isVsAverage = isVsDeviation;
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
              ? new Date(value).toLocaleDateString('sv-SE', { month: '2-digit', day: '2-digit' })
              : Math.round(value),
            maxTicksLimit: 20,
          },
        };

    const chartType = isBarMode ? 'bar' : 'scatter';

    return {
      type: chartType,
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
              isBarMode, gameMetadata, isVsDeviation,
              currentGames, normalizePerMinute.value, showVsOthers.value, mainPlayerId.value,
            ),
          },
          annotation: { annotations },
          gameBackgrounds: { bands },
        },
        scales: { x: xAxisConfig, ...yAxisConfig },
      },
    };
  }

  function renderChart() {
    const canvas = chartCanvas.value;
    if (!canvas) return;

    const config = buildChartConfig();

    if (chartInstance && lastChartType === config.type) {
      chartInstance.data = config.data;
      chartInstance.options = config.options;
      chartInstance.update();
    } else {
      if (chartInstance) chartInstance.destroy();
      lastChartType = config.type;
      chartInstance = new Chart(canvas.getContext('2d'), config);
    }
  }

  watch(
    [loadGeneration, normalizePerMinute, showVsAverage, showVsOthers, hideUnnamed, hideBots, chartMode, xAxisMode, perName, trackedPlayers],
    () => {
      if (loading.value) return;
      nextTick(renderChart);
    },
    { deep: true }
  );

  onUnmounted(() => {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    lastChartType = null;
  });

  function deviationClass(deviation, sortAscending) {
    return (sortAscending ? deviation >= 0 : deviation <= 0) ? 'positive' : 'negative';
  }

  return {
    chartCanvas, normalizePerMinute, showVsAverage, showVsOthers, hasMainPlayer,
    hideUnnamed, hideBots,
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
        if (filters.rangeMode.value === 'custom') initFlatpickr();
      } catch (e) {
        console.error('DB init failed:', e);
        filters.errorMessage.value = 'Failed to initialize database: ' + e.message;
      }
    });

    onUnmounted(() => {
      window.removeEventListener('keydown', onEscape);
      destroyFlatpickr();
    });

    // ── Flatpickr for custom date range ──
    const dateRangeInput = ref(null);
    const flatpickrInstance = shallowRef(null);

    function destroyFlatpickr() {
      if (flatpickrInstance.value) {
        flatpickrInstance.value.destroy();
        flatpickrInstance.value = null;
      }
    }

    function initFlatpickr() {
      destroyFlatpickr();
      nextTick(() => {
        const el = dateRangeInput.value;
        if (!el || typeof flatpickr === 'undefined') return;
        const defaultDates = [];
        if (filters.customStartDate.value) defaultDates.push(filters.customStartDate.value);
        if (filters.customEndDate.value) defaultDates.push(filters.customEndDate.value);
        flatpickrInstance.value = flatpickr(el, {
          mode: 'range',
          dateFormat: 'Y-m-d',
          defaultDate: defaultDates.length > 0 ? defaultDates : undefined,
          theme: 'dark',
          onChange(selectedDates) {
            if (selectedDates.length === 2) {
              const fmt = (d) => d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
              filters.customStartDate.value = fmt(selectedDates[0]);
              filters.customEndDate.value = fmt(selectedDates[1]);
            }
          },
        });
      });
    }

    watch(filters.rangeMode, (mode) => {
      if (mode === 'custom') {
        initFlatpickr();
      } else {
        destroyFlatpickr();
      }
    });

    const isWindows = navigator.userAgent.indexOf('Win') !== -1;
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
      // ── Filters ──
      propertyGroups: filters.propertyGroups,
      availableMissions: filters.availableMissions,
      availableDifficulties: filters.availableDifficulties,
      availableModifiers: filters.availableModifiers,
      difficultyNames: filters.difficultyNames,
      selectedPropertyIds: filters.selectedPropertyIds,
      rangeMode: filters.rangeMode,
      customStartDate: filters.customStartDate,
      customEndDate: filters.customEndDate,
      dateRangeInput,
      lastNGames: filters.lastNGames,
      resultFilter: filters.resultFilter,
      selectedDifficulties: filters.selectedDifficulties,
      selectedMissions: filters.selectedMissions,
      selectedModifiers: filters.selectedModifiers,
      games: filters.games,
      loading: filters.loading,
      loadGeneration: filters.loadGeneration,
      errorMessage: filters.errorMessage,
      gameCountDisplay: filters.gameCountDisplay,
      propertyMap: filters.propertyMap,
      selectedPropertyNames: filters.selectedPropertyNames,
      difficultyLabel: filters.difficultyLabel,
      missionLabel: filters.missionLabel,
      modifierLabel: filters.modifierLabel,
      propertyDepth: filters.propertyDepth,
      propertyLevelColor: filters.propertyLevelColor,
      removeProperty: filters.removeProperty,
      loadInitialData: filters.loadInitialData,
      loadGames: filters.loadGames,

      // ── Player management ──
      allPlayers: playerMgmt.allPlayers,
      showPlayerDialog: playerMgmt.showPlayerDialog,
      playerEdits: playerMgmt.playerEdits,
      minGamesFilter: playerMgmt.minGamesFilter,
      trackedPlayers: playerMgmt.trackedPlayers,
      humanPlayers: playerMgmt.humanPlayers,
      playerSettingsMap: playerMgmt.playerSettingsMap,
      loadPlayers: playerMgmt.loadPlayers,
      initPlayerEdits: playerMgmt.initPlayerEdits,
      restorePlayerSettings: playerMgmt.restorePlayerSettings,
      updatePlayerEdit: playerMgmt.updatePlayerEdit,
      savePlayerSettings: playerMgmt.savePlayerSettings,
      clearPlayerSettings: playerMgmt.clearPlayerSettings,
      setMainPlayer: playerMgmt.setMainPlayer,

      // ── Chart ──
      chartCanvas: chart.chartCanvas,
      normalizePerMinute: chart.normalizePerMinute,
      showVsAverage: chart.showVsAverage,
      showVsOthers: chart.showVsOthers,
      hasMainPlayer: chart.hasMainPlayer,
      hideUnnamed: chart.hideUnnamed,
      hideBots: chart.hideBots,
      chartMode: chart.chartMode,
      xAxisMode: chart.xAxisMode,
      effectiveXAxisMode: chart.effectiveXAxisMode,
      perName: chart.perName,
      hiddenLegendProperties: chart.hiddenLegendProperties,
      showWinRate: chart.showWinRate,
      showStreaks: chart.showStreaks,
      generalStatsData: chart.generalStatsData,
      relativeStatsData: chart.relativeStatsData,
      statsData: chart.statsData,
      renderChart: chart.renderChart,
      restoreChartSettings: chart.restoreChartSettings,
      deviationClass: chart.deviationClass,

      // ── Ingestion (wrapped with callbacks) ──
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

      // ── Dropdown ──
      openDropdown,
      toggleDropdown,

      // ── Utilities ──
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
