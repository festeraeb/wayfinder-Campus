// AI Backend module for Wayfinder 2.0
// Supports: GitHub Models (free, remote) and KoboldCPP (local, teacher/school network)
//
// GitHub Models: OpenAI-compatible API at https://models.inference.ai.azure.com
//   - Uses a free GitHub PAT (Personal Access Token)
//   - Get one at: https://github.com/settings/tokens (no special scopes needed)
//
// KoboldCPP: Local LLM server (teacher's machine or school network)
//   - Default endpoint: http://localhost:5001
//   - Change to e.g. http://192.168.1.50:5001 for a shared school server

const ENDPOINT_GITHUB = 'https://models.inference.ai.azure.com/chat/completions';
const ENDPOINT_KOBOLD_SUFFIX = '/api/v1/generate';

const SK = {
  backend:   'wf_ai_backend',
  token:     'wf_github_token',
  model:     'wf_github_model',
  koboldUrl: 'wf_kobold_url',
};

export const GITHUB_MODELS = [
  { value: 'gpt-4o-mini',                    label: 'GPT-4o Mini (fast, free)' },
  { value: 'gpt-4o',                          label: 'GPT-4o (powerful, free)' },
  { value: 'meta-llama-3-8b-instruct',        label: 'Llama 3 8B (free)' },
  { value: 'Phi-3-mini-128k-instruct',        label: 'Phi-3 Mini (lightweight)' },
  { value: 'Phi-3.5-mini-instruct',           label: 'Phi-3.5 Mini (lightweight+)' },
];

export class AIBackend {
  get backend()   { return localStorage.getItem(SK.backend)   || 'github'; }
  get token()     { return localStorage.getItem(SK.token)     || ''; }
  get model()     { return localStorage.getItem(SK.model)     || 'gpt-4o-mini'; }
  get koboldUrl() { return localStorage.getItem(SK.koboldUrl) || 'http://localhost:5001'; }

  save({ backend, token, model, koboldUrl } = {}) {
    if (backend   != null) localStorage.setItem(SK.backend,   backend);
    if (token     != null) localStorage.setItem(SK.token,     token);
    if (model     != null) localStorage.setItem(SK.model,     model);
    if (koboldUrl != null) localStorage.setItem(SK.koboldUrl, koboldUrl);
  }

  isConfigured() {
    if (this.backend === 'github') return this.token.length > 10;
    if (this.backend === 'kobold') return this.koboldUrl.length > 0;
    return false;
  }

  statusLabel() {
    if (this.backend === 'github') {
      return this.isConfigured()
        ? `🐙 GitHub Models · ${this.model}`
        : '🐙 GitHub Models · ⚠️ token needed';
    }
    return `🖥️ KoboldCPP · ${this.koboldUrl}`;
  }

  async chat(systemPrompt, userMessage) {
    if (this.backend === 'github') return this._githubChat(systemPrompt, userMessage);
    if (this.backend === 'kobold') return this._koboldChat(systemPrompt, userMessage);
    throw new Error('No AI backend selected.');
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
