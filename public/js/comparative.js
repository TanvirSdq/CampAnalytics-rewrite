/**
 * CampComparativeSuite
 * Pure client-side SVG multi-line time series visualization, sliding entity
 * selection drawer, interactive timeline scrubber, and segmented view switcher.
 * Strict 100% sharp 90-degree rectangle geometry · Zero gradients · Wikimedia Codex palette.
 */
var CampComparativeSuite = (function () {
  'use strict';

  var CODEX_PALETTE = [
    '#3366cc', '#d73333', '#00af89', '#ac6600', '#6b4ba1',
    '#008080', '#e67300', '#54595d', '#4c34a4', '#0097a7',
    '#b32424', '#14866d', '#2a4b8d', '#7232e8', '#8c5e00'
  ];

  var state = {
    module: 'influx',
    containerId: 'comparative-line-container',
    data: null,
    years: [],
    series: [],
    availableCountries: [],
    selectedCountries: [],
    activeYear: null,
    currentView: 'line',
    sortOrder: 'metric',
    searchQuery: '',
    isPlaying: false,
    playTimer: null,
    highlightedCountry: null
  };

  function init(config) {
    if (!config || !config.data) return;

    state.module = config.module || config.data.module || 'influx';
    state.data = config.data;
    state.containerId = config.containerId || 'comparative-line-container';
    state.years = Array.isArray(config.data.years) ? config.data.years.slice() : [];
    state.series = Array.isArray(config.data.series) ? config.data.series.slice() : [];
    state.activeYear = state.years.length > 0 ? state.years[state.years.length - 1] : new Date().getFullYear();

    // Determine initial selected countries
    if (Array.isArray(config.data.selected_countries) && config.data.selected_countries.length > 0) {
      state.selectedCountries = config.data.selected_countries.slice();
    } else if (state.series.length > 0) {
      state.selectedCountries = state.series.map(function (s) { return s.country_code; });
    } else {
      state.selectedCountries = ['de', 'it', 'bd'];
    }

    // Determine available countries from global lookups or current series
    var globalCodes = (typeof window !== 'undefined' && Array.isArray(window.ALL_COUNTRY_CODES)) ? window.ALL_COUNTRY_CODES : [];
    var nameMap = (typeof window !== 'undefined' && window.COUNTRY_NAME_MAP) ? window.COUNTRY_NAME_MAP : {};

    var allCodes = {};
    state.series.forEach(function (s) {
      allCodes[s.country_code] = s.country_name || nameMap[s.country_code] || s.country_code.toUpperCase();
    });
    globalCodes.forEach(function (code) {
      if (!allCodes[code]) {
        var raw = nameMap[code] || code.toUpperCase();
        allCodes[code] = raw.replace(/_/g, ' ');
      }
    });

    state.availableCountries = Object.keys(allCodes).map(function (code) {
      var s = state.series.find(function (item) { return item.country_code === code; });
      var latestVal = (s && s.summary && typeof s.summary.latest_value === 'number') ? s.summary.latest_value : 0;
      var latestFmt = (s && s.summary && s.summary.latest_formatted) ? s.summary.latest_formatted : '—';
      return {
        code: code,
        name: allCodes[code],
        latestValue: latestVal,
        latestFormatted: latestFmt
      };
    });

    // Check URL hash for initial view (#line, #table, #map)
    var initialView = config.initialView || 'line';
    if (typeof window !== 'undefined' && window.location.hash) {
      var hash = window.location.hash.replace('#', '').toLowerCase();
      if (hash === 'line' || hash === 'table' || hash === 'map') {
        initialView = hash;
      }
    }
    state.currentView = initialView;

    // Mount UI components
    renderLineChart();
    renderTable();
    initDrawer();
    initScrubber();
    switchView(state.currentView, true);

    // Sync hash changes
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', function () {
        var h = window.location.hash.replace('#', '').toLowerCase();
        if (h === 'line' || h === 'table' || h === 'map') {
          switchView(h, true);
        }
      });
      window.addEventListener('resize', debounce(function () {
        if (state.currentView === 'line') {
          renderLineChart();
        }
      }, 150));
    }
  }

  function debounce(fn, wait) {
    var timeout;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  }

  /* ── VIEW SWITCHER ──────────────────────────────────────────────────────── */

  function switchView(viewMode, skipHashUpdate) {
    state.currentView = viewMode;
    var views = ['line', 'table', 'map'];
    views.forEach(function (v) {
      var container = document.getElementById('comparative-view-' + v);
      var tabBtn = document.getElementById('tab-view-' + v);
      if (container) {
        container.style.display = (v === viewMode) ? 'block' : 'none';
      }
      if (tabBtn) {
        if (v === viewMode) {
          tabBtn.classList.add('active');
          tabBtn.setAttribute('aria-selected', 'true');
        } else {
          tabBtn.classList.remove('active');
          tabBtn.setAttribute('aria-selected', 'false');
        }
      }
    });

    if (!skipHashUpdate && typeof window !== 'undefined' && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + viewMode);
    }

    if (viewMode === 'line') {
      renderLineChart();
    }
  }

  /* ── MULTI-LINE SVG RENDERER ────────────────────────────────────────────── */

  function renderLineChart() {
    var container = document.getElementById(state.containerId);
    if (!container) return;

    var width = 920;
    var height = 460;
    var margin = { top: 40, right: 140, bottom: 50, left: 70 };
    var plotW = width - margin.left - margin.right;
    var plotH = height - margin.top - margin.bottom;

    var activeSeries = state.series.filter(function (s) {
      return state.selectedCountries.indexOf(s.country_code) !== -1;
    });

    if (activeSeries.length === 0) {
      container.innerHTML = '<div style="padding: 48px 20px; text-align: center; color: var(--text-muted);">' +
        'No countries currently selected. Click <strong>Edit countries and regions</strong> to select series.</div>';
      return;
    }

    // Determine scale bounds
    var allValues = [];
    activeSeries.forEach(function (s) {
      s.points.forEach(function (pt) {
        if (pt.value !== null && typeof pt.value === 'number' && !isNaN(pt.value)) {
          allValues.push(pt.value);
        }
      });
    });

    var maxVal = allValues.length > 0 ? Math.max.apply(null, allValues) : 10;
    if (maxVal <= 0) maxVal = 10;
    var yMax = Math.ceil(maxVal * 1.15);
    if (state.data.indicator_unit === '%' && yMax < 100 && maxVal <= 100) {
      yMax = Math.min(100, Math.ceil(maxVal * 1.2));
    }

    var years = state.years;
    var numYears = years.length;

    function getX(yr) {
      if (numYears <= 1) return margin.left + plotW / 2;
      var idx = years.indexOf(yr);
      if (idx === -1) idx = 0;
      return margin.left + (idx / (numYears - 1)) * plotW;
    }

    function getY(val) {
      if (val === null || isNaN(val)) return margin.top + plotH;
      return margin.top + plotH - (val / yMax) * plotH;
    }

    var svgParts = [];
    svgParts.push('<svg class="camp-line-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" style="width: 100%; height: auto;" role="img" aria-label="Comparative Time Series Chart">');

    // Title & Unit Header
    var headerTitle = (state.data.indicator_title || 'Comparative Analytics') + (state.data.event_name ? ' · ' + state.data.event_name : '');
    svgParts.push('<text x="' + margin.left + '" y="24" class="chart-axis-text" font-size="13" font-weight="700" fill="#202122">' + escapeHtml(headerTitle) + '</text>');
    svgParts.push('<text x="' + (width - margin.right + 10) + '" y="24" class="chart-axis-text" font-size="11" font-weight="600" fill="#72777d">' + escapeHtml(state.data.indicator_unit || '') + '</text>');

    // Horizontal Grid Lines & Y Ticks (5 steps)
    var steps = 5;
    for (var i = 0; i <= steps; i++) {
      var val = (yMax / steps) * i;
      var y = getY(val);
      svgParts.push('<line class="chart-gridline" x1="' + margin.left + '" y1="' + y + '" x2="' + (margin.left + plotW) + '" y2="' + y + '" />');

      var fTick = val >= 1000 ? (val / 1000).toFixed(1) + 'k' : (state.data.indicator_unit === '%' ? val.toFixed(1) : Math.round(val));
      if (state.data.indicator_unit === '%' && typeof fTick === 'string' && fTick.indexOf('%') === -1) {
        fTick += '%';
      }
      svgParts.push('<text class="chart-axis-text" x="' + (margin.left - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + fTick + '</text>');
    }

    // X Axis Line & Year Ticks
    svgParts.push('<line class="chart-axis-line" x1="' + margin.left + '" y1="' + (margin.top + plotH) + '" x2="' + (margin.left + plotW) + '" y2="' + (margin.top + plotH) + '" />');
    years.forEach(function (yr) {
      var x = getX(yr);
      svgParts.push('<line class="chart-gridline" x1="' + x + '" y1="' + (margin.top + plotH) + '" x2="' + x + '" y2="' + (margin.top + plotH + 6) + '" stroke="#72777d" />');
      svgParts.push('<text class="chart-axis-text" x="' + x + '" y="' + (margin.top + plotH + 22) + '" text-anchor="middle" font-weight="600">' + yr + '</text>');
    });

    // Vertical Scrubber Guide Line
    var guideX = getX(state.activeYear);
    svgParts.push('<line id="chart-scrubber-guide-line" class="chart-scrubber-guide" x1="' + guideX + '" y1="' + margin.top + '" x2="' + guideX + '" y2="' + (margin.top + plotH) + '" />');

    // Draw Series Lines
    activeSeries.forEach(function (s, sIdx) {
      var color = s.color || CODEX_PALETTE[sIdx % CODEX_PALETTE.length];
      var validPts = s.points.filter(function (p) {
        return p.value !== null && typeof p.value === 'number' && !isNaN(p.value);
      });

      if (validPts.length >= 2) {
        var pathD = validPts.map(function (pt, idx) {
          return (idx === 0 ? 'M' : 'L') + ' ' + getX(pt.year) + ' ' + getY(pt.value);
        }).join(' ');

        var lineClass = 'chart-series-line';
        if (state.highlightedCountry) {
          lineClass += (state.highlightedCountry === s.country_code) ? ' highlighted' : ' dimmed';
        }
        svgParts.push('<path id="series-line-' + s.country_code + '" class="' + lineClass + '" data-country="' + s.country_code + '" d="' + pathD + '" stroke="' + color + '" />');
      }

      // Square Data Points (rx="0" ry="0")
      validPts.forEach(function (pt) {
        var cx = getX(pt.year);
        var cy = getY(pt.value);
        var isCurrentYear = (pt.year === state.activeYear);
        var ptClass = 'chart-point-rect' + (isCurrentYear ? ' active' : '');
        var pw = isCurrentYear ? 9 : 7;
        var pOffset = pw / 2;

        svgParts.push('<rect class="' + ptClass + '" data-country="' + s.country_code + '" data-year="' + pt.year + '" data-val="' + pt.value + '" x="' + (cx - pOffset) + '" y="' + (cy - pOffset) + '" width="' + pw + '" height="' + pw + '" rx="0" ry="0" fill="' + (isCurrentYear ? color : '#ffffff') + '" stroke="' + color + '" stroke-width="2" />');
      });
    });

    // Direct Line End Labels with Collision Avoidance
    var labelCandidates = [];
    activeSeries.forEach(function (s, sIdx) {
      var color = s.color || CODEX_PALETTE[sIdx % CODEX_PALETTE.length];
      var validPts = s.points.filter(function (p) {
        return p.value !== null && typeof p.value === 'number' && !isNaN(p.value);
      });
      if (validPts.length > 0) {
        var lastPt = validPts[validPts.length - 1];
        labelCandidates.push({
          country_code: s.country_code,
          country_name: s.country_name,
          color: color,
          lastYear: lastPt.year,
          lastVal: lastPt.value,
          lx: getX(lastPt.year),
          naturalY: getY(lastPt.value)
        });
      }
    });

    // Sort by natural Y ascending
    labelCandidates.sort(function (a, b) {
      return a.naturalY - b.naturalY;
    });

    // Vertical collision resolution: minimum 16px clearance
    var minGap = 16;
    for (var k = 0; k < labelCandidates.length; k++) {
      if (k > 0) {
        var prevY = labelCandidates[k - 1].adjustedY;
        if (labelCandidates[k].naturalY < prevY + minGap) {
          labelCandidates[k].adjustedY = prevY + minGap;
        } else {
          labelCandidates[k].adjustedY = labelCandidates[k].naturalY;
        }
      } else {
        labelCandidates[k].adjustedY = Math.max(margin.top + 8, labelCandidates[k].naturalY);
      }
    }

    // Secondary pass: clamp bottom edge if pushed too far
    var maxAllowedY = margin.top + plotH + 8;
    for (var m = labelCandidates.length - 1; m >= 0; m--) {
      if (labelCandidates[m].adjustedY > maxAllowedY) {
        labelCandidates[m].adjustedY = maxAllowedY;
        maxAllowedY -= minGap;
      }
    }

    // Render end labels
    labelCandidates.forEach(function (lbl) {
      var labelClass = 'chart-end-label';
      if (state.highlightedCountry) {
        labelClass += (state.highlightedCountry === lbl.country_code) ? ' highlighted' : ' dimmed';
      }
      svgParts.push('<g class="' + labelClass + '" data-country="' + lbl.country_code + '" onmouseenter="CampComparativeSuite.highlightSeries(\'' + lbl.country_code + '\')" onmouseleave="CampComparativeSuite.unhighlightSeries()">');
      svgParts.push('<rect class="chart-end-label-swatch" x="' + (lbl.lx + 8) + '" y="' + (lbl.adjustedY - 4) + '" width="8" height="8" rx="0" ry="0" fill="' + lbl.color + '" />');
      svgParts.push('<text class="chart-end-label-text" x="' + (lbl.lx + 20) + '" y="' + (lbl.adjustedY + 3) + '" fill="' + lbl.color + '">' + escapeHtml(lbl.country_name) + '</text>');
      svgParts.push('</g>');
    });

    // Transparent Hover Tracker Overlay
    svgParts.push('<rect id="chart-hover-overlay" class="chart-hover-overlay" x="' + margin.left + '" y="' + margin.top + '" width="' + plotW + '" height="' + plotH + '" />');
    svgParts.push('</svg>');

    // Floating Tooltip Card Container
    svgParts.push('<div id="camp-chart-tooltip" class="chart-tooltip" style="display:none;"></div>');

    container.innerHTML = svgParts.join('');

    // Attach hover listeners to the overlay
    var overlay = document.getElementById('chart-hover-overlay');
    var tooltip = document.getElementById('camp-chart-tooltip');
    if (overlay && tooltip) {
      overlay.addEventListener('mousemove', function (e) {
        var rect = overlay.getBoundingClientRect();
        var clientX = e.clientX - rect.left;
        var relX = clientX / rect.width;
        var approxIdx = Math.round(relX * (years.length - 1));
        if (approxIdx < 0) approxIdx = 0;
        if (approxIdx >= years.length) approxIdx = years.length - 1;
        var hoveredYear = years[approxIdx];

        if (hoveredYear !== state.activeYear) {
          scrubToYear(hoveredYear);
        }

        // Populate tooltip content
        var rows = [];
        activeSeries.forEach(function (s, sIdx) {
          var pt = s.points.find(function (p) { return p.year === hoveredYear; });
          if (pt && pt.value !== null) {
            rows.push({
              color: s.color || CODEX_PALETTE[sIdx % CODEX_PALETTE.length],
              name: s.country_name,
              value: pt.value,
              formatted: pt.formatted_value || String(pt.value)
            });
          }
        });

        // Sort descending by value
        rows.sort(function (a, b) { return b.value - a.value; });

        if (rows.length > 0) {
          var html = '<div class="chart-tooltip-header">' + hoveredYear + ' Campaign Edition</div><div class="chart-tooltip-list">';
          rows.forEach(function (r) {
            html += '<div class="chart-tooltip-row">' +
              '<span class="chart-tooltip-swatch" style="background:' + r.color + ';"></span>' +
              '<span class="chart-tooltip-name">' + escapeHtml(r.name) + '</span>' +
              '<span class="chart-tooltip-val">' + escapeHtml(r.formatted) + '</span>' +
              '</div>';
          });
          html += '</div>';
          tooltip.innerHTML = html;
          tooltip.style.display = 'block';

          // Position tooltip relative to container
          var cRect = container.getBoundingClientRect();
          var tX = e.clientX - cRect.left + 15;
          var tY = e.clientY - cRect.top + 15;
          if (tX + 220 > cRect.width) tX = cRect.width - 230;
          if (tY + 180 > cRect.height) tY = cRect.height - 190;
          if (tX < 10) tX = 10;
          if (tY < 10) tY = 10;
          tooltip.style.left = tX + 'px';
          tooltip.style.top = tY + 'px';
        }
      });

      overlay.addEventListener('mouseleave', function () {
        tooltip.style.display = 'none';
      });
    }
  }

  function highlightSeries(countryCode) {
    state.highlightedCountry = countryCode;
    var lines = document.querySelectorAll('.chart-series-line');
    lines.forEach(function (line) {
      if (line.getAttribute('data-country') === countryCode) {
        line.classList.add('highlighted');
        line.classList.remove('dimmed');
      } else {
        line.classList.add('dimmed');
        line.classList.remove('highlighted');
      }
    });

    var labels = document.querySelectorAll('.chart-end-label');
    labels.forEach(function (lbl) {
      if (lbl.getAttribute('data-country') === countryCode) {
        lbl.classList.add('highlighted');
        lbl.classList.remove('dimmed');
      } else {
        lbl.classList.add('dimmed');
        lbl.classList.remove('highlighted');
      }
    });
  }

  function unhighlightSeries() {
    state.highlightedCountry = null;
    var lines = document.querySelectorAll('.chart-series-line');
    lines.forEach(function (line) {
      line.classList.remove('highlighted', 'dimmed');
    });

    var labels = document.querySelectorAll('.chart-end-label');
    labels.forEach(function (lbl) {
      lbl.classList.remove('highlighted', 'dimmed');
    });
  }

  /* ── TIMELINE SCRUBBER ──────────────────────────────────────────────────── */

  function initScrubber() {
    var minYearLabel = document.getElementById('scrubber-min-year');
    var maxYearLabel = document.getElementById('scrubber-max-year');
    var slider = document.getElementById('camp-scrubber-range');
    var badge = document.getElementById('scrubber-active-year');

    if (state.years.length > 0) {
      var minYear = state.years[0];
      var maxYear = state.years[state.years.length - 1];
      if (minYearLabel) minYearLabel.textContent = minYear;
      if (maxYearLabel) maxYearLabel.textContent = maxYear;
      if (slider) {
        slider.min = minYear;
        slider.max = maxYear;
        slider.value = state.activeYear;
      }
      if (badge) badge.textContent = state.activeYear;
    }
  }

  function scrubToYear(year) {
    state.activeYear = year;
    var badge = document.getElementById('scrubber-active-year');
    if (badge) badge.textContent = year;

    var slider = document.getElementById('camp-scrubber-range');
    if (slider && parseInt(slider.value, 10) !== year) {
      slider.value = year;
    }

    // Synchronize chart guide line and highlighted points
    var guideLine = document.getElementById('chart-scrubber-guide-line');
    if (guideLine && state.years.length > 1) {
      var idx = state.years.indexOf(year);
      if (idx !== -1) {
        var plotW = 920 - 70 - 140;
        var gx = 70 + (idx / (state.years.length - 1)) * plotW;
        guideLine.setAttribute('x1', gx);
        guideLine.setAttribute('x2', gx);
      }
    }

    // Toggle active points
    var pts = document.querySelectorAll('.chart-point-rect');
    pts.forEach(function (pt) {
      var ptYear = parseInt(pt.getAttribute('data-year'), 10);
      if (ptYear === year) {
        pt.classList.add('active');
        pt.setAttribute('width', '9');
        pt.setAttribute('height', '9');
        var cx = parseFloat(pt.getAttribute('x')) + 3.5;
        var cy = parseFloat(pt.getAttribute('y')) + 3.5;
        pt.setAttribute('x', cx - 4.5);
        pt.setAttribute('y', cy - 4.5);
      } else if (pt.classList.contains('active')) {
        pt.classList.remove('active');
        pt.setAttribute('width', '7');
        pt.setAttribute('height', '7');
        var px = parseFloat(pt.getAttribute('x')) + 4.5;
        var py = parseFloat(pt.getAttribute('y')) + 4.5;
        pt.setAttribute('x', px - 3.5);
        pt.setAttribute('y', py - 3.5);
      }
    });
  }

  function togglePlayPause() {
    if (state.isPlaying) {
      clearInterval(state.playTimer);
      state.isPlaying = false;
      updatePlayBtn(false);
    } else {
      state.isPlaying = true;
      updatePlayBtn(true);
      var minYear = state.years[0];
      var maxYear = state.years[state.years.length - 1];

      if (state.activeYear >= maxYear) {
        scrubToYear(minYear);
      }

      state.playTimer = setInterval(function () {
        if (state.activeYear < maxYear) {
          scrubToYear(state.activeYear + 1);
        } else {
          clearInterval(state.playTimer);
          state.isPlaying = false;
          updatePlayBtn(false);
        }
      }, 900);
    }
  }

  function updatePlayBtn(isPlaying) {
    var btn = document.getElementById('scrubber-play-btn');
    if (!btn) return;
    btn.classList.toggle('playing', isPlaying);

    var iconPlay = btn.querySelector('.icon-play');
    var iconPause = btn.querySelector('.icon-pause');
    var text = btn.querySelector('.scrubber-play-text');

    if (iconPlay) iconPlay.style.display = isPlaying ? 'none' : 'inline-block';
    if (iconPause) iconPause.style.display = isPlaying ? 'inline-block' : 'none';
    if (text) text.textContent = isPlaying ? 'Pause' : 'Play';
  }

  /* ── ENTITY SELECTION DRAWER ────────────────────────────────────────────── */

  function initDrawer() {
    updateDrawerList();
    updateDrawerBadge();
  }

  function toggleEntityDrawer(open) {
    var drawer = document.getElementById('entity-drawer');
    var backdrop = document.getElementById('entity-drawer-backdrop');
    if (!drawer || !backdrop) return;

    drawer.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = open ? 'hidden' : '';
    }

    if (open) {
      var searchInput = document.getElementById('entity-search-input');
      if (searchInput) {
        setTimeout(function () { searchInput.focus(); }, 150);
      }
    }
  }

  function filterEntities(query) {
    state.searchQuery = (query || '').toLowerCase().trim();
    updateDrawerList();
  }

  function setSortOrder(order) {
    state.sortOrder = order;
    var btnMetric = document.getElementById('sort-btn-metric');
    var btnAlpha = document.getElementById('sort-btn-alpha');
    if (btnMetric) btnMetric.classList.toggle('active', order === 'metric');
    if (btnAlpha) btnAlpha.classList.toggle('active', order === 'alpha');
    updateDrawerList();
  }

  function updateDrawerList() {
    var listEl = document.getElementById('entity-drawer-list');
    if (!listEl) return;

    var items = state.availableCountries.slice();

    // Filter
    if (state.searchQuery) {
      items = items.filter(function (item) {
        return item.code.toLowerCase().indexOf(state.searchQuery) !== -1 ||
          item.name.toLowerCase().indexOf(state.searchQuery) !== -1;
      });
    }

    // Sort
    if (state.sortOrder === 'alpha') {
      items.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
    } else {
      items.sort(function (a, b) {
        return b.latestValue - a.latestValue;
      });
    }

    var html = '';
    items.forEach(function (item) {
      var isSelected = (state.selectedCountries.indexOf(item.code) !== -1);
      var sIdx = state.selectedCountries.indexOf(item.code);
      var swatchColor = isSelected ? CODEX_PALETTE[sIdx % CODEX_PALETTE.length] : '#c8ccd1';

      html += '<li class="entity-item-row' + (isSelected ? ' selected' : '') + '" onclick="CampComparativeSuite.toggleEntity(\'' + item.code + '\')">' +
        '<input type="checkbox" class="entity-checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); CampComparativeSuite.toggleEntity(\'' + item.code + '\')">' +
        '<span class="entity-swatch" style="background:' + swatchColor + ';"></span>' +
        '<span class="entity-name">' + escapeHtml(item.name) + '</span>' +
        '<span class="entity-metric-val">' + escapeHtml(item.latestFormatted) + '</span>' +
        '</li>';
    });

    listEl.innerHTML = html;
    updateDrawerBadge();
  }

  function updateDrawerBadge() {
    var countBadge = document.getElementById('drawer-selected-count');
    if (countBadge) countBadge.textContent = state.selectedCountries.length;

    var summary = document.getElementById('entity-selection-summary');
    if (summary) {
      summary.textContent = state.selectedCountries.length + ' of ' + state.availableCountries.length + ' selected';
    }
  }

  function toggleEntity(countryCode) {
    var idx = state.selectedCountries.indexOf(countryCode);
    if (idx !== -1) {
      if (state.selectedCountries.length > 1) {
        state.selectedCountries.splice(idx, 1);
      }
    } else {
      state.selectedCountries.push(countryCode);
    }

    ensureSeriesLoaded(countryCode, function () {
      updateDrawerList();
      renderLineChart();
      renderTable();
    });
  }

  function selectAllEntities() {
    // Select top 8 to avoid visual overcrowding while allowing multi-country comparison
    var topCodes = state.availableCountries.slice(0, 8).map(function (c) { return c.code; });
    state.selectedCountries = topCodes;

    ensureAllSeriesLoaded(topCodes, function () {
      updateDrawerList();
      renderLineChart();
      renderTable();
    });
  }

  function clearAllEntities() {
    // Retain only primary first country
    var first = state.availableCountries.length > 0 ? state.availableCountries[0].code : 'de';
    state.selectedCountries = [first];
    updateDrawerList();
    renderLineChart();
    renderTable();
  }

  function applyEntities() {
    toggleEntityDrawer(false);
    renderLineChart();
    renderTable();
  }

  function ensureSeriesLoaded(countryCode, callback) {
    var exists = state.series.some(function (s) { return s.country_code === countryCode; });
    if (exists || typeof fetch === 'undefined') {
      if (callback) callback();
      return;
    }

    var url = '/api/comparative?module=' + encodeURIComponent(state.module) +
      '&event_type=' + encodeURIComponent(state.data.event_type || 'wlm') +
      '&countries=' + encodeURIComponent(state.selectedCountries.join(',')) +
      '&start_year=' + encodeURIComponent(state.years[0]) +
      '&end_year=' + encodeURIComponent(state.years[state.years.length - 1]);

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (freshData) {
        if (freshData && Array.isArray(freshData.series)) {
          state.data = freshData;
          state.series = freshData.series;
        }
        if (callback) callback();
      })
      .catch(function () {
        if (callback) callback();
      });
  }

  function ensureAllSeriesLoaded(codes, callback) {
    if (typeof fetch === 'undefined') {
      if (callback) callback();
      return;
    }

    var url = '/api/comparative?module=' + encodeURIComponent(state.module) +
      '&event_type=' + encodeURIComponent(state.data.event_type || 'wlm') +
      '&countries=' + encodeURIComponent(codes.join(',')) +
      '&start_year=' + encodeURIComponent(state.years[0]) +
      '&end_year=' + encodeURIComponent(state.years[state.years.length - 1]);

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (freshData) {
        if (freshData && Array.isArray(freshData.series)) {
          state.data = freshData;
          state.series = freshData.series;
        }
        if (callback) callback();
      })
      .catch(function () {
        if (callback) callback();
      });
  }

  /* ── COHORT DATA TABLE RENDERER ─────────────────────────────────────────── */

  function renderTable() {
    var tableContainer = document.getElementById('comparative-table-container');
    if (!tableContainer || !state.data || !state.data.table_data) return;

    var headers = state.data.table_data.headers || [];
    var allRows = state.data.table_data.rows || [];

    // Filter rows to selected countries
    var filteredRows = allRows.filter(function (row) {
      return state.selectedCountries.indexOf(row.country_code) !== -1;
    });

    var html = '<div class="table-responsive">' +
      '<table id="comparative-data-table" class="camp-table table-hover" data-sortable="true">' +
      '<thead><tr>';

    headers.forEach(function (h) {
      html += '<th scope="col">' + escapeHtml(h) + '</th>';
    });
    html += '</tr></thead><tbody>';

    filteredRows.forEach(function (row, rIdx) {
      var sIdx = state.selectedCountries.indexOf(row.country_code);
      var color = row.color || CODEX_PALETTE[(sIdx >= 0 ? sIdx : rIdx) % CODEX_PALETTE.length];

      html += '<tr>' +
        '<td>' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:0;background:' + color + ';margin-right:8px;vertical-align:middle;"></span>' +
        '<strong>' + escapeHtml(row.country_name) + '</strong> (' + row.country_code.toUpperCase() + ')' +
        '</td>';

      // Year values
      state.years.forEach(function (yr) {
        var fmt = (row.formatted_values && (row.formatted_values[yr] || row.formatted_values[String(yr)])) ||
          ((row.values && (row.values[yr] !== undefined && row.values[yr] !== null)) ? row.values[yr] : '—');
        html += '<td style="font-variant-numeric: tabular-nums;">' + escapeHtml(String(fmt)) + '</td>';
      });

      html += '<td style="font-weight: 600; font-variant-numeric: tabular-nums;">' + escapeHtml(String(row.latest || '—')) + '</td>' +
        '<td style="font-variant-numeric: tabular-nums;">' + escapeHtml(String(row.average || '—')) + '</td>';

      var yoyClass = row.is_positive === true ? 'badge-positive' : (row.is_positive === false ? 'badge-negative' : 'badge-neutral');
      html += '<td><span class="stat-kpi-badge ' + yoyClass + '">' + escapeHtml(String(row.yoy_change || '—')) + '</span></td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
    tableContainer.innerHTML = html;

    if (typeof window !== 'undefined' && window.CampTableSuite && typeof window.CampTableSuite.initTable === 'function') {
      window.CampTableSuite.initTable('comparative-data-table');
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return {
    init: init,
    switchView: switchView,
    renderLineChart: renderLineChart,
    renderTable: renderTable,
    initScrubber: initScrubber,
    scrubToYear: scrubToYear,
    togglePlayPause: togglePlayPause,
    toggleEntityDrawer: toggleEntityDrawer,
    filterEntities: filterEntities,
    setSortOrder: setSortOrder,
    toggleEntity: toggleEntity,
    selectAllEntities: selectAllEntities,
    clearAllEntities: clearAllEntities,
    applyEntities: applyEntities,
    highlightSeries: highlightSeries,
    unhighlightSeries: unhighlightSeries
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CampComparativeSuite;
}
