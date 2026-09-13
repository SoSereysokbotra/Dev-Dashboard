'use strict';

const scanner = require('./scanner');

function buildPanelPayload() {
  const allRepos = scanner.getCachedResults();
  const attentionCount = allRepos.filter(r => r.needsAttention).length;
  const cleanCount = allRepos.filter(r => !r.needsAttention).length;

  const displayLimit = 20;
  const topRepos = allRepos.slice(0, displayLimit).map(r => ({
    name: r.name,
    path: r.path,
    branch: r.branch,
    changed: r.changed,
    unpushed: r.unpushed,
    behind: r.behind,
    lastCommit: r.lastCommit,
    needsAttention: r.needsAttention,
  }));

  const remainingCount = Math.max(0, allRepos.length - displayLimit);

  return {
    title: 'Repositories',
    repos: topRepos,
    totalCount: allRepos.length,
    attentionCount: attentionCount,
    cleanCount: cleanCount,
    remainingCount: remainingCount,
    statusText: attentionCount > 0
      ? `${attentionCount} need attention \u00b7 ${allRepos.length} total`
      : `All clean \u00b7 ${allRepos.length} repositories`,
  };
}

module.exports = {
  buildPanelPayload,
};
