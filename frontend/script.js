/* ============================================
   ProteoPredict Pro — Main Application Logic
   ============================================ */

const API_URL = 'http://127.0.0.1:5000';

const SAMPLE_PROTEINS = {
  insulin: 'GIVEQCCTSICSLYQLENYCN',
  hemoglobin: 'MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR',
  lysozyme: 'KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL',
  covid: 'MFVFLVLLPLVSSQCVNLTTRTQLPPAYTNSFTRGVYYPDKVFRSSVL',
  p53: 'MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSP'
};

let currentResults = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initTabs();
  initCustomDropdowns();
  initEventListeners();
  initChat();
});

// ============================================
// THEME TOGGLE
// ============================================
function initThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  const appContent = document.getElementById('app-content');
  const navbar = document.querySelector('.navbar');
  const saved = localStorage.getItem('proteopredict-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeBtn(saved);

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';

    // Disable button during animation
    toggle.disabled = true;
    toggle.style.pointerEvents = 'none';

    // STEP 1: Blur the UI (1 second)
    appContent.classList.add('theme-blur');
    navbar.classList.add('theme-blur');

    // STEP 2: After blur settles, slowly transition the theme (3 seconds)
    setTimeout(() => {
      document.documentElement.classList.add('theme-slow-transition');
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('proteopredict-theme', next);
      updateThemeBtn(next);

      // Re-render charts with new theme
      if (currentResults) {
        setTimeout(() => {
          renderSolubilityChart(currentResults);
          renderDisorderChart(currentResults);
          renderCompositionChart(currentResults);
        }, 1500);
      }
    }, 1000);

    // STEP 3: Deblur after transition completes (at 4 seconds)
    setTimeout(() => {
      appContent.classList.remove('theme-blur');
      navbar.classList.remove('theme-blur');
    }, 4000);

    // STEP 4: Clean up (at 5 seconds)
    setTimeout(() => {
      document.documentElement.classList.remove('theme-slow-transition');
      toggle.disabled = false;
      toggle.style.pointerEvents = '';
    }, 5000);
  });
}

function updateThemeBtn(theme) {
  const toggle = document.getElementById('theme-toggle');
  toggle.innerHTML = theme === 'dark'
    ? '<i class="fas fa-moon"></i>'
    : '<i class="fas fa-sun"></i>';
}

// ============================================
// TABS
// ============================================
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');

      // Resize Plotly charts to fix dimension issues on hidden tabs
      if (['solubility', 'disorder', 'composition'].includes(tab)) {
        try { Plotly.Plots.resize(`${tab}-chart`); } catch (e) { }
      }

      // Init 3D viewer if selected
      if (tab === '3d-viewer') {
        // Slightly delay to ensure container is fully rendered
        setTimeout(render3DViewer, 100);
      }
    });
  });
}

// ============================================
// CUSTOM DROPDOWNS
// ============================================
function initCustomDropdowns() {
  document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
    const selected = dropdown.querySelector('.dropdown-selected');
    const options = dropdown.querySelectorAll('.dropdown-option:not(.disabled)');
    const textSpan = selected.querySelector('.selected-text');

    selected.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('active');
      });
      dropdown.classList.toggle('active');
    });

    options.forEach(opt => {
      opt.addEventListener('click', () => {
        textSpan.textContent = opt.childNodes[0].textContent.trim();
        dropdown.classList.remove('active');

        if (dropdown.id === 'sample-dropdown') {
          loadSampleData(opt.dataset.value);
        }
      });
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('active'));
  });
}

// ============================================
// AI SUMMARY GENERATION
// ============================================
function generateAISummary(stats) {
  let paragraphs = [];

  // 1. Basic Intro
  let intro = `Based on the neural network analysis, this sequence is a <strong>${stats.length} amino acid</strong> protein with a molecular weight of <strong>${formatMW(stats.mw)}</strong>. `;
  paragraphs.push(intro);

  // 2. Structure Analysis
  let structStr = "<strong>Structural Profile:</strong> ";
  if (stats.helix_percent > 40) {
    structStr += `It is heavily dominated by <strong>Alpha Helices (${stats.helix_percent}%)</strong>. This suggests it is a highly stable, tightly coiled protein, which is characteristic of transmembrane receptors or structural pillars in biology. `;
  } else if (stats.sheet_percent > 40) {
    structStr += `It is remarkably rich in <strong>Beta Sheets (${stats.sheet_percent}%)</strong>, indicating a rigid, flat architecture often found in robust enzymes or tough biological fibers. `;
  } else if (stats.coil_percent > 50) {
    structStr += `It is primarily composed of <strong>Random Coils (${stats.coil_percent}%)</strong>. This means it has a highly flexible, less rigid 3D shape, allowing it to adapt to its environment. `;
  } else {
    structStr += `It has a balanced mixture of helices, sheets, and coils, indicating a complex, folded 3D shape typical of globular enzymes or transport proteins. `;
  }
  paragraphs.push(structStr);

  // 3. Disorder
  if (stats.avg_disorder > 0.4) {
    paragraphs.push(`<strong>Biological Flexibility:</strong> A significant portion of this protein is predicted to be "intrinsically disordered" (Disorder Score: ${stats.avg_disorder.toFixed(2)}). This is an incredibly valuable trait! Disordered regions act like flexible tentacles, allowing the protein to rapidly bind to multiple different targets. This is a classic hallmark of crucial signaling molecules or regulatory hubs (like the p53 cancer suppressor).`);
  } else {
    paragraphs.push(`<strong>Structural Rigidity:</strong> The disorder score is extremely low (${stats.avg_disorder.toFixed(2)}). This indicates the protein folds into a very rigid, fixed, and locked 3D shape. This high stability is essential for proteins that act as mechanical support or highly specific catalysts that cannot afford to change shape.`);
  }

  // 4. Solubility & Manufacturing
  if (stats.avg_solubility > 0.5) {
    paragraphs.push(`<strong>Drug Design & Manufacturing:</strong> The model predicts excellent water solubility. For a pharmaceutical or biotech company, this is great news! It means this protein is easy to manufacture in a lab environment, won't aggregate (clump together), and can potentially travel easily through the human bloodstream as a therapeutic drug.`);
  } else {
    paragraphs.push(`<strong>Drug Design & Manufacturing:</strong> This sequence is predicted to be mostly insoluble, containing a high fraction of "hydrophobic" (water-fearing) amino acids. In nature, this means the protein likely embeds itself inside the fatty cell membrane. In a lab setting, this makes it challenging to manufacture as a drug because it will tend to clump together in water-based solutions.`);
  }

  const finalHtml = paragraphs.map(p => `<p>${p}</p>`).join('');
  
  // Reset and populate chat
  const chatMessages = document.getElementById('chat-messages');
  chatMessages.innerHTML = ''; // Clear previous chat
  addChatMessage('bot', finalHtml);
  
  // Add dynamic inline suggestions
  addInlineSuggestions();
  
  // Enable chat inputs
  document.getElementById('chat-input').disabled = false;
  document.getElementById('chat-send-btn').disabled = false;
}

const SUGGESTIONS_POOL = [
  "What specific mutations could I make to increase solubility?",
  "Is this sequence related to any known human diseases?",
  "Why does the disorder spike in certain regions?",
  "Does this look like a membrane-bound protein?",
  "Search the PDB database for a similar structure.",
  "How would changing the pH affect this protein's stability?",
  "What are the most likely binding sites on this protein?"
];

function addInlineSuggestions() {
  const chatMessages = document.getElementById('chat-messages');
  const suggestionsDiv = document.createElement('div');
  suggestionsDiv.className = 'chat-suggestions-inline';
  
  // Pick 3 random suggestions
  const shuffled = [...SUGGESTIONS_POOL].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 3);
  
  selected.forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'chat-chip-inline';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      document.getElementById('chat-input').value = text;
      suggestionsDiv.remove(); // Disappear after click
      sendChatMessage();
    });
    suggestionsDiv.appendChild(btn);
  });
  
  chatMessages.appendChild(suggestionsDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addChatMessage(sender, text) {
  const chatMessages = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `message message-${sender}`;
  
  if (sender === 'bot') {
    msgDiv.classList.add('typing-text');
    chatMessages.appendChild(msgDiv);
    typeHTML(msgDiv, text);
  } else {
    msgDiv.innerHTML = text;
    chatMessages.appendChild(msgDiv);
  }
  
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function typeHTML(element, html, speed = 10) {
  let i = 0;
  let isTag = false;
  let text = "";
  
  function next() {
    if (i < html.length) {
      let char = html.charAt(i);
      if (char === "<") isTag = true;
      if (char === ">") isTag = false;
      
      text += char;
      element.innerHTML = text;
      i++;
      
      const chatMessages = document.getElementById('chat-messages');
      chatMessages.scrollTop = chatMessages.scrollHeight;
      
      if (isTag) {
        next(); 
      } else {
        setTimeout(next, speed);
      }
    }
  }
  next();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');
  const text = input.value.trim();
  
  if (!text || !currentResults) return;
  
  // Add user message
  addChatMessage('user', text);
  input.value = '';
  
  // Show typing indicator
  const indicator = document.getElementById('typing-indicator');
  indicator.style.display = 'flex';
  btn.disabled = true;

  const modeToggle = document.getElementById('model-mode-toggle');
  const useGemini = modeToggle ? modeToggle.checked : true;

  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sequence: currentResults.sequence,
        stats: currentResults.stats,
        use_gemini: useGemini
      })
    });
    
    const data = await res.json();
    
    // Add artificial delay for realism
    setTimeout(() => {
      indicator.style.display = 'none';
      btn.disabled = false;
      
      if (res.ok) {
        addChatMessage('bot', data.response);
      } else {
        addChatMessage('bot', `<span class="error-text">Error: ${data.error}</span>`);
      }
    }, 1500); // 1.5s delay
  } catch (err) {
    indicator.style.display = 'none';
    btn.disabled = false;
    addChatMessage('bot', `<span class="error-text">Failed to connect to AI assistant.</span>`);
  }
}

// Intercept link clicks in chat to load PDB
document.addEventListener('click', function(e) {
  if (e.target && e.target.classList.contains('load-pdb-link')) {
    e.preventDefault();
    const pdbId = e.target.getAttribute('data-pdb');
    document.querySelector('.tab-btn[data-tab="3d-viewer"]').click();
    document.getElementById('custom-pdb-input').value = pdbId;
    loadCustomPDB(pdbId);
  }
});

function initChat() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');
  
  btn.addEventListener('click', () => sendChatMessage());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  const modeToggle = document.getElementById('model-mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('change', () => {
      const chatMessages = document.getElementById('chat-messages');
      const chatInput = document.getElementById('chat-input');
      
      // Visual feedback: blur and fade
      chatMessages.style.filter = 'blur(4px)';
      chatMessages.style.opacity = '0.5';
      chatInput.disabled = true;

      setTimeout(() => {
        chatMessages.innerHTML = ''; // Clear history
        
        // Re-generate initial summary if we have results
        if (currentResults && currentResults.stats) {
          generateAISummary(currentResults.stats);
        } else {
          addChatMessage('bot', "AI mode switched. Please analyze a sequence to start chatting.");
        }

        // Restore UI
        chatMessages.style.filter = 'none';
        chatMessages.style.opacity = '1';
        chatInput.disabled = false;
      }, 400);
    });
  }
}

// ============================================
// EVENT LISTENERS
// ============================================
function initEventListeners() {
  const seqInput = document.getElementById('sequence-input');
  const predictBtn = document.getElementById('predict-btn');
  const clearBtn = document.getElementById('clear-btn');
  const downloadBtn = document.getElementById('download-csv-btn');
  const copyBtn = document.getElementById('copy-btn');
  const loadPdbBtn = document.getElementById('load-pdb-btn');

  seqInput.addEventListener('input', updateCharCounter);
  seqInput.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') runPrediction(); });
  predictBtn.addEventListener('click', runPrediction);
  clearBtn.addEventListener('click', resetForm);
  downloadBtn.addEventListener('click', downloadCSV);
  copyBtn.addEventListener('click', copyResults);

  loadPdbBtn.addEventListener('click', () => {
    let pdb = document.getElementById('custom-pdb-input').value.trim().toLowerCase();
    if (pdb.length === 4) {
      loadCustomPDB(pdb);
    } else {
      showToast('Please enter a valid 4-letter PDB ID.');
    }
  });
}

function loadSampleData(key) {
  if (key && SAMPLE_PROTEINS[key]) {
    document.getElementById('sequence-input').value = SAMPLE_PROTEINS[key];
    window.currentLoadedSample = key; // Save state for 3D viewer
    updateCharCounter();
  }
}

function updateCharCounter() {
  const raw = document.getElementById('sequence-input').value;
  const clean = raw.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
  document.getElementById('char-counter').textContent = `${clean.length} aa`;

  // If user modifies input, clear the saved sample state and update dropdown UI
  if (window.currentLoadedSample) {
    const rawSample = SAMPLE_PROTEINS[window.currentLoadedSample] || '';
    const cleanSample = rawSample.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');

    if (clean !== cleanSample) {
      window.currentLoadedSample = null;
      const dropdownText = document.querySelector('#sample-dropdown .selected-text');
      if (dropdownText) dropdownText.textContent = 'Custom Sequence';
    }
  }

  const errEl = document.getElementById('error-msg');
  if (clean.length > 0 && clean.length < 5) {
    errEl.textContent = 'Min 5 aa';
  } else if (clean.length > 1200) {
    errEl.textContent = 'Max 1200 aa';
  } else {
    errEl.textContent = '';
  }
}

// ============================================
// PREDICTION LOGIC
// ============================================
async function runPrediction() {
  const raw = document.getElementById('sequence-input').value;
  const sequence = raw.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');

  if (sequence.length < 5) {
    showError('Please enter at least 5 amino acids.');
    return;
  }
  if (sequence.length > 1200) {
    showError('Sequence too long (max 1200).');
    return;
  }

  clearError();
  setLoading(true);

  try {
    const res = await fetch(`${API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Prediction failed.');
      return;
    }

    currentResults = data;
    displayAllResults(data);

    // Step 1: Auto-PDB Search (Run in background)
    searchRCSB(sequence);
  } catch (err) {
    console.error('Fetch Error:', err);
    showError(`Connection Error: Ensure backend is running at ${API_URL}`);
  } finally {
    setLoading(false);
  }
}

// ============================================
// DISPLAY RESULTS
// ============================================
function displayAllResults(data) {
  const resultsEl = document.getElementById('results-section');
  if (!resultsEl) return;

  resultsEl.style.display = 'block';

  try {
    updateSummaryCards(data);
    generateAISummary(data.stats);
    generateTabExplanations(data);
    renderStructure(data);

    if (typeof Plotly !== 'undefined') {
      renderSolubilityChart(data);
      renderDisorderChart(data);
      renderCompositionChart(data);
    } else {
      showError('Plotly library not loaded. Charts unavailable.');
    }
  } catch (err) {
    console.error('Render Error:', err);
    showError('Error displaying results.');
  }

  // Switch to first tab
  document.querySelectorAll('.tab-btn')[0].click();

  // Scroll gently to results
  setTimeout(() => {
    document.getElementById('summary-cards').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

// ============================================
// SUMMARY CARDS
// ============================================
function updateSummaryCards(data) {
  const s = data.stats;
  document.getElementById('stat-length').textContent = s.length;
  document.getElementById('stat-mw').textContent = formatMW(s.mw);
  document.getElementById('stat-helix').textContent = s.helix_percent + '%';
  document.getElementById('stat-sheet').textContent = s.sheet_percent + '%';
  document.getElementById('stat-coil').textContent = s.coil_percent + '%';
  document.getElementById('stat-solubility').textContent = s.avg_solubility.toFixed(3);
  document.getElementById('stat-disorder').textContent = s.avg_disorder.toFixed(3);
}

function formatMW(mw) {
  return mw >= 1000 ? (mw / 1000).toFixed(1) + ' kDa' : mw.toFixed(0) + ' Da';
}

// ============================================
// STRUCTURE RENDERING
// ============================================
function renderStructure(data) {
  const seqRow = document.getElementById('seq-row');
  const structRow = document.getElementById('structure-row');
  const seq = data.sequence;
  const ss = data.structure;

  let seqHtml = '';
  let ssHtml = '';
  const lineLen = 60;

  for (let i = 0; i < seq.length; i++) {
    seqHtml += seq[i];
    ssHtml += `<span class="ss-${ss[i]}">${ss[i]}</span>`;
    if ((i + 1) % lineLen === 0 && i + 1 < seq.length) {
      seqHtml += '\n';
      ssHtml += '\n';
    }
  }

  seqRow.textContent = seqHtml;
  structRow.innerHTML = ssHtml;
}

// ============================================
// 3D VIEWER (3Dmol.js)
// ============================================
const SAMPLE_PDB_MAP = {
  insulin: '4INS',
  hemoglobin: '1A3N',
  lysozyme: '1DPX',
  covid: '6VXX',
  p53: '1TUP'
};

let viewerInstance = null;

function render3DViewer() {
  const container = document.getElementById('mol-viewer');
  const statusEl = document.getElementById('viewer-status');

  if (window.autoPdbId) {
    statusEl.innerHTML = `<span class="badge-success"><i class="fas fa-check-circle"></i> PDB Found Automatically: ${window.autoPdbId.toUpperCase()}</span> (Based on 100% sequence match)`;
    loadCustomPDB(window.autoPdbId.toLowerCase(), true);
    return;
  }

  if (window.manualPdbId) {
    loadCustomPDB(window.manualPdbId.toLowerCase(), true);
    return;
  }

  if (!window.currentLoadedSample) {
    statusEl.innerHTML = `<span style="color: var(--accent);"><i class="fas fa-exclamation-triangle"></i> Custom Sequence Detected.</span> Please enter a known 4-letter PDB code on the right to view its 3D structure.`;
    container.innerHTML = `<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: var(--text-muted); text-align: center; padding: 2rem;">Tertiary structure prediction for custom sequences requires an AlphaFold server.</div>`;
    return;
  }

  loadCustomPDB(SAMPLE_PDB_MAP[window.currentLoadedSample].toLowerCase(), true);
}

async function searchRCSB(sequence) {
  window.autoPdbId = null; // Reset
  try {
    const query = {
      "query": {
        "type": "terminal",
        "service": "sequence",
        "parameters": {
          "evalue_cutoff": 0.1,
          "identity_cutoff": 0.9, // 90% match to catch slight variations
          "sequence_type": "protein",
          "value": sequence
        }
      },
      "return_type": "entry"
    };

    const res = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', {
      method: 'POST',
      body: JSON.stringify(query)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.result_set && data.result_set.length > 0) {
        window.autoPdbId = data.result_set[0].identifier;
        console.log(`[Auto-PDB] Found match: ${window.autoPdbId}`);
        showToast(`<i class="fas fa-cube"></i> PDB Match Found: ${window.autoPdbId}`);
        
        // If the user is ALREADY on the 3D viewer tab, re-render it immediately!
        if (document.getElementById('tab-3d-viewer').classList.contains('active')) {
          render3DViewer();
        }
      }
    }
  } catch (err) {
    console.warn("RCSB Search failed:", err);
  }
}

function loadCustomPDB(pdbId, isReRender=false) {
  if (!isReRender) {
      window.manualPdbId = pdbId;
  }
  const container = document.getElementById('mol-viewer');
  const statusEl = document.getElementById('viewer-status');
  const expEl = document.getElementById('viewer-explanation');

  if (!window.autoPdbId) {
      statusEl.innerHTML = `Displaying experimental crystal structure (PDB ID: <a href="https://www.rcsb.org/structure/${pdbId}" target="_blank" style="color: var(--accent); text-decoration: none; font-weight: 600;">${pdbId.toUpperCase()}</a>). You can rotate and zoom using your mouse.`;
  }
  expEl.innerHTML = `<strong>Interactive 3D Viewer:</strong> The structure above is visually mapped to its secondary structure. <span style="color:#d95757;font-weight:bold;">Red represents Alpha Helices</span>, <span style="color:#578dd9;font-weight:bold;">Blue represents Beta Sheets</span>, and <span style="color:#57d98d;font-weight:bold;">Green represents flexible Random Coils</span>.`;

  const seqLen = currentResults && currentResults.sequence ? currentResults.sequence.length : 100;
  const loadTime = seqLen > 150 ? '5s' : '3s';

  // Show loading overlay with progress bar
  container.innerHTML = `<div class="viewer-loading-overlay">
      <div class="viewer-loading-content">
          <div class="viewer-loading-bar"><div class="viewer-loading-fill" style="animation-duration: ${loadTime}"></div></div>
          <p>Loading 3D structure...</p>
      </div>
  </div>`;

  viewerInstance = $3Dmol.createViewer(container, { defaultcolors: $3Dmol.rasmolElementColors });

  $3Dmol.download(`pdb:${pdbId}`, viewerInstance, {}, function () {
    // Remove loading overlay
    const loadingEl = container.querySelector('.viewer-loading-overlay');
    if (loadingEl) loadingEl.remove();

    viewerInstance.setStyle({}, {
      cartoon: {
        colorfunc: function (atom) {
          if (atom.ss === 'h' || atom.ss === 'H') return '#d95757'; // Helix (red)
          if (atom.ss === 's' || atom.ss === 'E') return '#578dd9'; // Sheet (blue)
          return '#57d98d'; // Coil (green)
        }
      }
    });
    viewerInstance.zoomTo();
    viewerInstance.render();

    // Start very slow spin on X-axis
    viewerInstance.spin("x", 0.3);

    // Stop spin when user interacts with the canvas
    const stopSpin = () => {
      if (viewerInstance) viewerInstance.spin(false);
    };
    container.addEventListener('mousedown', stopSpin, { once: true });
    container.addEventListener('touchstart', stopSpin, { once: true });

    // Inject Legend
    const legend = document.createElement('div');
    legend.className = 'viewer-legend';
    legend.innerHTML = `<h4>Color Scheme</h4>
                          <div class="legend-grid">
                            <div class="legend-item-3d"><div class="box" style="background:#d95757"></div> Alpha Helix</div>
                            <div class="legend-item-3d"><div class="box" style="background:#578dd9"></div> Beta Sheet</div>
                            <div class="legend-item-3d"><div class="box" style="background:#57d98d"></div> Random Coil</div>
                          </div>`;
    container.appendChild(legend);
  });
}

// ============================================
// PLOTLY HELPERS
// ============================================
function getPlotlyTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: isDark ? '#f1f1f1' : '#1a1a1a', family: 'Inter, sans-serif' },
    xaxis: { gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', zerolinecolor: 'transparent' },
    yaxis: { gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', zerolinecolor: 'transparent' }
  };
}

const PLOTLY_CONFIG = { responsive: true, displayModeBar: false };

// ============================================
// CHARTS
// ============================================
function renderSolubilityChart(data) {
  const theme = getPlotlyTheme();
  const trace = {
    x: data.solubility.map((_, i) => i + 1),
    y: data.solubility,
    type: 'scatter', mode: 'lines',
    line: { color: '#d97757', width: 2.5, shape: 'spline' },
    fill: 'tozeroy', fillcolor: 'rgba(217, 119, 87, 0.1)',
    hovertemplate: 'Pos %{x}: %{y:.3f}<extra></extra>'
  };
  const layout = { ...theme, margin: { t: 20, b: 40, l: 45, r: 20 }, hovermode: 'x unified', showlegend: false };
  Plotly.newPlot('solubility-chart', [trace], layout, PLOTLY_CONFIG);
}

function renderDisorderChart(data) {
  const theme = getPlotlyTheme();
  const colors = data.disorder.map(d => d >= 0.5 ? '#d95757' : '#578dd9');

  const trace = {
    x: data.disorder.map((_, i) => i + 1),
    y: data.disorder,
    type: 'bar', marker: { color: colors, line: { width: 0 } },
    hovertemplate: 'Pos %{x}: %{y:.3f}<extra></extra>'
  };

  const threshold = {
    x: [1, data.disorder.length], y: [0.5, 0.5],
    type: 'scatter', mode: 'lines', line: { color: '#aaaaaa', width: 1, dash: 'dot' }, hoverinfo: 'skip'
  };

  const layout = { ...theme, margin: { t: 20, b: 40, l: 45, r: 20 }, hovermode: 'x', showlegend: false };
  Plotly.newPlot('disorder-chart', [trace, threshold], layout, PLOTLY_CONFIG);
}

function renderCompositionChart(data) {
  const aa = data.stats.aa_counts;
  const labels = Object.keys(aa);
  const theme = getPlotlyTheme();

  const trace = {
    x: labels, y: Object.values(aa), type: 'bar',
    marker: { color: '#8c8c8c' },
    hovertemplate: '%{x}: %{y}<extra></extra>'
  };

  const layout = { ...theme, margin: { t: 20, b: 40, l: 45, r: 20 }, showlegend: false };
  Plotly.newPlot('composition-chart', [trace], layout, PLOTLY_CONFIG);
}

// ============================================
// EXPORT ACTIONS
// ============================================
async function downloadCSV() {
  if (!currentResults) return;

  // Show export overlay
  const overlay = document.getElementById('export-overlay');
  const spinner = document.getElementById('export-spinner');
  const tick = document.getElementById('export-tick');
  const title = document.getElementById('export-title');
  const subtitle = document.getElementById('export-subtitle');

  // Reset state
  spinner.style.display = 'block';
  tick.classList.remove('show');
  title.textContent = 'Generating Report';
  subtitle.textContent = 'Compiling data, charts & 3D images...';
  overlay.classList.add('active');

  // Minimum visible delay of 4 seconds so user sees the animation
  const minDelay = new Promise(resolve => setTimeout(resolve, 4000));

  try {
    const [buffer] = await Promise.all([generateExcelBuffer(), minDelay]);

    // Switch to success state
    spinner.style.display = 'none';
    tick.innerHTML = `<svg viewBox="0 0 56 56"><circle class="tick-circle" cx="28" cy="28" r="26"/><path class="tick-check" d="M16 28l8 8 16-16"/></svg>`;
    tick.classList.add('show');
    title.textContent = 'Report Generated Successfully';
    subtitle.textContent = 'Your download will begin shortly.';

    // Trigger download
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ProteoPredict_Report_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Auto-close after 2 seconds
    setTimeout(() => {
      overlay.classList.remove('active');
    }, 2000);

  } catch (error) {
    console.error("Excel generation error:", error);
    spinner.style.display = 'none';
    title.textContent = 'Generation Failed';
    subtitle.textContent = 'Please check console for details.';
    setTimeout(() => overlay.classList.remove('active'), 2000);
  }
}

async function generateExcelBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ProteoPredict Pro';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Full Report');

  sheet.columns = [
    { key: 'A', width: 25 },
    { key: 'B', width: 25 },
    { key: 'C', width: 25 },
    { key: 'D', width: 25 },
    { key: 'E', width: 25 },
    { key: 'F', width: 25 },
    { key: 'G', width: 25 },
    { key: 'H', width: 25 }
  ];

  // 1. Title
  sheet.addRow(['ProteoPredict Pro - Comprehensive Report']);
  sheet.getRow(1).font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97757' } };
  sheet.mergeCells('A1:H1');
  sheet.getRow(1).height = 30;
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // 2. Summary Stats
  sheet.addRow([]);
  sheet.addRow(['--- Summary Statistics ---']);
  sheet.getRow(3).font = { bold: true, size: 14 };

  const s = currentResults.stats;
  sheet.addRow(['Sequence Length', s.length + ' aa']);
  sheet.addRow(['Molecular Weight', formatMW(s.mw)]);
  sheet.addRow(['Alpha Helix (H)', s.helix_percent + '%']);
  sheet.addRow(['Beta Sheet (E)', s.sheet_percent + '%']);
  sheet.addRow(['Random Coil (C)', s.coil_percent + '%']);
  sheet.addRow(['Average Solubility', s.avg_solubility.toFixed(3)]);
  sheet.addRow(['Average Disorder', s.avg_disorder.toFixed(3)]);

  // 3. AI Insights
  sheet.addRow([]);
  sheet.addRow(['--- Plain English Translation ---']);
  const aiTitleRow = sheet.lastRow.number;
  sheet.getRow(aiTitleRow).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(aiTitleRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF578DD9' } };

  const paragraphs = document.querySelectorAll('#ai-summary-content p');
  paragraphs.forEach(p => {
    const text = p.textContent || p.innerText;
    const row = sheet.addRow([text]);
    sheet.mergeCells(`A${row.number}:H${row.number}`);
    const lines = Math.ceil(text.length / 160);
    row.height = (lines * 18) + 15;
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  });

  // 4. Visualizations
  sheet.addRow([]);
  sheet.addRow(['--- Visualizations ---']);
  const visTitleRow = sheet.lastRow.number;
  sheet.getRow(visTitleRow).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(visTitleRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF57D98D' } };

  let imageStartRow = sheet.lastRow.number + 2;

  const addImageToSheet = async (base64, title, width, height) => {
    if (!base64) return;
    const imageId = workbook.addImage({ base64: base64, extension: 'png' });
    const titleRow = sheet.getRow(imageStartRow);
    titleRow.values = [title];
    titleRow.font = { bold: true, size: 12 };
    imageStartRow += 1;
    sheet.addImage(imageId, {
      tl: { col: 0, row: imageStartRow },
      ext: { width: width, height: height }
    });
    imageStartRow += Math.ceil(height / 20) + 2;
  };

  // --- Capture chart images with forced light theme layout (no DOM switch) ---
  const lightLayout = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { color: '#1a1a1a', family: 'Inter, sans-serif' },
    xaxis: { gridcolor: 'rgba(0,0,0,0.08)', zerolinecolor: 'transparent' },
    yaxis: { gridcolor: 'rgba(0,0,0,0.08)', zerolinecolor: 'transparent' }
  };

  // 3D Viewer Image — silently load if not yet rendered
  if (!viewerInstance && window.currentLoadedSample && SAMPLE_PDB_MAP[window.currentLoadedSample]) {
    const container = document.getElementById('mol-viewer');
    container.innerHTML = '';
    viewerInstance = $3Dmol.createViewer(container, { defaultcolors: $3Dmol.rasmolElementColors });
    const pdbId = SAMPLE_PDB_MAP[window.currentLoadedSample].toLowerCase();
    await new Promise((resolve) => {
      $3Dmol.download(`pdb:${pdbId}`, viewerInstance, {}, function () {
        viewerInstance.setStyle({}, {
          cartoon: {
            colorfunc: function (atom) {
              if (atom.ss === 'h' || atom.ss === 'H') return '#d95757';
              if (atom.ss === 's' || atom.ss === 'E') return '#578dd9';
              return '#57d98d';
            }
          }
        });
        viewerInstance.zoomTo();
        viewerInstance.render();
        resolve();
      });
    });
    await new Promise(r => setTimeout(r, 500));
  }

  if (viewerInstance) {
    try {
      viewerInstance.render();
      const uri3d = viewerInstance.pngURI();
      if (uri3d && uri3d.includes(',')) {
        const base64Data = uri3d.split(',')[1];
        await addImageToSheet(base64Data, 'Interactive 3D Protein Structure', 600, 400);
      }
    } catch (e) { console.warn("Could not capture 3D viewer image", e); }
  }

  // Plotly Charts — use toImage with explicit light layout override
  if (typeof Plotly !== 'undefined') {
    const getPlotlyBase64 = async (divId) => {
      try {
        const el = document.getElementById(divId);
        if (!el || !el.data) return null;
        const dataUrl = await Plotly.toImage(divId, {
          format: 'png', width: 800, height: 400,
          ...lightLayout
        });
        return dataUrl.split(',')[1];
      } catch (e) { return null; }
    };
    await addImageToSheet(await getPlotlyBase64('solubility-chart'), 'Solubility Profile', 800, 400);
    await addImageToSheet(await getPlotlyBase64('disorder-chart'), 'Disorder Profile', 800, 400);
    await addImageToSheet(await getPlotlyBase64('composition-chart'), 'Amino Acid Composition', 800, 400);
  }

  // 5. Raw Data (Per-Residue)
  imageStartRow += 2;
  const rawTitleRow = sheet.getRow(imageStartRow);
  rawTitleRow.values = ['--- Raw Per-Residue Data ---'];
  rawTitleRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  rawTitleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8C8C8C' } };
  imageStartRow++;

  const headerRow = sheet.getRow(imageStartRow);
  headerRow.values = ['Position', 'Amino Acid', 'Predicted Structure', 'Solubility (0-1)', 'Disorder (0-1)'];
  headerRow.font = { bold: true };
  imageStartRow++;

  const d = currentResults;
  for (let i = 0; i < d.sequence.length; i++) {
    let ssFull = d.structure[i] === 'H' ? 'H (Alpha Helix)' : (d.structure[i] === 'E' ? 'E (Beta Sheet)' : 'C (Random Coil)');
    sheet.getRow(imageStartRow).values = [i + 1, d.sequence[i], ssFull, d.solubility[i], d.disorder[i]];
    imageStartRow++;
  }

  // 6. Protect the sheet (read-only mode)
  sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false
  });

  return await workbook.xlsx.writeBuffer();
}

// ============================================
// CONTEXTUAL EXPLANATIONS
// ============================================
function generateTabExplanations(data) {
  const stats = data.stats;

  // Structure Explanation
  let structExp = "<strong>Secondary Structure:</strong> ";
  if (stats.helix_percent > 40) {
    structExp += `The sequence shows a high concentration of <strong>'H' (Alpha Helices)</strong>. This means the protein folds into tight, spring-like coils, giving it a highly stable and rigid 3D structure.`;
  } else if (stats.sheet_percent > 40) {
    structExp += `The sequence shows a high concentration of <strong>'E' (Beta Sheets)</strong>. This means the protein forms flat, rigid planar structures common in tough fibers or stable enzymes.`;
  } else {
    structExp += `The sequence has a balanced mix. The <strong>'C' (Random Coils)</strong> represent highly flexible loops connecting the more rigid helices and sheets.`;
  }
  document.getElementById('struct-explanation').innerHTML = structExp;

  // Solubility Explanation
  let solExp = "<strong>Solubility Analysis:</strong> ";
  if (stats.avg_solubility > 0.5) {
    solExp += `The average solubility is <strong>${stats.avg_solubility.toFixed(2)}</strong>. Values closer to 1.0 indicate that this sequence easily dissolves in water without clumping, making it ideal for laboratory manufacturing.`;
  } else {
    solExp += `The average solubility is <strong>${stats.avg_solubility.toFixed(2)}</strong>. Values closer to 0.0 indicate "hydrophobic" regions that strongly repel water, suggesting this protein might naturally embed itself inside cell membranes.`;
  }
  document.getElementById('solubility-explanation').innerHTML = solExp;

  // Disorder Explanation
  let disExp = "<strong>Disorder Analysis:</strong> ";
  if (stats.avg_disorder > 0.4) {
    disExp += `The disorder score is <strong>${stats.avg_disorder.toFixed(2)}</strong>. High values mean the protein contains "intrinsically disordered regions" (IDPs). These act like highly flexible tentacles, allowing the protein to bend and bind to multiple different targets inside the cell.`;
  } else {
    disExp += `The disorder score is <strong>${stats.avg_disorder.toFixed(2)}</strong>. Low values mean the protein folds into a locked, highly rigid 3D conformation with almost zero flexibility.`;
  }
  document.getElementById('disorder-explanation').innerHTML = disExp;

  // Composition Explanation
  document.getElementById('composition-explanation').innerHTML = `<strong>Amino Acid Composition:</strong> This chart breaks down the exact building blocks of your protein. High amounts of Leucine (L) or Valine (V) usually increase hydrophobicity, while Arginine (R) or Lysine (K) add positive electrical charges.`;
}

function copyResults() {
  if (!currentResults) return;

  // Copy the AI summary text (the full plain-english translation)
  const aiContent = document.getElementById('ai-summary-content');
  if (aiContent && aiContent.textContent.trim()) {
    const text = aiContent.textContent.trim();
    navigator.clipboard.writeText(text).then(() => showToast('AI Summary copied to clipboard!'));
  } else {
    // Fallback: copy basic stats
    const s = currentResults.stats;
    const text = `ProteoPredict Summary:\nLength: ${s.length} aa\nHelix: ${s.helix_percent}% | Sheet: ${s.sheet_percent}% | Coil: ${s.coil_percent}%\nAvg Solubility: ${s.avg_solubility.toFixed(3)}\nAvg Disorder: ${s.avg_disorder.toFixed(3)}`;
    navigator.clipboard.writeText(text).then(() => showToast('Summary copied to clipboard!'));
  }
}

function resetForm() {
  document.getElementById('sequence-input').value = '';
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('char-counter').textContent = '0 aa';
  clearError();
  currentResults = null;
}

// ============================================
// UI HELPERS
// ============================================
function setLoading(on) {
  // Toggle blur class on body instead of hiding input
  if (on) {
    document.body.classList.add('is-loading');
  } else {
    document.body.classList.remove('is-loading');
  }
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
}
function clearError() {
  document.getElementById('error-msg').textContent = '';
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-check-circle" style="color: var(--accent);"></i> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
