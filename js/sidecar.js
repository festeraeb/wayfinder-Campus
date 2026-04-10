export class SidecarManager {
  constructor() {
    this.STORAGE_KEY = 'cesarops_sidecar_rules';
    this.rules = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
  }

  addRule(text) {
    if (!text.trim()) return false;
    if (this.rules.includes(text.trim())) return false;
    this.rules.push(text.trim());
    this.save();
    return true;
  }

  clear() {
    this.rules = [];
    this.save();
  }

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.rules));
  }

  getPromptPrefix() {
    if (this.rules.length === 0) return '';
    return `[ANCHORED RULES - ALWAYS FOLLOW]\n${this.rules.map((r, i) => `${i+1}. ${r}`).join('\n')}\n[/ANCHORED RULES]\n\n`;
  }

  getSummary() {
    return this.rules.length > 0 
      ? `✅ ${this.rules.length} active rules` 
      : '📭 No anchored rules yet.';
  }
}
