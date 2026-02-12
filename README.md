# Darktide Scoreboard Tracker

Track and visualize your Warhammer 40,000: Darktide performance across missions with interactive charts and detailed statistics.

![Screenshot](screenshot.png)

## Quick-start

Just visit http://darktide.szydlo.eu

## What It Does

Import your scoreboard data and get rich analytics on player performance.

## Getting Started

### Requirements

- A modern browser (Chrome, Edge, or Opera recommended for best experience)
- The [Scoreboard](https://www.nexusmods.com/warhammer40kdarktide/mods/22) Darktide mod installed and generating `.lua` scoreboard files

### Usage

1. **Open** `index.html` in your browser
2. **Click** "Choose Scoreboard Directory" and point it at your scoreboard folder
   - Typically located at `%APPDATA%/Fatshark/Darktide/scoreboard_history`
3. **Wait** for ingestion to finish - all data is parsed and stored locally in your browser
4. **Explore** - select properties, adjust filters, compare players

### Re-importing

Click "Re-scan Files" to pick up new scoreboard files. Only new files are processed; duplicates are skipped.

Click "Reset DB" to wipe all data and start fresh.

## Statistics

Statistics are shown below the filters when at least one player is tracked. They are organized into three card types:

### General

Always visible. Shows per-player summary stats:

| Stat | Description | Visibility |
|---|---|---|
| Time | Total playtime across filtered games | Always |
| Games | Number of games played | Always |
| Win rate | Percentage of games won | Hidden when the Result filter is set to "Won" or "Lost" only |
| Streaks | Longest winning and losing streaks | Only when the Result filter is set to "All" |

When the **Per name** toggle is on, each player's stats are broken down into sub-rows by in-game character name.

### Relative

Visible when two or more players are tracked. Compares the main player (or the player with the most games if none is set) against each other tracked player:

| Stat | Description | Visibility |
|---|---|---|
| Together | Number of games both players appeared in | Always |
| W-rate (together) | Win rate in games played together | Hidden when the Result filter is set to "Won" or "Lost" only |
| Apart | Number of games the main player played without the other | Always |
| W-rate (apart) | Win rate in games played apart | Hidden when the Result filter is set to "Won" or "Lost" only |

### Per-Property

One card per selected property (e.g. Damage Dealt, Kills). Shows per-player stats for that property:

| Stat | Description |
|---|---|
| Avg | Average value across all filtered games |
| Top in | Percentage of games where the player had the best score for that property |
| Avg dev | Average deviation from the team mean, shown as a percentage (positive = above average, negative = below). In **vs Others** mode, only shown for the main player. |

## Technical Details

- Runs entirely in the browser - no server, no accounts, no data leaves your machine
- All dependencies have a local fallback - can work offline
- Data persisted in IndexedDB across sessions
- Built with Vue.js, Chart.js, and sql.js (in-browser SQLite)
- Responsive layout for smaller screens
- Firefox/Safari supported via file input fallback (no directory picker API)

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md)
