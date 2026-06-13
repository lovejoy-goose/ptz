/* Карелия — исторический атлас */

const PTZ_CENTER = [61.789, 34.372];
const PTZ_ZOOM   = 13;
const KAR_CENTER = [62.7, 32.0];
const KAR_ZOOM   = 7;

/* Петрозаводск как "город" в единой системе */
const PTZ_CITY = {
  id: "ptz",
  name: "Петрозаводск",
  coords: PTZ_CENTER,
  founded: 1703,
  population: "≈ 230 000",
  summary:
    "Столица Республики Карелия на западном берегу Онежского озера. Основан в 1703 году " +
    "по указу Петра I как Петровская слобода при оружейном заводе. «Город воинской " +
    "славы» (2015), член Союза исторических городов России.",
  places: null, // null → все не-карельские объекты
};

/* currentCity:
 *   null        → Вся Карелия (контент не фильтруется)
 *   PTZ_CITY    → Петрозаводск
 *   obj из KARELIA_CITIES → конкретный карельский город
 */
let currentCity = null;

/* ---- Карта ---- */
const map = L.map("map", { zoomControl: false }).setView(KAR_CENTER, KAR_ZOOM);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

/* ---- Фото из Википедии ---- */
const wikiData = {};
let wikiReady = null;

function loadWiki() {
  if (wikiReady) return wikiReady;
  const titles = [...new Set(Object.values(WIKI))];
  const chunks = [];
  for (let i = 0; i < titles.length; i += 50) chunks.push(titles.slice(i, i + 50));
  wikiReady = Promise.all(chunks.map(chunk =>
    fetch(
      "https://ru.wikipedia.org/w/api.php?action=query&format=json&origin=*" +
      "&redirects=1&prop=pageimages%7Cinfo&inprop=url&piprop=thumbnail&pithumbsize=480" +
      "&titles=" + encodeURIComponent(chunk.join("|"))
    )
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j?.query) return;
        const back = {};
        (j.query.normalized || []).forEach(n => (back[n.to] = n.from));
        (j.query.redirects  || []).forEach(n => (back[n.to] = back[n.from] || n.from));
        Object.values(j.query.pages).forEach(pg => {
          if (pg.missing !== undefined) return;
          const orig = back[pg.title] || pg.title;
          wikiData[orig] = { img: pg.thumbnail?.source || null, url: pg.fullurl };
        });
      })
      .catch(() => {})
  ));
  return wikiReady;
}

function wikiInfo(id) {
  const title = WIKI?.[id];
  if (!title) return Promise.resolve(null);
  return loadWiki().then(() => wikiData[title] || null);
}

function attachPhoto(el, id, cssClass) {
  wikiInfo(id).then(info => {
    if (!info?.img || !el.isConnected) return;
    const img = document.createElement("img");
    img.className = cssClass;
    img.src = info.img;
    img.alt = "";
    img.loading = "lazy";
    el.prepend(img);
  });
}

/* ---- Контекстные фильтры ---- */

function placeInContext(p) {
  if (!currentCity) return true;
  if (currentCity === PTZ_CITY) return !p.region;
  return (currentCity.places || []).includes(p.id);
}

function eventInContext(ev) {
  if (!currentCity) return true;
  if (!ev.placeId) return currentCity === PTZ_CITY; // общегородские события → только Ptz
  const p = PLACES.find(x => x.id === ev.placeId);
  return p ? placeInContext(p) : currentCity === PTZ_CITY;
}

function personInContext(person) {
  if (!currentCity) return true;
  if (!person.placeId) return currentCity === PTZ_CITY;
  const p = PLACES.find(x => x.id === person.placeId);
  return p ? placeInContext(p) : currentCity === PTZ_CITY;
}

/* Какому городу принадлежит объект */
function findPlaceCity(place) {
  if (!place.region) return PTZ_CITY;
  return KARELIA_CITIES.find(c => (c.places || []).includes(place.id)) || null;
}

/* ---- Переключение города ---- */

function updateTabVisibility() {
  const hasPeople   = PEOPLE.filter(personInContext).length > 0;
  const hasTimeline = EVENTS.filter(eventInContext).length > 0;

  const tabPeople   = document.querySelector('[data-tab="people"]');
  const tabTimeline = document.querySelector('[data-tab="timeline"]');

  tabPeople.style.display   = hasPeople   ? "" : "none";
  tabTimeline.style.display = hasTimeline ? "" : "none";

  /* если текущая вкладка скрылась — перейти на карту */
  const activeTab = document.querySelector(".tab.active");
  if (activeTab && activeTab.style.display === "none") switchTab("map");
}

function setCity(city) {
  currentCity = city;
  detailEl.classList.add("hidden");
  backControl.update(city);
  renderCityNav();
  updateMapLayers();
  refresh();
  rebuildTimeline();
  rebuildPeople();
  renderPlacesTab();
  renderAboutPanel();
  /* обновляем подпись вкладки «О ...» */
  document.getElementById("tab-about").textContent =
    !city ? "О Карелии" : "О городе";
  updateTabVisibility();
}

function updateMapLayers() {
  if (!currentCity) {
    map.flyTo(KAR_CENTER, KAR_ZOOM, { duration: 1.2 });
    districtLayer.remove();
    cityCircleLayer.addTo(map);
  } else if (currentCity === PTZ_CITY) {
    map.flyTo(PTZ_CENTER, PTZ_ZOOM, { duration: 1.0 });
    districtLayer.addTo(map);
    cityCircleLayer.remove();
  } else {
    map.flyTo(currentCity.coords, 11, { duration: 1.0 });
    districtLayer.remove();
    cityCircleLayer.remove();
  }
}

/* ---- Навигация по городам ---- */

function renderCityNav() {
  const nav = document.getElementById("city-nav");
  nav.innerHTML = '<div class="cnav-label">Выберите город или регион</div><div class="cnav-row" id="cnav-row"></div>';
  const row = nav.querySelector("#cnav-row");
  const items = [
    { label: "🗺 Вся Карелия",  city: null },
    { label: "Петрозаводск",   city: PTZ_CITY },
    ...KARELIA_CITIES.map(c => ({ label: c.name, city: c })),
  ];
  items.forEach(({ label, city }) => {
    const btn = document.createElement("button");
    btn.className = "cnav" + (currentCity === city ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => setCity(city);
    row.appendChild(btn);
  });
}

/* ---- Маркеры на карте ---- */

const markers = {};

function makeIcon(color) {
  return L.divIcon({
    className: "pin",
    html: `<span class="pin-dot" style="background:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

PLACES.forEach(p => {
  const m = L.marker(p.coords, { icon: makeIcon(CATEGORIES[p.category].color) });
  m.bindTooltip(p.name, { direction: "top", offset: [0, -8] });
  m.on("click", () => openDetail(p));
  markers[p.id] = m;
});

/* ---- Фильтры-чипсы ---- */

let activeCategories = new Set(Object.keys(CATEGORIES));
let searchQuery = "";

const chipsEl = document.getElementById("chips");
Object.entries(CATEGORIES).forEach(([key, cat]) => {
  const chip = document.createElement("button");
  chip.className = "chip active";
  chip.dataset.cat = key;
  chip.innerHTML = `<i style="background:${cat.color}"></i>${cat.name}`;
  chip.onclick = () => {
    activeCategories.has(key) ? activeCategories.delete(key) : activeCategories.add(key);
    chip.classList.toggle("active");
    refresh();
  };
  chipsEl.appendChild(chip);
});

document.getElementById("search").addEventListener("input", e => {
  searchQuery = e.target.value.trim().toLowerCase();
  refresh();
});

function matchesFilter(p) {
  if (!activeCategories.has(p.category)) return false;
  if (!searchQuery) return true;
  const hay = (p.name + " " + (p.description || "") + " " + p.year + " " + (p.address || "")).toLowerCase();
  return hay.includes(searchQuery);
}

/* ---- Список мест (Карта) ---- */

const listEl = document.getElementById("place-list");

function refresh() {
  listEl.innerHTML = "";
  PLACES.forEach(p => {
    const visible = placeInContext(p) && matchesFilter(p);
    const m = markers[p.id];
    if (visible && !map.hasLayer(m)) m.addTo(map);
    if (!visible && map.hasLayer(m)) map.removeLayer(m);
    if (!visible) return;

    const cat = CATEGORIES[p.category];
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-tag" style="background:${cat.color}">${cat.name}</div>
      <h3>${p.name}</h3>
      <p class="card-meta">${p.year} · ${p.address}</p>
      <p class="card-text">${p.description.slice(0, 130)}…</p>`;
    attachPhoto(card, p.id, "card-img");
    card.onclick = () => {
      const zoom = p.region === "karelia" ? 13 : (p.category === "nearby" ? 12 : 16);
      map.flyTo(p.coords, zoom, { duration: 0.7 });
      openDetail(p);
    };
    listEl.appendChild(card);
  });
  if (!listEl.children.length) {
    listEl.innerHTML = '<p class="empty">Ничего не найдено — измените запрос или фильтры.</p>';
  }
}

/* ---- Сводка объекта (плавающая карточка) ---- */

const detailEl  = document.getElementById("detail");
const detailBody = document.getElementById("detail-body");
document.getElementById("detail-close").onclick = () => detailEl.classList.add("hidden");

function openDetail(p) {
  const cat = CATEGORIES[p.category];
  const related = (p.people || [])
    .map(id => PEOPLE.find(x => x.id === id))
    .filter(Boolean)
    .map(x => `<button class="link person-link" data-person="${x.id}">${x.name}</button>`)
    .join(" · ");
  detailBody.innerHTML = `
    <div class="card-tag" style="background:${cat.color}">${cat.name}</div>
    <h2>${p.name}</h2>
    <p class="card-meta">${p.year} · ${p.address}</p>
    <p>${p.description}</p>
    ${related ? `<p class="related"><b>Связанные личности:</b> ${related}</p>` : ""}`;
  attachPhoto(detailBody, p.id, "detail-img");
  detailEl.classList.remove("hidden");
  detailBody.querySelectorAll(".person-link").forEach(btn => {
    btn.onclick = () => {
      const person = PEOPLE.find(x => x.id === btn.dataset.person);
      if (person) openPersonDetail(person);
    };
  });
}

function openPersonDetail(person) {
  const place = person.placeId ? PLACES.find(p => p.id === person.placeId) : null;
  detailBody.innerHTML = `
    <div class="card-tag person-tag">Личность</div>
    <h2>${person.name}</h2>
    <p class="card-meta">${person.years} · ${person.role}</p>
    <p>${person.text}</p>
    ${place
      ? `<p class="related"><b>На карте:</b> <button class="link" id="goto-place">${place.name}</button></p>`
      : ""}`;
  attachPhoto(detailBody, person.id, "detail-img portrait");
  detailEl.classList.remove("hidden");
  const gotoBtn = document.getElementById("goto-place");
  if (gotoBtn && place) {
    gotoBtn.onclick = () => {
      const targetCity = findPlaceCity(place);
      if (targetCity !== currentCity) setCity(targetCity);
      switchTab("map");
      map.flyTo(place.coords, place.region === "karelia" ? 13 : 16, { duration: 0.8 });
      openDetail(place);
    };
  }
}

/* ---- Хроника ---- */

const timelineEl = document.getElementById("timeline");

function eraOf(ev) {
  if (/до н\.\s*э\./.test(ev.year)) return "Древность";
  const m = ev.year.match(/\d{4}/);
  const y = m ? +m[0] : (/(XII|XIII|XIV|XV|XVI)\b/.test(ev.year) ? 1400 : 0);
  if (y < 1703) return "Древность и Средневековье";
  if (y < 1773) return "Петровская эпоха";
  if (y < 1917) return "Губернский период";
  if (y < 1992) return "Советский век";
  return "Новое время";
}

function rebuildTimeline() {
  timelineEl.innerHTML = "";
  const events = EVENTS.filter(eventInContext);
  if (!events.length) {
    timelineEl.innerHTML = '<p class="empty">Событий нет.</p>';
    return;
  }
  let era = null;
  events.forEach(ev => {
    const e = eraOf(ev);
    if (e !== era) {
      era = e;
      const sep = document.createElement("div");
      sep.className = "tl-era";
      sep.textContent = e;
      timelineEl.appendChild(sep);
    }
    const item = document.createElement("div");
    item.className = "tl-item" + (ev.placeId ? " linked" : "");
    item.innerHTML = `
      <div class="tl-year">${ev.year}</div>
      <div class="tl-body">
        <h3>${ev.title}</h3>
        <p>${ev.text}</p>
        ${ev.placeId ? '<span class="tl-go">показать на карте →</span>' : ""}
      </div>`;
    if (ev.placeId) {
      attachPhoto(item.querySelector(".tl-body"), ev.placeId, "tl-img");
      item.onclick = () => {
        const p = PLACES.find(x => x.id === ev.placeId);
        if (!p) return;
        const targetCity = findPlaceCity(p);
        if (targetCity !== currentCity) setCity(targetCity);
        switchTab("map");
        map.flyTo(p.coords, p.region === "karelia" ? 13 : 16, { duration: 0.8 });
        openDetail(p);
      };
    }
    timelineEl.appendChild(item);
  });
}

/* ---- Личности ---- */

function rebuildPeople() {
  const el = document.getElementById("people-list");
  el.innerHTML = "";
  const people = PEOPLE.filter(personInContext);
  if (!people.length) {
    el.innerHTML = '<p class="empty">Нет данных для этого города.</p>';
    return;
  }
  people.forEach(person => {
    const card = document.createElement("article");
    card.className = "card person-card";
    card.innerHTML = `
      <div class="card-tag person-tag">${person.role}</div>
      <h3>${person.name}</h3>
      <p class="card-meta">${person.years}</p>
      <p class="card-text">${person.text.slice(0, 130)}…</p>`;
    attachPhoto(card, person.id, "card-portrait");
    card.onclick = () => openPersonDetail(person);
    el.appendChild(card);
  });
}

/* ---- Вкладка «Места» ---- */

function renderPlacesTab() {
  const el = document.getElementById("places-content");
  el.innerHTML = "";

  if (!currentCity) {
    /* Вся Карелия — показываем список городов */
    [PTZ_CITY, ...KARELIA_CITIES].forEach(c => {
      const card = document.createElement("article");
      card.className = "card city-card";
      card.innerHTML = `
        <div class="card-tag city-tag">${c === PTZ_CITY ? "Столица" : "Город"}</div>
        <h3>${c.name}</h3>
        <p class="card-meta">Основан ${c.founded} · ${c.population}</p>
        <p class="card-text">${c.summary}</p>`;
      const previewId = c === PTZ_CITY ? "peter-monument" : (c.places || [])[0];
      if (previewId) attachPhoto(card, previewId, "card-img");
      card.onclick = () => setCity(c);
      el.appendChild(card);
    });

  } else if (currentCity === PTZ_CITY) {
    /* Петрозаводск — исторические районы */
    const head = document.createElement("p");
    head.className = "panel-note";
    head.textContent =
      "Исторические районы города — от слобод петровской эпохи до спальных микрорайонов. " +
      "Пунктирные круги на карте — условные ядра районов.";
    el.before(head); // вставим до cards, но el уже пустой — просто добавим в el
    el.appendChild(head);
    DISTRICTS.forEach(d => {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <div class="card-tag district-tag">Район</div>
        <h3>${d.name}</h3>
        <p class="card-text">${d.summary.slice(0, 140)}…</p>`;
      card.onclick = () => {
        switchTab("map");
        map.flyTo(d.coords, 14, { duration: 0.8 });
        openDistrictDetail(d);
      };
      el.appendChild(card);
    });

  } else {
    /* Карельский город — объекты этого города */
    const cityPlaces = (currentCity.places || [])
      .map(id => PLACES.find(p => p.id === id))
      .filter(Boolean);
    if (!cityPlaces.length) {
      el.innerHTML = '<p class="empty">Объекты для этого города ещё не добавлены.</p>';
      return;
    }
    cityPlaces.forEach(p => {
      const cat = CATEGORIES[p.category];
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <div class="card-tag" style="background:${cat.color}">${cat.name}</div>
        <h3>${p.name}</h3>
        <p class="card-meta">${p.year}</p>
        <p class="card-text">${p.description.slice(0, 130)}…</p>`;
      attachPhoto(card, p.id, "card-img");
      card.onclick = () => {
        switchTab("map");
        map.flyTo(p.coords, 13, { duration: 0.8 });
        openDetail(p);
      };
      el.appendChild(card);
    });
  }
}

/* ---- Вкладка «О городе / регионе» ---- */

const KARELIA_ABOUT_HTML = `<article class="about">
  <h2>Карелия — край воды, леса и камня</h2>
  <p>Республика Карелия — субъект России на северо-западе страны, граничит с Финляндией.
  Территория — 180 500 км², почти треть которых занимают более 60 000 озёр и 27 000 рек.
  Столица — <b>Петрозаводск</b> на берегу Онежского озера.</p>
  <p>С XII века карельские земли входили в состав Новгородской республики, затем Московского
  царства. В XVIII веке Пётр I превратил край в кузницу флота и оружия. Карелия — родина
  эпоса <b>«Калевала»</b>, который Элиас Лённрот собрал в беломорских деревнях в 1835 году.</p>
  <p>Петроглифы Онежского озера и Белого моря включены в список Всемирного наследия
  ЮНЕСКО (2021). Главные туристические магниты: горный парк <b>Рускеала</b>, архипелаги
  <b>Валаам</b> и <b>Соловки</b>, <b>Ладожские шхеры</b>, нацпарки «Паанаярви» и «Калевала».</p>
  <ul class="facts">
    <li><b>Площадь:</b> 180 500 км²</li>
    <li><b>Население республики:</b> ≈ 600 000 человек</li>
    <li><b>Столица:</b> Петрозаводск (основан 1703)</li>
    <li><b>Озёра:</b> более 60 000</li>
    <li><b>Наследие ЮНЕСКО:</b> петроглифы (2021)</li>
    <li><b>Граница с Финляндией:</b> 798 км</li>
  </ul>
</article>`;

const PTZ_ABOUT_HTML = `<article class="about">
  <h2>Город Петра на берегу Онего</h2>
  <p>Петрозаводск — столица Республики Карелия на западном берегу Онежского озера.
  Основан <b>1 сентября 1703 года</b> — в один год с Санкт-Петербургом — по указу Петра I
  как Петровская слобода при оружейном заводе.</p>
  <p>В 1777 году указом Екатерины II слобода получила статус города. С 1784 года — центр
  Олонецкого наместничества; первым губернатором стал поэт Гавриил Державин. В 1788 году
  на Александровском заводе построили первую в России рельсовую дорогу.</p>
  <p>В XX веке Петрозаводск стал столицей советской Карелии, пережил финскую оккупацию
  1941–1944 годов и был отстроен заново. Сегодня — «Город воинской славы» (2015),
  ворота к Кижам и Валааму.</p>
  <ul class="facts">
    <li><b>Основан:</b> 1703 год</li>
    <li><b>Статус города:</b> 1777 год</li>
    <li><b>Население:</b> ≈ 230 000 человек</li>
    <li><b>До Санкт-Петербурга:</b> 412 км</li>
    <li><b>Награда:</b> «Город воинской славы» (2015)</li>
  </ul>
</article>`;

function renderCityAbout(c) {
  const history = (CITY_HISTORY[c.id] || []).map(h => `
    <div class="d-period">
      <div class="d-period-name">${h.period}</div>
      <p>${h.text}</p>
    </div>`).join("");
  const landmarks = (c.places || [])
    .map(id => PLACES.find(p => p.id === id))
    .filter(Boolean)
    .map(p => `<button class="link place-link" data-place="${p.id}">${p.name}</button>`)
    .join(" · ");
  return `<article class="about">
    <div class="card-tag city-tag">Город Карелии</div>
    <h2>${c.name}</h2>
    <p class="card-meta">Основан ${c.founded} · Население: ${c.population}</p>
    <p>${c.summary}</p>
    ${landmarks ? `<p class="related"><b>Достопримечательности:</b> ${landmarks}</p>` : ""}
    ${history ? `<div class="d-history"><h4>История города</h4>${history}</div>` : ""}
  </article>`;
}

function renderAboutPanel() {
  const el = document.getElementById("panel-about");
  if (!currentCity) {
    el.innerHTML = KARELIA_ABOUT_HTML;
  } else if (currentCity === PTZ_CITY) {
    el.innerHTML = PTZ_ABOUT_HTML;
  } else {
    el.innerHTML = renderCityAbout(currentCity);
    el.querySelectorAll(".place-link").forEach(btn => {
      btn.onclick = () => {
        const p = PLACES.find(x => x.id === btn.dataset.place);
        if (!p) return;
        switchTab("map");
        map.flyTo(p.coords, 13, { duration: 0.8 });
        openDetail(p);
      };
    });
  }
}

/* ---- Районы Петрозаводска ---- */

const districtLayer = L.layerGroup();
DISTRICTS.forEach(d => {
  const circle = L.circle(d.coords, {
    radius: d.radius,
    color: "#3f7d8c", weight: 1.5, dashArray: "6 4",
    fillColor: "#3f7d8c", fillOpacity: 0.07,
  });
  circle.bindTooltip(d.name, { direction: "center", className: "district-label" });
  circle.on("click", () => {
    if (currentCity !== PTZ_CITY) setCity(PTZ_CITY);
    openDistrictDetail(d);
  });
  circle.addTo(districtLayer);
});

function openDistrictDetail(d) {
  const periods = (DISTRICT_HISTORY[d.id] || []).map(h => `
    <div class="d-period">
      <div class="d-period-name">${h.period}</div>
      <p>${h.text}</p>
    </div>`).join("");
  const landmarks = (d.places || [])
    .map(id => PLACES.find(p => p.id === id))
    .filter(Boolean)
    .map(p => `<button class="link place-link" data-place="${p.id}">${p.name}</button>`)
    .join(" · ");
  detailBody.innerHTML = `
    <div class="card-tag district-tag">Исторический район</div>
    <h2>${d.name}</h2>
    <p>${d.summary}</p>
    ${landmarks ? `<p class="related"><b>Знаковые места:</b> ${landmarks}</p>` : ""}
    ${periods ? `<div class="d-history"><h4>История района</h4>${periods}</div>` : ""}
    <p class="source-note">По материалам «Литературные адреса Петрозаводска» (Петрозаводская ЦБС)</p>`;
  detailEl.classList.remove("hidden");
  detailBody.querySelectorAll(".place-link").forEach(btn => {
    btn.onclick = () => {
      const p = PLACES.find(x => x.id === btn.dataset.place);
      if (p) { map.flyTo(p.coords, 16, { duration: 0.8 }); openDetail(p); }
    };
  });
}

/* ---- Кнопка «Вся Карелия» на карте ---- */

const BackControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const btn = L.DomUtil.create("button", "map-back-btn leaflet-bar");
    btn.innerHTML = "← Вся Карелия";
    btn.title = "Показать все города";
    btn.style.display = "none";
    L.DomEvent.on(btn, "click", L.DomEvent.stopPropagation);
    L.DomEvent.on(btn, "click", () => setCity(null));
    this._btn = btn;
    return btn;
  },
  update(city) {
    this._btn.style.display = city ? "" : "none";
  },
});

const backControl = new BackControl();
backControl.addTo(map);

/* ---- Круги городов (вид «Вся Карелия») ---- */

const cityCircleLayer = L.layerGroup();

/* Петрозаводск */
(function() {
  const c = L.circle(PTZ_CENTER, {
    radius: 3500, color: "#b5552d", weight: 2,
    fillColor: "#b5552d", fillOpacity: 0.13,
  });
  c.bindTooltip("Петрозаводск", { direction: "center", className: "district-label" });
  c.on("click", () => setCity(PTZ_CITY));
  c.addTo(cityCircleLayer);
})();

KARELIA_CITIES.forEach(c => {
  const circle = L.circle(c.coords, {
    radius: 6000, color: "#6a1b9a", weight: 1.5, dashArray: "8 4",
    fillColor: "#6a1b9a", fillOpacity: 0.09,
  });
  circle.bindTooltip(c.name, { direction: "center", className: "district-label" });
  circle.on("click", () => setCity(c));
  circle.addTo(cityCircleLayer);
});

cityCircleLayer.addTo(map); // видна при старте (Карелия-вид)

/* ---- Переключение вкладок ---- */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.id === "panel-" + name)
  );
}

document.querySelectorAll(".tab").forEach(t => {
  t.onclick = () => switchTab(t.dataset.tab);
});

/* ---- Инициализация ---- */

renderCityNav();
renderAboutPanel();
renderPlacesTab();
rebuildTimeline();
rebuildPeople();
refresh();
updateTabVisibility();
