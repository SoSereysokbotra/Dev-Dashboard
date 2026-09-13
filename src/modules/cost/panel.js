'use strict';

const scanner = require('./scanner');

function formatCurrency(amount) {
  if (amount == null || !Number.isFinite(amount)) return '$0.00';
  return '$' + amount.toFixed(2);
}

function buildPanelPayload() {
  const data = scanner.scanTranscripts();
  if (!data.available) {
    return {
      available: false,
      title: 'Cost / Project',
      statusText: 'No Claude Code data found',
      error: 'Directory ~/.claude/projects does not exist',
      projects: [],
    };
  }

  const grandTotal = data.grandTotalWeekCost;
  const allProjects = data.projects || [];

  const TOP_LIMIT = 10;
  const topSlice = allProjects.slice(0, TOP_LIMIT);
  const otherSlice = allProjects.slice(TOP_LIMIT);

  let top10CostSum = 0;
  const formattedTopProjects = topSlice.map(p => {
    top10CostSum += p.weekCost;
    const pct = grandTotal > 0 ? (p.weekCost / grandTotal) * 100 : 0;
    return {
      name: p.displayName,
      path: p.rawPath,
      weekCost: p.weekCost,
      weekCostFormatted: formatCurrency(p.weekCost),
      todayCost: p.todayCost,
      todayCostFormatted: formatCurrency(p.todayCost),
      percent: Math.round(pct * 10) / 10,
      percentFormatted: pct.toFixed(1) + '%',
      messages: p.messages,
    };
  });

  const otherCost = otherSlice.reduce((sum, p) => sum + p.weekCost, 0);
  const otherPct = grandTotal > 0 ? (otherCost / grandTotal) * 100 : 0;

  const otherData = otherSlice.length > 0 ? {
    name: `Other (${otherSlice.length} projects)`,
    weekCost: otherCost,
    weekCostFormatted: formatCurrency(otherCost),
    percent: Math.round(otherPct * 10) / 10,
    percentFormatted: otherPct.toFixed(1) + '%',
    count: otherSlice.length,
  } : null;

  const dailyAvg = grandTotal / 7;

  return {
    available: true,
    title: 'Cost / Project',
    totalWeekCost: grandTotal,
    totalWeekCostFormatted: formatCurrency(grandTotal),
    totalTodayCost: data.grandTotalTodayCost,
    totalTodayCostFormatted: formatCurrency(data.grandTotalTodayCost),
    dailyAverage: dailyAvg,
    dailyAverageFormatted: formatCurrency(dailyAvg),
    topProjects: formattedTopProjects,
    other: otherData,
    totalProjectsCount: allProjects.length,
    statusText: `API-equivalent value: ${formatCurrency(grandTotal)} (7d)`,
    disclaimer: 'API-equivalent value based on published rates; not actual Anthropic billing.',
  };
}

module.exports = {
  buildPanelPayload,
  formatCurrency,
};
