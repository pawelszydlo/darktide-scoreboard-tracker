/**
 * constants.js — Shared constants and lookup tables.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const GROUP_COLORS = {
  'row_resource_score': '#4caf50',
  'row_team_score': '#2196f3',
  'row_defense_score': '#ff9800',
  'row_offense_score': '#e94560',
};

const GREY_SHADES = ['#666666', '#777777', '#888888', '#999999', '#555555', '#aaaaaa'];

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

const INGEST_BATCH_SIZE = 200;
const MAX_SELECTED_PROPERTIES = 5;
const LONG_GAME_THRESHOLD_SECONDS = 1200;
const FLOAT_EPSILON = 1e-9;

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

const PROPERTY_LEVEL_COLORS = ['#ffffff', '#a0a0b0', '#707078'];

// Exports
App.GROUP_COLORS = GROUP_COLORS;
App.GREY_SHADES = GREY_SHADES;
App.MISSION_NAMES = MISSION_NAMES;
App.DEFAULT_DIFFICULTY_NAMES = DEFAULT_DIFFICULTY_NAMES;
App.UUID_PATTERN = UUID_PATTERN;
App.COLOR_CODE_PATTERN = COLOR_CODE_PATTERN;
App.DEFAULT_GROUP_ID = DEFAULT_GROUP_ID;
App.DEFAULT_GROUP_NAME = DEFAULT_GROUP_NAME;
App.INGEST_BATCH_SIZE = INGEST_BATCH_SIZE;
App.MAX_SELECTED_PROPERTIES = MAX_SELECTED_PROPERTIES;
App.LONG_GAME_THRESHOLD_SECONDS = LONG_GAME_THRESHOLD_SECONDS;
App.FLOAT_EPSILON = FLOAT_EPSILON;
App.RANGE_DAYS = RANGE_DAYS;
App.PROPERTY_LEVEL_COLORS = PROPERTY_LEVEL_COLORS;
})();
