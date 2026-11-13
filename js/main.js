import { SidecarManager } from './sidecar.js';
import { AppUI } from './ui.js';
import { AIBackend, GITHUB_MODELS, ATTITUDES, normalizeUrl } from './ai.js';
import { FlowView } from './flow.js';

const Sidecar = new SidecarManager();
const ui = new AppUI();
const AI = new AIBackend();

// Chat & AI Panel
const chatForm        = document.getElementById('chat-form');
const chatInput       = document.getElementById('chat-input');
const chatLog         = document.getElementById('chat-log');
const attitudeSelect  = document.getElementById('attitude-select');
const clippyPanel     = document.getElementById('clippy-panel');
const openClippyBtn   = document.getElementById('openClippy');
const closeClippyBtn  = document.getElementById('closeClippy');
const aiStatusBadge   = document.getElementById('ai-status-badge');

openClippyBtn.addEventListener('click',  () => clippyPanel.classList.remove('hidden'));
closeClippyBtn.addEventListener('click', () => clippyPanel.classList.add('hidden'));

// Flow view
const boardEl      = document.getElementById('board');
const flowOuter    = document.getElementById('flow-outer');
const viewBoardBtn = document.getElementById('viewBoard');
const viewFlowBtn  = document.getElementById('viewFlow');
const flowWrap     = document.getElementById('flow-canvas');
const flowNodes    = document.getElementById('flow-nodes');
const flowSvg      = document.getElementById('flow-svg');
const flowView     = new FlowView(flowWrap, flowNodes, flowSvg);

viewBoardBtn.addEventListener('click', () => {
  boardEl.classList.remove('hidden');
  flowOuter.classList.add('hidden');
  viewBoardBtn.classList.add('active');
  viewFlowBtn.classList.remove('active');
});
viewFlowBtn.addEventListener('click', () => {
  boardEl.classList.add('hidden');
  flowOuter.classList.remove('hidden');
  viewBoardBtn.classList.remove('active');
  viewFlowBtn.classList.add('active');
  const state = JSON.parse(localStorage.getItem('cesarops_board_state') || '{}');
  flowView.render(state);
});

// Settings Modal
const settingsBtn       = document.getElementById('settingsBtn');
const modal             = document.getElementById('settings-modal');
const closeSettingsBtn  = document.getElementById('close-settings');
const sidecarInput      = document.getElementById('sidecar-input');
const saveSidecarBtn    = document.getElementById('save-sidecar');
const clearSidecarBtn   = document.getElementById('clear-sidecar');
const sidecarStatus     = document.getElementById('sidecar-status');

// AI backend controls
const aiBackendSelect   = document.getElementById('ai-backend-select');
const offSettings       = document.getElementById('off-settings');
const companionSettings = document.getElementById('companion-settings');
const githubSettings    = document.getElementById('github-settings');
const koboldSettings    = document.getElementById('kobold-settings');
const githubTokenInput  = document.getElementById('github-token-input');
const githubModelSelect = document.getElementById('github-model-select');
const koboldUrlInput    = document.getElementById('kobold-url-input');
const companionUrlInput  = document.getElementById('companion-url-input');
const companionCodeInput = document.getElementById('companion-code-input');
const companionCheckBtn  = document.getElementById('companion-check');
const companionInfoEl    = document.getElementById('companion-info');
const companionConsentRow = document.getElementById('companion-consent-row');
const companionConsent   = document.getElementById('companion-consent');

// Populate GitHub model options from ai.js list
githubModelSelect.innerHTML = '';
GITHUB_MODELS.forEach(m => {
  const opt = document.createElement('option');
  opt.value = m.value;
  opt.textContent = m.label;
  if (m.value === AI.model) opt.selected = true;
  githubModelSelect.appendChild(opt);
});

function syncBackendUI() {
  const b = aiBackendSelect.value;
  offSettings.classList.toggle('hidden', b !== 'off');
  companionSettings.classList.toggle('hidden', b !== 'companion');
  githubSettings.classList.toggle('hidden', b !== 'github');
  koboldSettings.classList.toggle('hidden', b !== 'kobold');
}

aiBackendSelect.addEventListener('change', syncBackendUI);

// The helper server the student has checked in this visit to Settings (null = not checked yet).
let checkedCompanion = null;

function showCompanionInfo(text, kind = '') {
  companionInfoEl.textContent = text;
  companionInfoEl.className = 'settings-hint ' + kind;
}

function resetCompanionCheck() {
  checkedCompanion = null;
  companionConsent.checked = false;
  companionConsentRow.classList.add('hidden');
  showCompanionInfo('');
}
companionUrlInput.addEventListener('input', resetCompanionCheck);
companionConsent.addEventListener('change', () => {
  if (checkedCompanion) showCompanionInfo(describeCompanion(checkedCompanion.url, checkedCompanion.info), 'ok');
});

function describeCompanion(url, info) {
  const who = info.operator ? `Run by: ${info.operator}.` : 'This helper does not say who runs it.';
  const where = { teacher: 'It runs on a teacher\'s computer.', school: 'It runs on a school server.' }[info.mode] || '';
  const stored = info.stores_messages === false ? 'It says it does not keep your questions or its answers.' : 'It may keep your questions.';
  const code = info.needs_code ? ' It needs a class code.' : '';
  return `✅ Found a helper at ${url}. ${who} ${where} ${stored}${code}`.replace(/\s+/g, ' ');
}

companionCheckBtn.addEventListener('click', async () => {
  const url = normalizeUrl(companionUrlInput.value);
  resetCompanionCheck();
  showCompanionInfo('Checking…');
  try {
    const info = await AI.fetchCompanionInfo(url);
    checkedCompanion = { url, info };
    showCompanionInfo(describeCompanion(url, info), 'ok');
    companionConsentRow.classList.remove('hidden');
  } catch (err) {
    showCompanionInfo('⚠️ ' + err.message, 'bad');
  }
});

settingsBtn.addEventListener('click', async () => {
  // Load current values into form
  aiBackendSelect.value    = AI.backend;
  githubTokenInput.value   = AI.token;
  githubModelSelect.value  = AI.model;
  koboldUrlInput.value     = AI.koboldUrl;
  companionUrlInput.value  = AI.companionUrl;
  companionCodeInput.value = AI.companionCode;
  resetCompanionCheck();
  if (AI.consented && AI.companionInfo) {
    checkedCompanion = { url: AI.companionUrl, info: AI.companionInfo };
    showCompanionInfo(describeCompanion(AI.companionUrl, AI.companionInfo), 'ok');
    companionConsentRow.classList.remove('hidden');
    companionConsent.checked = true;
  }
  syncBackendUI();

  sidecarInput.value       = Sidecar.rules.join('\n');
  sidecarStatus.textContent = Sidecar.getSummary();
  modal.showModal();

  // Opened from a teacher's computer? Offer that helper's address so nobody has to type it.
  if (!companionUrlInput.value) {
    const local = await AI.detectLocalCompanion();
    if (local && !companionUrlInput.value) companionUrlInput.value = local;
  }
});

closeSettingsBtn.addEventListener('click', () => modal.close());

saveSidecarBtn.addEventListener('click', () => {
  const backend = aiBackendSelect.value;
  if (backend === 'companion') {
    const url = normalizeUrl(companionUrlInput.value);
    if (!checkedCompanion || checkedCompanion.url !== url) {
      showCompanionInfo('⚠️ Press "Check connection" first, so you can see who runs this helper.', 'bad');
      return;
    }
    if (!companionConsent.checked) {
      showCompanionInfo(describeCompanion(url, checkedCompanion.info) + ' Tick the box below to turn the helper on.', 'bad');
      return;
    }
    AI.save({ companionUrl: url, companionCode: companionCodeInput.value.trim(), companionInfo: checkedCompanion.info, consent: true });
  }

  // Save AI backend config
  AI.save({
    backend,
    token:     githubTokenInput.value.trim(),
    model:     githubModelSelect.value,
    koboldUrl: koboldUrlInput.value.trim(),
  });
  refreshAI();

  // Save sidecar rules
  const lines = sidecarInput.value.split('\n').filter(l => l.trim());
  Sidecar.clear();
  lines.forEach(l => Sidecar.addRule(l));
  sidecarStatus.textContent = '✅ Saved! ' + Sidecar.getSummary();
  setTimeout(() => modal.close(), 1000);
});

clearSidecarBtn.addEventListener('click', () => {
  Sidecar.clear();
  sidecarInput.value = '';
  sidecarStatus.textContent = '🗑️ Rules cleared';
});

// Show the helper only when it is turned on, with the personalities its backend allows.
function refreshAI() {
  if (aiStatusBadge) aiStatusBadge.textContent = AI.statusLabel();
  openClippyBtn.classList.toggle('hidden', !AI.isOn());
  if (!AI.isOn()) clippyPanel.classList.add('hidden');

  const { names, preferred } = AI.attitudes();
  const current = names.includes(attitudeSelect.value) ? attitudeSelect.value : preferred;
  attitudeSelect.innerHTML = '';
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = ATTITUDES[n].label;
    attitudeSelect.appendChild(opt);
  });
  attitudeSelect.value = current;
}
refreshAI();

// AI Chat Handler
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userMsg = chatInput.value.trim();
  if (!userMsg) return;

  appendChat('user', userMsg);
  chatInput.value = '';

  const thinkingEl = appendChat('ai', '⏳ Thinking…');

  try {
    const reply = await AI.chat({ attitude: attitudeSelect.value, rules: Sidecar.rules, message: userMsg });
    thinkingEl.textContent = reply;
  } catch (err) {
    thinkingEl.classList.add('error');
    thinkingEl.textContent = `⚠️ ${err.message}`;
  }
});

function appendChat(role, text) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

console.log('🚀 Wayfinder v2 Online. Sidecar Memory Active.');
