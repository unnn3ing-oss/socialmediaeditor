import { ensureSettings } from '../core/once.js';
import { WARNINGS } from '../../ui/warning-presets.js';

const KEY = 'warning_presets';

export function validWarnings(groups) {
  if (!Array.isArray(groups) || groups.length > 20) return null;
  const titles = new Set(), items = new Set();
  const result = [];
  for (const row of groups) {
    const group = typeof row?.group === 'string' ? row.group.trim() : '';
    if (!group || [...group].length > 40 || /[\r\n]/.test(group) || titles.has(group) || !Array.isArray(row.items) || !row.items.length) return null;
    titles.add(group);
    const entries = [];
    for (const raw of row.items) {
      const item = typeof raw === 'string' ? raw.trim() : '';
      if (!item || [...item].length > 500 || /[\r\n]/.test(item) || items.has(item) || items.size >= 100) return null;
      items.add(item); entries.push(item);
    }
    result.push({ group, items: entries });
  }
  return result;
}

export async function readWarnings(env) {
  await ensureSettings(env);
  const row = await env.DB.prepare('SELECT v, updated FROM fb_settings WHERE k = ?').bind(KEY).first();
  return row ? { revision: row.updated, groups: JSON.parse(row.v) } : { revision: 0, groups: WARNINGS };
}

export async function saveWarnings(env, groups, revision) {
  await ensureSettings(env);
  const next = Math.max(Date.now(), revision + 1), json = JSON.stringify(groups);
  const result = revision === 0
    ? await env.DB.prepare('INSERT OR IGNORE INTO fb_settings (k, v, updated) VALUES (?, ?, ?)').bind(KEY, json, next).run()
    : await env.DB.prepare('UPDATE fb_settings SET v = ?, updated = ? WHERE k = ? AND updated = ?').bind(json, next, KEY, revision).run();
  return result.meta.changes ? { revision: next, groups } : null;
}
