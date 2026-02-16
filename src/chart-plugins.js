/**
 * chart-plugins.js — Chart.js custom plugins.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const verticalLinePlugin = {
  id: 'verticalCrosshair',
  afterDraw(chart) {
    if (!chart.tooltip?._active?.length) return;
    const activeElement = chart.tooltip._active[0];
    const xPosition = chart.config.type === 'bar'
      ? chart.scales.x.getPixelForValue(activeElement.index)
      : activeElement.element.x;
    const yAxis = chart.scales.y;
    const context = chart.ctx;
    context.save();
    context.beginPath();
    context.moveTo(xPosition, yAxis.top);
    context.lineTo(xPosition, yAxis.bottom);
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    context.setLineDash([4, 4]);
    context.stroke();
    context.restore();
  },
};

const gameBackgroundPlugin = {
  id: 'gameBackgrounds',
  beforeDatasetsDraw(chart) {
    const options = chart.options.plugins.gameBackgrounds;
    if (!options?.bands?.length) return;
    const { ctx } = chart;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;
    ctx.save();
    for (const band of options.bands) {
      const pixelMin = xAxis.getPixelForValue(band.xMin);
      const pixelMax = xAxis.getPixelForValue(band.xMax);
      ctx.fillStyle = band.result === 'won' ? 'rgba(0,66,3,0.2)' : 'rgba(73,0,0,0.2)';
      ctx.fillRect(pixelMin, yAxis.top, pixelMax - pixelMin, yAxis.bottom - yAxis.top);
    }
    ctx.restore();
  },
};

/** Register custom Chart.js plugins (crosshair line and win/loss backgrounds). */
function registerPlugins() {
  Chart.register(verticalLinePlugin, gameBackgroundPlugin);
}

// Exports
App.registerPlugins = registerPlugins;
})();
