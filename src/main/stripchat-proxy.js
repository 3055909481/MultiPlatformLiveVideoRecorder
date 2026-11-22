'use strict'

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import {app} from 'electron'
import {getGatewayExchangeServerPort} from '../helper'

// 社区维护的 Mouflon pkey->pdkey 密钥库（多个来源，任一可用即可）
const KEY_SOURCES = [
  'https://raw.githubusercontent.com/kesamom/stripchat_mouflon/main/stripchat_mouflon_keys.json'
]
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

let keys = {}
let keysLoaded = false

function keysFile () {
  return path.join(app.getPath('userData'), 'stripchat-mouflon-keys.json')
}

function loadLocalKeys () {
  try {
    const file = keysFile()
    if (fs.existsSync(file)) {
      keys = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch (e) {
    // 忽略
  }
}

function saveLocalKeys () {
  try {
    fs.writeFileSync(keysFile(), JSON.stringify(keys))
  } catch (e) {
    // 忽略
  }
}

/**
 * 从社区源同步密钥（异步、容错），失败时用本地缓存
 */
async function syncKeys () {
  for (const source of KEY_SOURCES) {
    try {
      const res = await axios.get(source, {timeout: 10000, headers: {'User-Agent': BROWSER_UA}})
      if (res.data && typeof res.data === 'object') {
        let changed = false
        for (const [k, v] of Object.entries(res.data)) {
          if (typeof v === 'string' && (!keys[k] || keys[k] !== v)) {
            keys[k] = v
            changed = true
          }
        }
        if (changed) saveLocalKeys()
        keysLoaded = true
        return
      }
    } catch (e) {
      // 换下一个源
    }
  }
}

function ensureKeys () {
  if (!keysLoaded) loadLocalKeys()
  // 后台异步同步，不阻塞
  syncKeys()
}

/**
 * 检查某个 pkey 是否有解密密钥；没有时尝试重新同步一次（应对 Stripchat 轮换 pkey）
 */
async function ensureKeyFor (pkey) {
  if (!pkey) return false
  if (keys[pkey]) return true
  // 本地没有 -> 强制重新拉取社区密钥库
  await syncKeys()
  return !!keys[pkey]
}

// 日志（写入 userData，便于诊断断流原因）
function logLine (msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`
    fs.appendFileSync(path.join(app.getPath('userData'), 'stripchat-proxy.log'), line)
  } catch (e) {
    // 忽略
  }
}

/**
 * 解密 Mouflon v2 的加密分片名：
 * 反转 -> base64解码(补==) -> SHA256(pdkey) 循环 XOR
 */
function decryptSegmentName (encoded, pdkey) {
  try {
    const reversed = encoded.split('').reverse().join('')
    const buf = Buffer.from(reversed + '==', 'base64')
    const key = crypto.createHash('sha256').update(pdkey, 'utf8').digest()
    const out = Buffer.alloc(buf.length)
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length]
    return out.toString('utf8')
  } catch (e) {
    return null
  }
}

/**
 * 从 m3u8 文本里解析 pkey（#EXT-X-MOUFLON:PSCH:v2:{pkey}）和加密分片行
 */
async function rewritePlaylist (m3u8Text, sourceUrl) {
  const lines = m3u8Text.split(/\r?\n/)
  let pkey = ''
  const pkeyMatch = /#EXT-X-MOUFLON:PSCH:v2:([A-Za-z0-9]+)/.exec(m3u8Text)
  if (pkeyMatch) pkey = pkeyMatch[1]
  // 确保该 pkey 有密钥，没有则现场重新同步（关键：应对 pkey 轮换导致的断流）
  const hasKey = await ensureKeyFor(pkey)
  const pdkey = hasKey ? keys[pkey] : ''
  if (!hasKey && pkey) logLine(`WARN 缺少 pkey=${pkey} 的解密密钥，分片将无法还原`)

  const out = []
  let decryptedCount = 0
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MOUFLON:URI:')) {
      // 真实分片 URL 藏在 MOUFLON:URI 里，解密后作为普通分片输出
      const uri = line.slice('#EXT-X-MOUFLON:URI:'.length)
      if (pdkey) {
        const parts = uri.split('_')
        const enc = parts[parts.length - 2]
        const dec = decryptSegmentName(enc, pdkey)
        if (dec) {
          out.push(uri.replace(enc, dec))
          decryptedCount++
          continue
        }
      }
      // 无密钥时跳过该占位行
      continue
    }
    // 跳过占位分片行（media.mp4，路径前缀可能是 b-hls-16 等任意子目录）与 MOUFLON 标签。
    // 关键：如果不删这些占位行，ffmpeg 会在每个真实分片后尝试下载无效的 media.mp4(404) 导致断流。
    const trimmed = line.trim()
    if (/\/media\.mp4(\?|$)/.test(trimmed)) continue
    if (trimmed.endsWith('/media.mp4')) continue
    if (line.startsWith('#EXT-X-MOUFLON:FILE:')) continue
    out.push(line)
  }

  return {text: out.join('\n'), pkey, hasKey: !!pdkey, decryptedCount}
}

/**
 * 注册 Stripchat m3u8 解密代理路由
 * ffmpeg 请求: http://127.0.0.1:{port}/gateway/stripchat/m3u8?url=<encoded>
 */
function registerStripchatRoutes (server) {
  ensureKeys()

  server.get('/gateway/stripchat/m3u8', async (req, res) => {
    const target = req.query.url
    if (!target || !/^https?:\/\//i.test(target) || !/doppiocdn\.(com|org|net|live)/i.test(target)) {
      res.status(400).send('Invalid target')
      return
    }
    try {
      // 上游偶发 403/5xx 时限流重试，避免直接断流（最多3次）
      let upstream = null
      let lastStatus = 0
      for (let attempt = 0; attempt < 3; attempt++) {
        upstream = await axios.get(target, {
          timeout: 15000,
          headers: {'User-Agent': BROWSER_UA, Referer: 'https://stripchat.com/'},
          maxRedirects: 5,
          validateStatus: () => true
        })
        lastStatus = upstream.status
        if (upstream.status === 200) break
        logLine(`上游返回 ${upstream.status}，第 ${attempt + 1} 次重试: ${target.slice(0, 80)}`)
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
      }
      if (lastStatus !== 200) {
        logLine(`上游最终失败 status=${lastStatus}，返回502`)
        res.status(502).send('Upstream status ' + lastStatus)
        return
      }
      const rewritten = await rewritePlaylist(upstream.data, target)
      if (rewritten.decryptedCount === 0 && /MOUFLON:URI/.test(upstream.data)) {
        logLine(`WARN 播放列表有加密分片但0个被解密（pkey=${rewritten.pkey}），ffmpeg可能断流`)
      }
      res.set('Content-Type', 'application/vnd.apple.mpegurl')
      res.set('Cache-Control', 'no-cache')
      res.send(rewritten.text)
    } catch (e) {
      logLine(`代理异常: ${e.message}`)
      res.status(502).send(e.message || 'Proxy error')
    }
  })

  // 手动刷新密钥的接口
  server.post('/gateway/stripchat/refresh-keys', async (req, res) => {
    await syncKeys()
    res.json({count: Object.keys(keys).length})
  })
}

function proxyUrl (target) {
  return `http://127.0.0.1:${getGatewayExchangeServerPort()}/gateway/stripchat/m3u8?url=${encodeURIComponent(target)}`
}

export {registerStripchatRoutes, proxyUrl, syncKeys, keysFile}
