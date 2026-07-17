// Gestion du COMPTE Minecraft officiel : connexion (par token OU par Microsoft en
// device-code), lecture des capes officielles du compte, et activation / masquage via
// l'API officielle api.minecraftservices.com. Uniquement TON compte — jamais un tiers.
//
// Chaîne Microsoft (device code) : Microsoft -> Xbox Live -> XSTS -> Minecraft
// (même flux que le launcher / snipe-mc). L'ID d'application Azure (public client,
// scope XboxLive.signin, approuvé Minecraft via https://aka.ms/mce-reviewappid) est
// fourni par l'utilisateur — le même que Hasu Client.

import { isPng } from './png.js';

const TENANT = 'consumers';
const DEVICECODE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const SCOPE = 'XboxLive.signin offline_access';
const MC = 'https://api.minecraftservices.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function form(url, params) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
}
async function json(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
}

// --- Étape 1 : device code Microsoft ---
export async function requestDeviceCode(clientId) {
  if (!clientId) throw new Error('Azure Client ID manquant (Réglages → Compte Minecraft).');
  const r = await form(DEVICECODE_URL, { client_id: clientId, scope: SCOPE });
  if (!r.ok) throw new Error(deviceCodeError(await r.text().catch(() => '')));
  return r.json(); // { device_code, user_code, verification_uri, interval, expires_in }
}

// Traduit les erreurs Microsoft les plus fréquentes en messages actionnables
// (mappings validés contre l'endpoint live : voir les codes AADSTS).
function deviceCodeError(body) {
  let d = {};
  try { d = JSON.parse(body); } catch {}
  const desc = d.error_description || '';
  if (/AADSTS700016/.test(desc)) return 'Client ID introuvable côté Microsoft : vérifie l’Azure Client ID (Réglages → Compte Minecraft).';
  if (d.error === 'invalid_client' || /AADSTS7000218|AADSTS700025|public client|allowPublicClient/i.test(desc))
    return 'L’app Azure doit autoriser les « public client flows » (device code) : active-le dans le portail Azure (Authentication → Allow public client flows).';
  if (/AADSTS90009|AADSTS70011|AADSTS90014|scope/i.test(desc)) return 'Scope refusé : l’app Azure doit demander « XboxLive.signin ».';
  return 'Microsoft a refusé la demande : ' + (desc ? desc.slice(0, 160) : (d.error || 'erreur inconnue'));
}

// Récupère la texture PNG d'une cape officielle et la renvoie en data URL, pour
// l'afficher dans l'app malgré la CSP stricte du renderer (qui interdit les hôtes
// distants). Anti-SSRF : uniquement les hôtes de textures Mojang, pas de redirection,
// taille bornée, et vraie signature PNG exigée. L'appelant (main) ne passe jamais une
// URL venant du renderer — seulement celle du profil du compte connecté.
export async function fetchCapeTexture(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/(^|\.)minecraft\.net$/i.test(u.hostname)) return null;
  let r;
  try { r = await fetch(u.href, { redirect: 'error' }); } catch { return null; }
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 512 * 1024 || !isPng(buf)) return null;
  return 'data:image/png;base64,' + buf.toString('base64');
}

// Interroge Microsoft jusqu'à validation, puis chaîne jusqu'à Minecraft. isCancelled()
// permet d'interrompre. Renvoie une session { msRefreshToken, accessToken, expiresAt, profile }.
export async function pollDeviceCode(clientId, deviceCode, interval, expiresIn, isCancelled) {
  const deadline = Date.now() + (expiresIn || 900) * 1000;
  let iv = interval || 5;
  while (Date.now() < deadline) {
    if (isCancelled && isCancelled()) throw new Error('Connexion annulée.');
    await sleep(iv * 1000);
    const r = await form(TOKEN_URL, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: deviceCode });
    const data = await r.json();
    if (r.ok) return microsoftToSession(clientId, data);
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { iv += 5; continue; }
    if (data.error === 'expired_token') throw new Error('Code expiré, relance la connexion.');
    throw new Error(`Microsoft : ${data.error_description || data.error}`);
  }
  throw new Error('Délai de connexion dépassé.');
}

async function refreshMs(clientId, refreshToken) {
  const r = await form(TOKEN_URL, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE });
  if (!r.ok) throw new Error(`refresh ${r.status}`);
  return r.json();
}

// --- Étapes 2-4 : Xbox Live -> XSTS -> Minecraft ---
async function xbl(msAccessToken) {
  const r = await json('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  if (!r.ok) throw new Error(`Xbox Live ${r.status}`);
  const d = await r.json();
  return { token: d.Token, uhs: d.DisplayClaims.xui[0].uhs };
}
async function xsts(xblToken) {
  const r = await json('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  if (r.status === 401) {
    const d = await r.json().catch(() => ({}));
    const m = { 2148916233: 'Aucun compte Xbox (crée un profil Xbox).', 2148916238: 'Compte enfant : à ajouter à une famille adulte.' };
    throw new Error(`XSTS refusé : ${m[d.XErr] || d.XErr || 'inconnu'}`);
  }
  if (!r.ok) throw new Error(`XSTS ${r.status}`);
  const d = await r.json();
  return { token: d.Token, uhs: d.DisplayClaims.xui[0].uhs };
}
async function mcLogin(uhs, xstsToken) {
  const r = await json(`${MC}/authentication/login_with_xbox`, { identityToken: `XBL3.0 x=${uhs};${xstsToken}` });
  if (r.status === 403) throw new Error('login_with_xbox 403 : l’app Azure doit être approuvée pour Minecraft (https://aka.ms/mce-reviewappid).');
  if (!r.ok) throw new Error(`login_with_xbox ${r.status}`);
  return r.json(); // { access_token, expires_in }
}
async function msToMinecraft(msAccessToken) {
  const a = await xbl(msAccessToken);
  const b = await xsts(a.token);
  const mc = await mcLogin(b.uhs, b.token);
  const profile = await getProfile(mc.access_token);
  return { accessToken: mc.access_token, expiresAt: Date.now() + (mc.expires_in - 60) * 1000, profile };
}
async function microsoftToSession(clientId, msTok) {
  const s = await msToMinecraft(msTok.access_token);
  return { msRefreshToken: msTok.refresh_token || null, ...s };
}

// Rafraîchit une session Microsoft expirée (si refresh token dispo).
export async function refreshSession(clientId, msRefreshToken) {
  const msTok = await refreshMs(clientId, msRefreshToken);
  return microsoftToSession(clientId, msTok);
}

// --- Profil & capes officielles ---
export async function getProfile(accessToken) {
  const r = await fetch(`${MC}/minecraft/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (r.status === 404) return null; // pas de profil Java (Minecraft non acheté)
  if (r.status === 401) throw new Error('Token Minecraft invalide ou expiré — reconnecte-toi.');
  if (!r.ok) throw new Error(`profile ${r.status}`);
  return r.json(); // { id, name, skins, capes:[{id,state,url,alias}] }
}
export async function setActiveCape(accessToken, capeId) {
  const r = await fetch(`${MC}/minecraft/profile/capes/active`, {
    method: 'PUT', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ capeId }),
  });
  if (r.status === 401) throw new Error('Token invalide — reconnecte-toi.');
  if (!r.ok) throw new Error(`activation cape ${r.status}`);
  return r.json();
}
export async function hideCape(accessToken) {
  const r = await fetch(`${MC}/minecraft/profile/capes/active`, {
    method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` },
  });
  if (r.status === 401) throw new Error('Token invalide — reconnecte-toi.');
  if (!r.ok && r.status !== 200) throw new Error(`masquage cape ${r.status}`);
  return getProfile(accessToken);
}

// Connexion par token direct : valide en lisant le profil.
export async function loginWithToken(accessToken) {
  const profile = await getProfile(accessToken);
  if (!profile) throw new Error('Token valide mais aucun profil Java (Minecraft non acheté ?).');
  return { accessToken, expiresAt: null, msRefreshToken: null, profile };
}
