// ============================================================================
//  Stats: everything computed client-side from books + ratings + members
// ============================================================================

import { starsHtml } from "./ratings.js";

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map((x) => (x - m) ** 2)));
};
const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function renderStats(container, movies, ratings, members) {
  const watched = movies.filter((m) => m.status === "watched");
  const onWheel = movies.filter((m) => m.status === "wheel");
  const addedByOf = Object.fromEntries(movies.map((m) => [m.id, m.addedByMemberId]));

  // Optional Open Library aggregates (only meaningful once books carry them).
  const withRuntime = watched.filter((m) => typeof m.runtime === "number" && m.runtime > 0);
  const totalPages = withRuntime.reduce((s, m) => s + m.runtime, 0);
  const genreCounts = {};
  watched.forEach((m) => (m.genres || []).forEach((g) => (genreCounts[g] = (genreCounts[g] || 0) + 1)));
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const decadeCounts = {};
  watched.forEach((m) => {
    const y = parseInt(m.year, 10);
    if (!isNaN(y)) { const d = Math.floor(y / 10) * 10; decadeCounts[d] = (decadeCounts[d] || 0) + 1; }
  });
  const decades = Object.entries(decadeCounts).sort((a, b) => a[0] - b[0]);

  // group scores by member (given) and by film (received)
  const givenBy = {};
  const scoresFor = {};
  const receivedBy = {};
  ratings.forEach((r) => {
    (givenBy[r.memberId] ||= []).push(r.score);
    (scoresFor[r.movieId] ||= []).push(r.score);
    const owner = addedByOf[r.movieId];
    if (owner) (receivedBy[owner] ||= []).push(r.score);
  });

  const tiles = [
    { label: "Books read", value: watched.length },
    { label: "On the wheel", value: onWheel.length },
    { label: "Members", value: members.length },
    { label: "Ratings given", value: ratings.length },
  ];

  const raters = members
    .map((m) => ({ name: m.name || "Someone", scores: givenBy[m.id] || [] }))
    .filter((r) => r.scores.length > 0)
    .map((r) => ({ name: r.name, a: avg(r.scores), n: r.scores.length }));
  const generous = raters.length ? raters.reduce((a, b) => (b.a > a.a ? b : a)) : null;
  const harsh = raters.length ? raters.reduce((a, b) => (b.a < a.a ? b : a)) : null;

  const board = watched
    .map((m) => ({ title: m.title, scores: scoresFor[m.id] || [] }))
    .filter((m) => m.scores.length > 0)
    .map((m) => ({ title: m.title, a: avg(m.scores), n: m.scores.length, sd: stdev(m.scores) }))
    .sort((x, y) => y.a - x.a);

  const divisive = board.filter((m) => m.n >= 2).slice().sort((x, y) => y.sd - x.sd)[0] || null;

  const perPerson = members
    .map((m) => {
      const given = givenBy[m.id] || [];
      const received = receivedBy[m.id] || [];
      const added = movies.filter((mv) => mv.addedByMemberId === m.id).length;
      return {
        name: m.name || "Someone",
        added,
        given: given.length ? avg(given) : null,
        received: received.length ? avg(received) : null,
      };
    })
    .sort((a, b) => (b.given ?? -1) - (a.given ?? -1));

  let html = `<div class="stats-tiles">`;
  tiles.forEach((t) => {
    html += `<div class="tile"><div class="tile-value">${t.value}</div><div class="tile-label">${t.label}</div></div>`;
  });
  html += `</div>`;

  const sups = [];
  if (generous) sups.push(superlative("Most generous", esc(generous.name), `${fmt(generous.a)} avg`));
  if (harsh && raters.length > 1) sups.push(superlative("Harshest critic", esc(harsh.name), `${fmt(harsh.a)} avg`));
  if (board[0]) sups.push(superlative("Top rated book", esc(board[0].title), `${fmt(board[0].a)} ★`));
  if (board.length > 1) sups.push(superlative("Lowest rated", esc(board[board.length - 1].title), `${fmt(board[board.length - 1].a)} ★`));
  if (divisive) sups.push(superlative("Most divisive", esc(divisive.title), `±${fmt(divisive.sd)}`));
  if (sups.length) html += `<div class="superlatives">${sups.join("")}</div>`;

  if (board.length) {
    html += `<div class="card"><h3>Book leaderboard</h3><ol class="leaderboard">`;
    board.forEach((m) => {
      html += `<li><span class="lb-title">${esc(m.title)}</span> ${starsHtml(Math.round(m.a * 2) / 2)} <span class="lb-score">${fmt(m.a)} (${m.n})</span></li>`;
    });
    html += `</ol></div>`;
  }

  if (members.length) {
    html += `<div class="card"><h3>Per person</h3><table class="people-table">
      <thead><tr><th>Name</th><th>Added</th><th>Avg given</th><th>Avg received</th></tr></thead><tbody>`;
    perPerson.forEach((p) => {
      html += `<tr><td>${esc(p.name)}</td><td>${p.added}</td><td>${p.given == null ? "—" : fmt(p.given)}</td><td>${p.received == null ? "—" : fmt(p.received)}</td></tr>`;
    });
    html += `</tbody></table><p class="muted small">"Avg received" = average score on books that person added.</p></div>`;
  }

  // Taste compatibility: average half-star gap between each pair of members on
  // the films they BOTH rated (needs ≥2 shared films to count).
  const byMember = {};
  ratings.forEach((r) => { (byMember[r.memberId] ||= {})[r.movieId] = r.score; });
  const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name || "Someone"]));
  const mids = members.map((m) => m.id);
  const pairs = [];
  for (let i = 0; i < mids.length; i++) {
    for (let j = i + 1; j < mids.length; j++) {
      const a = byMember[mids[i]] || {}, b = byMember[mids[j]] || {};
      const common = Object.keys(a).filter((mv) => mv in b);
      if (common.length < 2) continue;
      pairs.push({
        a: nameOf[mids[i]], b: nameOf[mids[j]], n: common.length,
        gap: avg(common.map((mv) => Math.abs(a[mv] - b[mv]))),
      });
    }
  }
  if (pairs.length) {
    const closest = pairs.reduce((x, y) => (y.gap < x.gap ? y : x));
    const farthest = pairs.reduce((x, y) => (y.gap > x.gap ? y : x));
    html += `<div class="card"><h3>Taste matches</h3>`;
    html += `<p class="meta-line"><b>Most in sync:</b> ${esc(closest.a)} &amp; ${esc(closest.b)} <span class="muted">(${fmt(closest.gap)}★ apart over ${closest.n})</span></p>`;
    if (pairs.length > 1 && farthest !== closest) {
      html += `<p class="meta-line"><b>Biggest clash:</b> ${esc(farthest.a)} &amp; ${esc(farthest.b)} <span class="muted">(${fmt(farthest.gap)}★ apart over ${farthest.n})</span></p>`;
    }
    html += `</div>`;
  }

  if (totalPages > 0 || topGenres.length || decades.length) {
    html += `<div class="card"><h3>Reading habits</h3>`;
    if (totalPages > 0) {
      html += `<p class="meta-line"><b>${totalPages.toLocaleString()} pages</b> read`;
      if (withRuntime.length) html += ` &middot; averaging <b>${Math.round(totalPages / withRuntime.length)} pages</b>`;
      html += `</p>`;
    }
    if (topGenres.length) {
      html += `<p class="meta-line"><span class="muted small">Top genres</span><br>${topGenres
        .map(([g, n]) => `${esc(g)} <span class="muted">(${n})</span>`)
        .join("  &middot;  ")}</p>`;
    }
    if (decades.length) {
      html += `<p class="meta-line"><span class="muted small">By decade</span><br>${decades
        .map(([d, n]) => `${d}s <span class="muted">(${n})</span>`)
        .join("  &middot;  ")}</p>`;
    }
    html += `</div>`;
  }

  // Recent activity, newest first, from films added/finished and ratings given.
  const titleOf = Object.fromEntries(movies.map((m) => [m.id, m.title]));
  const events = [];
  movies.forEach((m) => {
    if (m.addedAt) events.push({ t: tms(m.addedAt), text: `${esc(m.addedByName || "Someone")} added <b>${esc(m.title)}</b>` });
    if (m.status === "watched" && m.watchedAt) events.push({ t: tms(m.watchedAt), text: `<b>${esc(m.title)}</b> finished — reviews revealed` });
  });
  ratings.forEach((r) => {
    events.push({ t: tms(r.updatedAt), text: `${esc(r.name || "Someone")} rated <b>${esc(titleOf[r.movieId] || "a book")}</b> ${fmt(r.score)}★` });
  });
  const recent = events.filter((e) => e.t > 0).sort((a, b) => b.t - a.t).slice(0, 8);
  if (recent.length) {
    html += `<div class="card"><h3>Recent activity</h3><ul class="activity">`;
    recent.forEach((e) => { html += `<li>${e.text} <span class="muted small">${ago(e.t)}</span></li>`; });
    html += `</ul></div>`;
  }

  if (!watched.length && !ratings.length) {
    html += `<p class="muted center">No data yet. Spin the wheel, read a book, and rate it to see the numbers appear here.</p>`;
  }

  container.innerHTML = html;
}

// Firestore Timestamp / {seconds} -> ms (0 if not yet acked by the server).
function tms(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  return ts.seconds != null ? ts.seconds * 1000 : 0;
}
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ms).toLocaleDateString();
}

function superlative(label, who, detail) {
  return `<div class="superlative"><div class="sup-label">${label}</div><div class="sup-who">${who}</div><div class="sup-detail">${detail}</div></div>`;
}
