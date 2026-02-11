# Darktide Scoreboard Tracker

Track and visualize your Warhammer 40,000: Darktide performance across missions with interactive charts and detailed statistics.

![Screenshot](screenshot.png)

## Quick-start

Just visit http://darktide.szydlo.eu

## What It Does

Import your scoreboard data and get rich analytics on player performance:

- **Interactive Charts** - Line and bar charts with hover tooltips showing full game context (date, mission, difficulty, duration, team stats)
- **Multi-Player Tracking** - Compare up to 5 stats across multiple players simultaneously
- **Deep Filtering** - Filter by difficulty, mission, modifiers, win/loss, date range, or last N games
- **Per-Minute Normalization** - Normalize any stat by game duration for fair comparison
- **vs. Average Mode** - See how each player deviates from the team average as a percentage
- **vs. Others Mode** - Compare your main player's performance against the average of the other three players
- **Win/Loss Shading** - Visual background markers showing game outcomes on the timeline
- **General Statistics** - Game count, win rate, best-performer counts, and averages per player
- **Player Management** - Assign custom names, colors, and a main player for focused comparisons

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

## Key Controls

| Control | Description |
|---|---|
| Property dropdown | Select which stat(s) to chart (e.g. Damage Dealt, Kills) |
| Time range | All Time, Last 7/30/90/365 days, Custom dates, Last N games |
| Difficulty | Sedition through Auric |
| Mission / Modifiers | Filter to specific missions or game modifiers |
| Result | All, Won, Won+Long Lost, Lost |
| Bar chart toggle | Switch between line (time-series) and bar (per-game) view |
| vs Average toggle | Show deviation from team average instead of raw values |
| vs Others toggle | Show main player's deviation from the other players' average (requires a main player) |
| Per minute toggle | Normalize values by game duration |
| X: Time / Game # | Change horizontal axis mode |
| Hide unnamed | Hide players without custom names |
| Hide bots | Hide AI companions |

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
- All dependencies vendored locally - works offline with no CDN requests
- Data persisted in IndexedDB across sessions
- Built with Vue.js, Chart.js, and sql.js (in-browser SQLite)
- Responsive layout for smaller screens
- Firefox/Safari supported via file input fallback (no directory picker API)

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md)
