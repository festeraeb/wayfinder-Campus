// AI helper for Wayfinder Campus. It is OFF until someone turns it on in Settings.
//
// Backends:
//   off        (default) the board works on its own; nothing is sent anywhere
//   companion  a Wayfinder Companion server (see /companion): the publisher's own server, a teacher's
//              desktop, or a school server. The tutor's instructions live on that server.
//   github     Advanced, personal use: GitHub Models with your own token
//   kobold     Advanced, personal use: KoboldCPP on this same computer

import { DEFAULT_COMPANION_URL } from './config.js';

const ENDPOINT_GITHUB = 'https://models.inference.ai.azure.com/chat/completions';
const ENDPOINT_KOBOLD_SUFFIX = '/api/v1/generate';

const SK = {
  backend:       'wf_ai_backend',
  token:         'wf_github_token',
  model:         'wf_github_model',
  koboldUrl:     'wf_kobold_url',
  companionUrl:  'wf_companion_url',
  companionCode: 'wf_companion_code',
  companionOk:   'wf_companion_consent',   // the address the student agreed to send questions to
  companionInfo: 'wf_companion_info',
};

export const GITHUB_MODELS = [
  { value: 'gpt-4o-mini',                    label: 'GPT-4o Mini (fast, free)' },
  { value: 'gpt-4o',                          label: 'GPT-4o (powerful, free)' },
  { value: 'meta-llama-3-8b-instruct',        label: 'Llama 3 8B (free)' },
  { value: 'Phi-3-mini-128k-instruct',        label: 'Phi-3 Mini (lightweight)' },
  { value: 'Phi-3.5-mini-instruct',           label: 'Phi-3.5 Mini (lightweight+)' },
];

export const ATTITUDES = {
  supportive: { label: '🌟 Supportive (Gentle)',        prompt: 'You are an encouraging, gentle tutor. Praise effort, break complex tasks into tiny steps, and reassure anxious learners.' },
  standard:   { label: '😐 Standard (Balanced)',        prompt: 'You are a balanced, helpful tutor. Explain concepts clearly, give hints, and correct mistakes constructively.' },
  direct:     { label: '🔥 Mr. Clippy (Honest/Direct)', prompt: 'You are a direct, honest tutor. Point out errors clearly, explain why, and give exact fixes. Be brief.' },
};

export function normalizeUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

// A secure (https) page is not allowed to call a plain http:// server, except one on this same computer.
export function blockedByBrowser(url) {
  if (location.protocol !== 'https:') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

export class AIBackend {
  get backend()       { return localStorage.getItem(SK.backend)   || 'off'; }
  get token()         { return localStorage.getItem(SK.token)     || ''; }
  get model()         { return localStorage.getItem(SK.model)     || 'gpt-4o-mini'; }
  get koboldUrl()     { return localStorage.getItem(SK.koboldUrl) || 'http://localhost:5001'; }
  get companionUrl()  { return localStorage.getItem(SK.companionUrl) || normalizeUrl(DEFAULT_COMPANION_URL); }
  get companionCode() { return localStorage.getItem(SK.companionCode) || ''; }
  get companionInfo() { try { return JSON.parse(localStorage.getItem(SK.companionInfo) || 'null'); } catch { return null; } }
  get consented()     { return !!this.companionUrl && localStorage.getItem(SK.companionOk) === this.companionUrl; }

  save({ backend, token, model, koboldUrl, companionUrl, companionCode, companionInfo, consent } = {}) {
    if (backend       != null) localStorage.setItem(SK.backend,   backend);
    if (token         != null) localStorage.setItem(SK.token,     token);
    if (model         != null) localStorage.setItem(SK.model,     model);
    if (koboldUrl     != null) localStorage.setItem(SK.koboldUrl, koboldUrl);
    if (companionUrl  != null) localStorage.setItem(SK.companionUrl, normalizeUrl(companionUrl));
    if (companionCode != null) localStorage.setItem(SK.companionCode, companionCode);
    if (companionInfo != null) localStorage.setItem(SK.companionInfo, JSON.stringify(companionInfo));
    if (consent === true)  localStorage.setItem(SK.companionOk, normalizeUrl(companionUrl ?? this.companionUrl));
    if (consent === false) localStorage.removeItem(SK.companionOk);
  }

  isOn() { return this.backend !== 'off'; }

  isConfigured() {
    if (this.backend === 'companion') return this.consented;
    if (this.backend === 'github') return this.token.length > 10;
    if (this.backend === 'kobold') return this.koboldUrl.length > 0;
    return false;
  }

  // Personalities the student may pick. A companion decides its own list.
  attitudes() {
    const info = this.backend === 'companion' ? this.companionInfo : null;
    const names = (info?.attitudes || Object.keys(ATTITUDES)).filter(n => ATTITUDES[n]);
    const preferred = info?.default_attitude && names.includes(info.default_attitude) ? info.default_attitude : names[0];
    return { names, preferred };
  }

  statusLabel() {
    if (this.backend === 'companion') {
      const who = this.companionInfo?.operator;
      return this.isConfigured() ? `🧭 Helper · ${who || this.companionUrl}` : '🧭 Helper · ⚠️ not set up';
    }
    if (this.backend === 'github') {
      return this.isConfigured() ? `🐙 GitHub Models · ${this.model}` : '🐙 GitHub Models · ⚠️ token needed';
    }
    if (this.backend === 'kobold') return `🖥️ KoboldCPP · ${this.koboldUrl}`;
    return 'Off';
  }

  // Ask a companion who runs it and what it allows. Sends nothing about the student.
  async fetchCompanionInfo(url) {
    const base = normalizeUrl(url);
    if (!base) throw new Error('Type the helper\'s address first.');
    if (blockedByBrowser(base)) {
      throw new Error('This page is secure (https), so the browser will not let it reach an http:// address. Ask for the helper\'s https:// address, or open the board from the helper\'s own address instead.');
    }
    let res;
    try {
      res = await fetch(base + '/api/info');
    } catch {
      throw new Error(`Can't reach a helper at ${base}. Check the address and that you are on the right network.`);
    }
    const info = res.ok ? await res.json().catch(() => null) : null;
    if (info?.name !== 'wayfinder-companion') throw new Error(`${base} answered, but it is not a Wayfinder helper.`);
    return info;
  }

  // If this page is being served by a companion (teacher's desktop), return its address.
  async detectLocalCompanion() {
    if (!location.protocol.startsWith('http')) return null;
    const base = normalizeUrl(new URL('.', location.href).href);
    try {
      const res = await fetch(base + '/api/info');
      const info = res.ok ? await res.json() : null;
      return info?.name === 'wayfinder-companion' ? base : null;
    } catch { return null; }
  }

  // attitude: one of ATTITUDES; rules: the student's anchored rules (array of strings)
  async chat({ attitude, rules = [], message }) {
    if (this.backend === 'companion') return this._companionChat(attitude, rules, message);
    const prefix = rules.length
      ? `[ANCHORED RULES - ALWAYS FOLLOW]\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n[/ANCHORED RULES]\n\n`
      : '';
    const systemPrompt = prefix + (ATTITUDES[attitude] || ATTITUDES.supportive).prompt;
    if (this.backend === 'github') return this._githubChat(systemPrompt, message);
    if (this.backend === 'kobold') return this._koboldChat(systemPrompt, message);
    throw new Error('The AI helper is off. Open ⚙️ Settings to turn it on.');
  }

  async _companionChat(attitude, rules, message) {
    if (!this.consented) throw new Error('The helper is not set up yet. Open ⚙️ Settings.');
    let res;
    try {
      res = await fetch(this.companionUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Join-Code': this.companionCode },
        body: JSON.stringify({ message, attitude, rules }),
      });
    } catch {
      throw new Error('Can\'t reach the helper right now. Check your connection, or ask whoever runs it.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The helper had a problem (${res.status}).`);
    return data.reply;
  }

  async _githubChat(systemPrompt, userMessage) {
    if (!this.token) throw new Error('No GitHub token set. Open ⚙️ Settings and add your token.');

    const res = await fetch(ENDPOINT_GITHUB, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`GitHub Models ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  async _koboldChat(systemPrompt, userMessage) {
    const url = this.koboldUrl.replace(/\/$/, '') + ENDPOINT_KOBOLD_SUFFIX;
    const prompt = systemPrompt
      ? `${systemPrompt}\n\nUser: ${userMessage}\nAssistant:`
      : `User: ${userMessage}\nAssistant:`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_length: 512,
        temperature: 0.7,
        stop_sequence: ['\nUser:', '\n###'],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`KoboldCPP ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.results[0].text.trim();
  }
}
