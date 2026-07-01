// ============================================================================
//  Ratings: half-star widget, read-only star display, and saving reviews
// ============================================================================

import { db, doc, setDoc, serverTimestamp } from "./firebase.js";
import { getMemberId, getName, getUid } from "./session.js";

// Interactive 0.5–5 star control. Each star has a left half (x.5) and a right
// half (x.0). Returns an element with getValue()/setValue() helpers.
export function buildStarRating(initial, onChange) {
  let value = initial || 0;
  const wrap = document.createElement("div");
  wrap.className = "stars-input";
  const stars = [];

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement("span");
    star.className = "star";
    star.innerHTML = `<span class="bg">★</span><span class="fg">★</span>`;

    const left = document.createElement("button");
    left.type = "button";
    left.className = "half left";
    left.setAttribute("aria-label", `${i - 0.5} stars`);

    const right = document.createElement("button");
    right.type = "button";
    right.className = "half right";
    right.setAttribute("aria-label", `${i} stars`);

    left.addEventListener("click", () => set(i - 0.5));
    right.addEventListener("click", () => set(i));
    left.addEventListener("mouseenter", () => paint(i - 0.5));
    right.addEventListener("mouseenter", () => paint(i));
    // Keyboard: tabbing onto a half previews it, just like hover.
    left.addEventListener("focus", () => paint(i - 0.5));
    right.addEventListener("focus", () => paint(i));

    star.append(left, right);
    wrap.appendChild(star);
    stars.push(star);
  }

  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Your rating, from half a star to five stars");
  wrap.addEventListener("mouseleave", () => paint(value));
  // When focus leaves the whole widget, snap the preview back to the saved value.
  wrap.addEventListener("focusout", (e) => {
    if (!wrap.contains(e.relatedTarget)) paint(value);
  });

  // Pointer/touch support: tap OR drag across the stars to pick a value (halves
  // included). The .half buttons stay for keyboard; we swallow the click a
  // pointer would synthesise so the two paths don't double-fire.
  let dragging = false, usedPointer = false;
  function valueFromX(clientX) {
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0) return value;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width - 0.0001);
    const starW = rect.width / 5;
    const idx = Math.floor(x / starW);
    const frac = (x - idx * starW) / starW;
    return Math.min(5, idx + (frac < 0.5 ? 0.5 : 1));
  }
  wrap.addEventListener("pointerdown", (e) => {
    dragging = true; usedPointer = true;
    try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
    paint(valueFromX(e.clientX));
    e.preventDefault();
  });
  wrap.addEventListener("pointermove", (e) => {
    if (dragging) { paint(valueFromX(e.clientX)); e.preventDefault(); }
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    set(valueFromX(e.clientX));
    e.preventDefault();
  });
  wrap.addEventListener("pointercancel", () => { dragging = false; paint(value); });
  wrap.addEventListener("click", (e) => {
    if (usedPointer) { usedPointer = false; e.preventDefault(); e.stopPropagation(); }
  }, true);

  function paint(v) {
    stars.forEach((star, idx) => {
      const i = idx + 1;
      const pct = v >= i ? 100 : v >= i - 0.5 ? 50 : 0;
      star.querySelector(".fg").style.width = pct + "%";
    });
  }
  function set(v) {
    value = v;
    paint(v);
    onChange?.(v);
  }

  paint(value);
  wrap.getValue = () => value;
  wrap.setValue = (v) => { value = v || 0; paint(value); };
  return wrap;
}

// Read-only stars for display (returns an HTML string).
export function starsHtml(value) {
  let out = '<span class="stars-display">';
  for (let i = 1; i <= 5; i++) {
    const pct = value >= i ? 100 : value >= i - 0.5 ? 50 : 0;
    out += `<span class="star"><span class="bg">★</span><span class="fg" style="width:${pct}%">★</span></span>`;
  }
  out += "</span>";
  return out;
}

export async function saveRating(code, movieId, score, review) {
  const memberId = getMemberId();
  await setDoc(
    doc(db, "groups", code, "ratings", `${movieId}__${memberId}`),
    {
      movieId,
      memberId,
      uid: getUid(),
      name: getName(),
      score: score || 0,
      review: (review || "").trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
