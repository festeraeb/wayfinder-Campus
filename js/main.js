import { SidecarManager } from './sidecar.js';
import { AppUI } from './ui.js';
import { AIBackend, GITHUB_MODELS } from './ai.js';
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
const githubSettings    = document.getElementById('github-settings');
const koboldSettings    = document.getElementById('kobold-settings');
const githubTokenInput  = document.getElementById('github-token-input');
const githubModelSelect = document.getElementById('github-model-select');
const koboldUrlInput    = document.getElementById('kobold-url-input');

// Populate GitHub model options from ai.js list
GITHUB_MODELS.forEach(m => {
  const opt = document.createElement('option');
  opt.value = m.value;
  opt.textContent = m.label;
  if (m.value === AI.model) opt.selected = true;
  githubModelSelect.appendChild(opt);
});
// Clear the static options and replace with dynamic ones
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
  githubSettings.classList.toggle('hidden', b !== 'github');
  koboldSettings.classList.toggle('hidden', b !== 'kobold');
}

aiBackendSelect.addEventListener('change', syncBackendUI);

settingsBtn.addEventListener('click', () => {
  // Load current values into form
  aiBackendSelect.value    = AI.backend;
  githubTokenInput.value   = AI.token;
  githubModelSelect.value  = AI.model;
  koboldUrlInput.value     = AI.koboldUrl;
  syncBackendUI();

  sidecarInput.value       = Sidecar.rules.join('\n');
  sidecarStatus.textContent = Sidecar.getSummary();
  modal.showModal();
});

closeSettingsBtn.addEventListener('click', () => modal.close());

saveSidecarBtn.addEventListener('click', () => {
  // Save AI backend config
  AI.save({
    backend:   aiBackendSelect.value,
    token:     githubTokenInput.value.trim(),
    model:     githubModelSelect.value,
    koboldUrl: koboldUrlInput.value.trim(),
  });
  updateStatusBadge();

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

function updateStatusBadge() {
  if (aiStatusBadge) aiStatusBadge.textContent = AI.statusLabel();
}
updateStatusBadge();

// System prompts per attitude
const SYSTEM_PROMPTS = {
  abliterated: "You are a direct, honest CS tutor. Do not coddle. Point out errors clearly, explain why, and give exact fixes. Be brief.",
  standard:    "You are a balanced, helpful CS tutor. Explain concepts clearly, give hints, and correct mistakes constructively.",
  supportive:  "You are an encouraging, gentle CS tutor. Praise effort, break complex tasks into tiny steps, and reassure anxious learners.",
};

// AI Chat Handler
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userMsg = chatInput.value.trim();
  if (!userMsg) return;

  appendChat('user', userMsg);
  chatInput.value = '';

  const attitude     = attitudeSelect.value;
  const sidecarRules = Sidecar.getPromptPrefix();
  const systemPrompt = sidecarRules + SYSTEM_PROMPTS[attitude];

  const thinkingEl = appendChat('ai', '⏳ Thinking…');

  try {
    const reply = await AI.chat(systemPrompt, userMsg);
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
