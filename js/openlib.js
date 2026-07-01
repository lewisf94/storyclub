// ============================================================================
//  Open Library — book metadata when adding to the wheel
// ----------------------------------------------------------------------------
//  StoryClub enriches the books you add using Open Library (openlibrary.org),
//  a free, keyless, CORS-enabled API run by the Internet Archive. The "Add a
//  book" box gains title/author autocomplete with covers; picking a result
//  stores the author, first-published year, page count and subjects (used by
//  the cards and stats). No API key, no sign-up — it just works.
//
//  This module keeps the export names the rest of the app already used for film
//  metadata (searchTitles, getDetails, posterUrl, getMovieDetail,
//  getRecommendations) so swapping the data source touched as little as
//  possible. Under the hood it's all books now.
//
//  Attribution (shown in the UI): book data and covers from Open Library.
// ============================================================================

// Book metadata is always on — there's no key to set, so unlike the old film
// build there's nothing to disable. Kept as `tmdbEnabled` so existing call
// sites that gate the metadata UI on it keep working.
export const tmdbEnabled = true;

export const TMDB_STATEMENT =
  "Book data and cover images from Open Library, a project of the Internet Archive.";

const SEARCH = "https://openlibrary.org/search.json";
const COVERS = "https://covers.openlibrary.org/b/id/";

// Map the old TMDB-ish size hints ("w45".."w185") onto Open Library's S/M/L
// cover sizes, so existing call sites can pass their size strings unchanged.
function coverSize(hint) {
  const n = parseInt(String(hint).replace(/[^0-9]/g, ""), 10) || 154;
  if (n <= 92) return "S";
  if (n >= 185) return "L";
  return "M";
}

// Build a cover URL from an Open Library cover id (a number), or "" if none.
export function posterUrl(coverId, size = "M") {
  return coverId ? `${COVERS}${coverId}-${coverSize(size)}.jpg` : "";
}

function yearStr(y) {
  return y ? String(y) : "";
}

// Open Library subjects are plentiful but noisy (admin tags, long phrases). Trim
// them to a few short, human ones to use as genre-style tags.
function cleanSubjects(subjects, limit = 5) {
  if (!Array.isArray(subjects)) return [];
  const seen = new Set();
  const out = [];
  for (let s of subjects) {
    s = String(s || "").trim();
    if (!s || s.length > 28 || /[:(\/]/.test(s)) continue;
    if (/accessible book|protected daisy|in library|overdrive|internet archive|large type|reading level|lending library|popular print disabled/i.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// Normalise an Open Library search doc into the light shape the app stores.
function bookFromDoc(d) {
  return {
    tmdbId: d.key || "",                 // Open Library work key, e.g. "/works/OL45804W"
    title: d.title || "",
    author: Array.isArray(d.author_name) ? d.author_name.slice(0, 2).join(", ") : "",
    year: yearStr(d.first_publish_year),
    posterPath: d.cover_i || "",         // Open Library cover id (number)
    runtime: typeof d.number_of_pages_median === "number" ? d.number_of_pages_median : null, // pages
    genres: cleanSubjects(d.subject),
  };
}

// Autocomplete search — cheap, called per keystroke (debounced by the caller).
// Returns up to `limit` light book results; never throws (errors -> []).
export async function searchTitles(q, limit = 6) {
  if (!q || q.trim().length < 2) return [];
  try {
    const fields = "key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median";
    const url = `${SEARCH}?q=${encodeURIComponent(q.trim())}` +
      `&fields=${encodeURIComponent(fields)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.docs || []).slice(0, limit).map(bookFromDoc);
  } catch (_) {
    return [];
  }
}

// No extra fetch needed on selection: a search hit already carries everything we
// store (title, author, year, cover, pages, subjects). Returning null means the
// caller keeps the rich hit it already has. Kept for call-site compatibility.
export async function getDetails() {
  return null;
}

function descriptionText(desc) {
  if (!desc) return "";
  const raw = typeof desc === "string" ? desc : desc.value || "";
  return raw.replace(/\r?\n{2,}/g, "\n").trim();
}

// Resolve up to a few author display names from a work's author keys.
async function resolveAuthors(work) {
  try {
    const keys = (work.authors || [])
      .map((a) => a && a.author && a.author.key)
      .filter(Boolean)
      .slice(0, 3);
    const names = await Promise.all(
      keys.map(async (k) => {
        try {
          const r = await fetch(`https://openlibrary.org${k}.json`);
          return r.ok ? (await r.json()).name || null : null;
        } catch (_) {
          return null;
        }
      })
    );
    return names.filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Everything for the "more about this book" popup: description, authors,
// subjects, Open Library rating — fetched on demand (not stored). The film build
// returned `directors`/`cast`/`trailerKey`; we reuse the `directors` slot for
// authors and leave the film-only fields empty. Returns null on any error.
export async function getMovieDetail(workKey) {
  if (!workKey) return null;
  try {
    const res = await fetch(`https://openlibrary.org${workKey}.json`);
    if (!res.ok) return null;
    const d = await res.json();
    const coverId = Array.isArray(d.covers) ? d.covers.find((c) => c > 0) || "" : "";
    const [authors, voteAverage] = await Promise.all([
      resolveAuthors(d),
      workRating(workKey),
    ]);
    return {
      tmdbId: workKey,
      title: d.title || "",
      year: "",                          // not on the work doc; the card shows it from storage
      runtime: null,
      genres: cleanSubjects(d.subjects, 6),
      posterPath: coverId,
      overview: descriptionText(d.description),
      tagline: d.subtitle || "",
      voteAverage,                       // Open Library average, out of 5
      directors: authors,                // reused slot — these are the authors
      cast: [],
      trailerKey: "",
      olKey: workKey,                    // for a "View on Open Library" link
    };
  } catch (_) {
    return null;
  }
}

// Open Library community rating (out of 5), or null.
async function workRating(workKey) {
  try {
    const r = await fetch(`https://openlibrary.org${workKey}/ratings.json`);
    if (!r.ok) return null;
    const a = (await r.json())?.summary?.average;
    return typeof a === "number" && a > 0 ? a : null;
  } catch (_) {
    return null;
  }
}

// "More like this" — other books that share a subject with this one. Open
// Library has no recommendations endpoint, so we read the work's subjects and
// pull popular titles from the first usable subject. Returns light results
// (same shape as searchTitles). Never throws.
export async function getRecommendations(workKey, limit = 10) {
  if (!workKey) return [];
  try {
    const wr = await fetch(`https://openlibrary.org${workKey}.json`);
    if (!wr.ok) return [];
    const subjects = cleanSubjects((await wr.json()).subjects, 8);
    for (const s of subjects) {
      const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!slug) continue;
      const sr = await fetch(`https://openlibrary.org/subjects/${slug}.json?limit=${limit + 5}`);
      if (!sr.ok) continue;
      const works = (await sr.json()).works || [];
      const out = works
        .filter((w) => w.key && w.key !== workKey)
        .slice(0, limit)
        .map((w) => ({
          tmdbId: w.key,
          title: w.title || "",
          author: (w.authors || []).map((a) => a.name).filter(Boolean).slice(0, 2).join(", "),
          year: yearStr(w.first_publish_year),
          posterPath: w.cover_id || "",
          genres: [],
        }));
      if (out.length) return out;
    }
    return [];
  } catch (_) {
    return [];
  }
}
