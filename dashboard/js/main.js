(function () {
  'use strict';

  // ── Star field (identical to f919) ──────────────────────────────────────
  (function initStars() {
    const container = document.querySelector('.stars');
    const count = 160;
    for (let i = 0; i < count; i++) {
      const star    = document.createElement('div');
      star.className = 'star';
      const size    = Math.random() < 0.7 ? 1 : Math.random() < 0.8 ? 1.5 : 2;
      const opacity = 0.2 + Math.random() * 0.6;
      const dur     = 2 + Math.random() * 4;
      const delay   = Math.random() * 6;
      star.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        `left:${(Math.random() * 100).toFixed(2)}%`,
        `top:${(Math.random() * 100).toFixed(2)}%`,
        `--o:${opacity.toFixed(2)}`,
        `--d:${dur.toFixed(2)}s`,
        `--delay:${delay.toFixed(2)}s`,
      ].join(';');
      container.appendChild(star);
    }
  })();

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    guildId:    null,
    lbPage:     1,
    lbTotal:    0,
    lbTotalPgs: 1,
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const guildSelect    = $('guildSelect');
  const summaryCards   = $('summaryCards');
  const lbList         = $('lbList');
  const lbMeta         = $('lbMeta');
  const lbPagination   = $('lbPagination');
  const memberHeader   = $('memberHeader');
  const memberStats    = $('memberStats');
  const achList        = $('achList');
  const achMeta        = $('achMeta');
  const historyList    = $('historyList');
  const backBtn        = $('backBtn');
  const viewLeaderboard = $('view-leaderboard');
  const viewMember      = $('view-member');

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  function fmt(n) { return Number(n).toLocaleString(); }

  function fmtVoice(minutes) {
    const m = Math.round(Number(minutes));
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h === 0) return `${min}m`;
    if (min === 0) return `${h}h`;
    return `${h}h ${min}m`;
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30)  return `${d}d ago`;
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
  }

  function fmtDate(dateStr) {
    return new Date(dateStr).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function showView(which) {
    viewLeaderboard.classList.toggle('hidden', which !== 'leaderboard');
    viewMember.classList.toggle('hidden', which !== 'member');
  }

  function makeEl(tag, className, html) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function rankClass(rank) {
    if (rank === 1) return 'lb-row__rank--gold';
    if (rank === 2) return 'lb-row__rank--silver';
    if (rank === 3) return 'lb-row__rank--bronze';
    return '';
  }

  // ── Guild selector ───────────────────────────────────────────────────────
  async function loadGuilds() {
    try {
      const guilds = await api('/api/guilds');
      guildSelect.innerHTML = '';
      if (guilds.length === 0) {
        guildSelect.innerHTML = '<option value="">No servers</option>';
        return;
      }
      guilds.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        guildSelect.appendChild(opt);
      });
      state.guildId = guilds[0].id;
      guildSelect.value = state.guildId;
    } catch (err) {
      guildSelect.innerHTML = `<option value="">Error: ${err.message}</option>`;
    }
  }

  guildSelect.addEventListener('change', () => {
    state.guildId = guildSelect.value;
    state.lbPage  = 1;
    route();
  });

  // ── Summary cards ────────────────────────────────────────────────────────
  async function renderSummary() {
    if (!state.guildId) return;
    try {
      const s = await api(`/api/stats?guildId=${state.guildId}`);
      summaryCards.innerHTML = '';
      const cards = [
        { value: fmt(s.total_members),                       label: 'Members Tracked' },
        { value: fmt(s.total_messages),                      label: 'Total Messages' },
        { value: fmtVoice(s.total_voice_minutes),            label: 'Voice Time' },
        { value: fmt(s.top_streak) + 'd',                    label: 'Top Active Streak' },
      ];
      cards.forEach(c => {
        const card = makeEl('div', 'summary-card');
        card.innerHTML = `
          <div class="summary-card__value">${c.value}</div>
          <div class="summary-card__label">${c.label}</div>
        `;
        summaryCards.appendChild(card);
      });
    } catch {
      summaryCards.innerHTML = '<div class="summary-card"><div class="summary-card__label">Stats unavailable</div></div>';
    }
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────
  async function renderLeaderboard(page = 1) {
    if (!state.guildId) {
      lbList.innerHTML = '<p class="lb-empty">Select a server above to view the leaderboard.</p>';
      return;
    }

    lbList.innerHTML = '';
    lbPagination.innerHTML = '';
    lbMeta.textContent = '';

    // Skeleton rows
    for (let i = 0; i < 5; i++) {
      const row = makeEl('div', 'lb-row summary-card--skeleton');
      row.style.height = '58px';
      lbList.appendChild(row);
    }

    try {
      const data = await api(`/api/leaderboard?guildId=${state.guildId}&page=${page}`);
      state.lbPage     = data.page;
      state.lbTotal    = data.total;
      state.lbTotalPgs = data.totalPages;

      lbMeta.textContent = `${fmt(data.total)} members`;
      lbList.innerHTML = '';

      if (data.rows.length === 0) {
        lbList.innerHTML = '<p class="lb-empty">No activity recorded yet.</p>';
        return;
      }

      const offset = (page - 1) * 25;

      data.rows.forEach((row, i) => {
        const rank    = offset + i + 1;
        const rankCls = rankClass(rank);
        const rankTxt = rank <= 3 ? ['🥇','🥈','🥉'][rank - 1] : `#${rank}`;

        const el = document.createElement('a');
        el.className = 'lb-row';
        el.href = `#member/${row.user_id}`;
        el.setAttribute('role', 'row');
        el.innerHTML = `
          <div class="lb-row__rank ${rankCls}">${rankTxt}</div>
          <div class="lb-row__avatar"><img src="${row.avatar}" alt="" loading="lazy" /></div>
          <div class="lb-row__info">
            <div class="lb-row__name">
              ${escHtml(row.displayName)}
              ${row.is_inactive ? '<span class="badge badge--inactive">Inactive</span>' : ''}
            </div>
            <div class="lb-row__meta">
              ${fmt(row.message_count)} msgs · ${fmtVoice(row.voice_minutes)} voice · ${row.streak_days}d streak · ${fmt(row.achievement_count)} achievements
            </div>
          </div>
          <div class="lb-row__score">
            <div class="lb-row__score-value">${fmt(Math.round(row.score))}</div>
            <div class="lb-row__score-label">pts</div>
          </div>
        `;
        lbList.appendChild(el);
      });

      renderPagination(page, data.totalPages);
    } catch (err) {
      lbList.innerHTML = `<p class="lb-error">Failed to load leaderboard: ${escHtml(err.message)}</p>`;
    }
  }

  function renderPagination(page, totalPages) {
    lbPagination.innerHTML = '';
    if (totalPages <= 1) return;

    const mkBtn = (label, pg, active, disabled) => {
      const btn = makeEl('button', `page-btn${active ? ' page-btn--active' : ''}`);
      btn.textContent = label;
      btn.disabled = disabled;
      if (!disabled) btn.addEventListener('click', () => {
        state.lbPage = pg;
        renderLeaderboard(pg);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      return btn;
    };

    lbPagination.appendChild(mkBtn('← Prev', page - 1, false, page <= 1));

    const start = Math.max(1, page - 2);
    const end   = Math.min(totalPages, start + 4);
    for (let p = start; p <= end; p++) {
      lbPagination.appendChild(mkBtn(String(p), p, p === page, false));
    }

    lbPagination.appendChild(mkBtn('Next →', page + 1, false, page >= totalPages));
  }

  // ── Member profile ───────────────────────────────────────────────────────
  async function renderMember(userId) {
    showView('member');
    memberHeader.innerHTML  = '';
    memberStats.innerHTML   = '';
    achList.innerHTML       = '';
    historyList.innerHTML   = '';
    achMeta.textContent     = '';

    // Skeleton header
    memberHeader.innerHTML = `
      <div class="member-header summary-card--skeleton" style="min-height:120px"></div>
    `;

    try {
      const data = await api(`/api/member?guildId=${state.guildId}&userId=${userId}`);
      const { activity, rank, achievements, history, member } = data;

      // Header
      memberHeader.innerHTML = `
        <div class="member-header">
          <div class="member-header__avatar">
            <img src="${member.avatar}" alt="" />
          </div>
          <div class="member-header__info">
            <div class="member-header__name">${escHtml(member.displayName)}</div>
            <div class="member-header__username">@${escHtml(member.username)}</div>
            <div class="member-header__rank">RANK #${rank}</div>
            <div class="member-header__score">${fmt(Math.round(activity.score))} PTS</div>
          </div>
        </div>
      `;

      // Stats grid
      const stats = [
        { value: fmt(activity.message_count), label: 'Messages' },
        { value: fmtVoice(activity.voice_minutes), label: 'Voice Time' },
        { value: activity.streak_days + 'd', label: 'Current Streak' },
        { value: String(achievements.filter(a => a.earned_at).length), label: 'Achievements' },
      ];
      memberStats.innerHTML = '';
      stats.forEach(s => {
        const card = makeEl('div', 'summary-card');
        card.innerHTML = `
          <div class="summary-card__value">${s.value}</div>
          <div class="summary-card__label">${s.label}</div>
        `;
        memberStats.appendChild(card);
      });

      // Achievements
      const earnedCount = achievements.filter(a => a.earned_at).length;
      achMeta.textContent = `${earnedCount} of ${achievements.length} earned`;
      achList.innerHTML   = '';
      achievements.forEach(a => {
        const earned = !!a.earned_at;
        const row = makeEl('div', `ach-row${earned ? ' ach-row--earned' : ''}`);
        row.innerHTML = `
          <span class="ach-row__check">${earned ? '✅' : '⬜'}</span>
          <span class="ach-row__emoji">${a.emoji}</span>
          <div class="ach-row__body">
            <div class="ach-row__name">${escHtml(a.name)}</div>
            <div class="ach-row__desc">${escHtml(a.description)}</div>
          </div>
          ${earned ? `<span class="ach-row__when">${timeAgo(a.earned_at)}</span>` : ''}
        `;
        achList.appendChild(row);
      });

      // Role history
      historyList.innerHTML = '';
      if (history.length === 0) {
        historyList.innerHTML = '<p class="history-empty">No role changes recorded.</p>';
      } else {
        history.forEach(h => {
          const row = makeEl('div', 'history-row');
          const removed = (h.roles_removed ?? []).map(id =>
            `<span class="role-tag role-tag--removed">${id}</span>`
          ).join('');
          const added = (h.roles_added ?? []).map(id =>
            `<span class="role-tag role-tag--added">${id}</span>`
          ).join('');
          row.innerHTML = `
            <div class="history-row__header">
              <span class="history-row__type">${escHtml(h.change_type.replace(/_/g, ' ').toUpperCase())}</span>
              <span class="history-row__date">${fmtDate(h.changed_at)}</span>
            </div>
            ${h.reason ? `<div class="history-row__reason">${escHtml(h.reason)}</div>` : ''}
            ${removed || added ? `<div class="history-row__roles">${removed}${added}</div>` : ''}
          `;
          historyList.appendChild(row);
        });
      }
    } catch (err) {
      memberHeader.innerHTML = `<p class="lb-error">Failed to load member: ${escHtml(err.message)}</p>`;
    }
  }

  // ── XSS safety ───────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Router ───────────────────────────────────────────────────────────────
  function route() {
    const hash = window.location.hash.slice(1) || 'leaderboard';
    if (hash.startsWith('member/') && state.guildId) {
      renderMember(hash.split('/')[1]);
    } else {
      showView('leaderboard');
      renderSummary();
      renderLeaderboard(state.lbPage);
    }
  }

  backBtn.addEventListener('click', () => {
    window.location.hash = 'leaderboard';
  });

  window.addEventListener('hashchange', route);

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    await loadGuilds();
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
