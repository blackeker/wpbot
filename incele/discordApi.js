import axios from 'axios';

const DISCORD_API_BASE = 'http://127.0.0.1:8181';

export async function getDiscordCaptchas() {
  const res = await axios.get(`${DISCORD_API_BASE}/api/captcha`);
  return res.data;
}

export async function solveDiscordCaptcha(payload) {
  const res = await axios.post(`${DISCORD_API_BASE}/api/control/solve`, payload);
  return res.data;
}

export async function getDiscordStatus() {
  const res = await axios.get(`${DISCORD_API_BASE}/api/status`);
  return res.data;
}

export async function controlMainBot(action) {
  const res = await axios.post(`${DISCORD_API_BASE}/api/control/main`, { action });
  return res.data;
}

export async function controlAltBots(action) {
  const res = await axios.post(`${DISCORD_API_BASE}/api/control/alts`, { action });
  return res.data;
}

export async function updateSystemSettings(type, enabled) {
  const res = await axios.post(`${DISCORD_API_BASE}/api/settings/system`, { type, enabled });
  return res.data;
}

export async function checkBans() {
  const res = await axios.post(`${DISCORD_API_BASE}/api/control/ban-check`);
  return res.data;
}

export async function getBans() {
  const res = await axios.get(`${DISCORD_API_BASE}/api/bans`);
  return res.data;
}

export async function addSpamCommand(payload) {
  const res = await axios.post(`${DISCORD_API_BASE}/api/commands`, payload);
  return res.data;
}

export async function deleteSpamCommand(type, index) {
  const res = await axios.delete(`${DISCORD_API_BASE}/api/commands/${type}/${index}`);
  return res.data;
}

export async function triggerPotato() {
  const res = await axios.post(`${DISCORD_API_BASE}/api/control/potato`);
  return res.data;
}
