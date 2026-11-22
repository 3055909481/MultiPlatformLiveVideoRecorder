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
function rewritePlaylist (m3u8Text, sourceUrl) {
  const lines = m3u8Text.split(/\r?\n/)
  let pkey = ''
  const pkeyMatch = /#EXT-X-MOUFLON:PSCH:v2:([A-Za-z0-9]+)/.exec(m3u8Text)
  if (pkeyMatch) pkey = pkeyMatch[1]
  const pdkey = pkey ? keys[pkey] : ''

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
    // 跳过占位分片行（media.mp4）与 MOUFLON 标签
    if (line.trim() === 'https://media-hls.doppiocdn.com/media.mp4') continue
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
      const upstream = await axios.get(target, {
        timeout: 15000,
        headers: {'User-Agent': BROWSER_UA, Referer: 'https://stripchat.com/'},
        maxRedirects: 5,
        validateStatus: () => true
      })
      if (upstream.status !== 200) {
        res.status(502).send('Upstream status ' + upstream.status)
        return
      }
      const rewritten = rewritePlaylist(upstream.data, target)
      res.set('Content-Type', 'application/vnd.apple.mpegurl')
      res.set('Cache-Control', 'no-cache')
      res.send(rewritten.text)
    } catch (e) {
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
