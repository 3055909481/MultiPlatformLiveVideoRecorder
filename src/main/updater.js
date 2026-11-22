'use strict'

import fs from 'fs'
import path from 'path'
import {app, shell} from 'electron'
import axios from 'axios'
import IpcMainUtil from '../helper/ipcMainUtil'
import IpcChannel from '../helper/IpcChannel'

const REPO_BASE = 'https://github.com/3055909481/MultiPlatformLiveVideoRecorder'
const RELEASE_LATEST = `${REPO_BASE}/releases/latest`
const RELEASE_URL = `${REPO_BASE}/releases`

/**
 * 把 "1.2.6-fork.0" 这种版本拆成可比较的数字数组
 */
function parseVersion (version) {
  if (!version) return [0, 0, 0, 0]
  const cleaned = String(version).replace(/^v/i, '')
  // 只保留纯数字段，跳过 fork 之类的非数字标识
  const numbers = cleaned
    .split(/[.-]/)
    .filter(part => /^\d+$/.test(part))
    .map(part => parseInt(part, 10))
  while (numbers.length < 4) numbers.push(0)
  return numbers.slice(0, 4)
}

function isNewer (remote, local) {
  const r = parseVersion(remote)
  const l = parseVersion(local)
  for (let i = 0; i < r.length; i++) {
    if (r[i] > l[i]) return true
    if (r[i] < l[i]) return false
  }
  return false
}

/**
 * 从 releases/latest 响应中解析最新 tag（纯函数，便于测试）
 */
function parseLatestVersion (finalUrl, html) {
  // 优先从重定向后的最终 URL 解析
  const urlMatch = /\/releases\/tag\/([^/?#]+)/.exec(finalUrl || '')
  if (urlMatch) return decodeURIComponent(urlMatch[1])
  // 兜底：从 HTML 的 canonical / og:url 中解析
  const htmlMatch = /\/releases\/tag\/([^"?#<]+)/.exec(html || '')
  return htmlMatch ? decodeURIComponent(htmlMatch[1]) : ''
}

/**
 * 从 expanded_assets 页面解析 exe 下载链接（纯函数，便于测试）
 */
function parseAssetLink (html) {
  const hrefMatch = /href="([^"]*\/releases\/download\/[^"]+\.exe)"/.exec(html || '')
  if (!hrefMatch) return {downloadUrl: '', assetName: ''}
  const downloadUrl = hrefMatch[1].startsWith('http') ? hrefMatch[1] : `https://github.com${hrefMatch[1]}`
  return {downloadUrl, assetName: decodeURIComponent(downloadUrl.split('/').pop())}
}

/**
 * 检查 GitHub 上的最新 Release。
 * 使用普通 releases 页面而非 GitHub API —— API 在共享 IP 下极易触发 403 限流。
 */
async function checkUpdate () {
  const currentVersion = app.getVersion()
  // releases/latest 会 302 到 /releases/tag/{tag}
  const latestResponse = await axios.get(RELEASE_LATEST, {
    headers: {'User-Agent': 'Mozilla/5.0'},
    timeout: 15000,
    maxRedirects: 5
  })
  const finalUrl = (latestResponse.request && latestResponse.request.res && latestResponse.request.res.responseUrl) || ''
  const remoteVersion = parseLatestVersion(finalUrl, latestResponse.data)
  if (!remoteVersion) throw new Error('无法解析最新版本号')

  // 从 expanded_assets 页面拿安装包下载链接（同样是普通页面，不受 API 限流）
  let downloadUrl = ''
  let assetName = ''
  try {
    const assetsResponse = await axios.get(`${REPO_BASE}/releases/expanded_assets/${remoteVersion}`, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 15000
    })
    const parsed = parseAssetLink(assetsResponse.data)
    downloadUrl = parsed.downloadUrl
    assetName = parsed.assetName
  } catch (e) {
    // 资产页失败不影响版本号判断，用户仍可打开发布页手动下载
  }

  return {
    hasUpdate: isNewer(remoteVersion, currentVersion),
    currentVersion,
    latestVersion: remoteVersion,
    releaseName: remoteVersion,
    releaseNotes: '',
    releaseUrl: `${RELEASE_URL}/tag/${remoteVersion}`,
    downloadUrl,
    assetName,
    assetSize: 0
  }
}

/**
 * 下载更新包到临时目录，带进度回调
 */
async function downloadUpdate (downloadUrl, assetName) {
  if (!downloadUrl || /github\.com\/[^/]+\/[^/]+\/releases\/tag\//.test(downloadUrl)) {
    throw new Error('没有找到可下载的更新包')
  }
  const downloadDir = path.join(app.getPath('userData'), 'updates')
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, {recursive: true})
  }
  const fileName = assetName || path.basename(new URL(downloadUrl).pathname) || 'update.exe'
  const target = path.join(downloadDir, fileName)

  const response = await axios.get(downloadUrl, {
    responseType: 'stream',
    timeout: 0,
    headers: {'User-Agent': 'MultiPlatformLiveVideoRecorder-Updater'}
  })
  const total = Number(response.headers['content-length']) || 0
  let received = 0

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(target)
    response.data.on('data', chunk => {
      received += chunk.length
      const percent = total ? Math.round((received / total) * 100) : 0
      IpcMainUtil.sendToAll(IpcChannel.downloadUpdateProgress, percent, received, total)
    })
    response.data.on('error', reject)
    writer.on('error', reject)
    writer.on('finish', resolve)
    response.data.pipe(writer)
  })
  return target
}

/**
 * 运行安装包（Windows NSIS 静默安装）
 */
function installUpdate (filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('更新包不存在')
  const {spawn} = require('child_process')
  const child = spawn(filePath, ['/S', '--force-run-in-context'], {detached: true, stdio: 'ignore'})
  child.unref()
  return true
}

function openReleasePage (url) {
  if (url) shell.openExternal(url)
}

function registerUpdateHandlers () {
  IpcMainUtil.on(IpcChannel.checkUpdate, async () => {
    try {
      const result = await checkUpdate()
      IpcMainUtil.sendToAll(IpcChannel.checkUpdateReply, true, result)
    } catch (e) {
      IpcMainUtil.sendToAll(IpcChannel.checkUpdateReply, false, {message: e.message || '检查更新失败'})
    }
  })

  IpcMainUtil.on(IpcChannel.downloadUpdate, async (event, downloadUrl, assetName) => {
    try {
      const filePath = await downloadUpdate(downloadUrl, assetName)
      IpcMainUtil.sendToAll(IpcChannel.downloadUpdateReply, true, filePath)
    } catch (e) {
      IpcMainUtil.sendToAll(IpcChannel.downloadUpdateReply, false, {message: e.message || '下载更新失败'})
    }
  })

  IpcMainUtil.on(IpcChannel.installUpdate, (event, filePath) => {
    try {
      installUpdate(filePath)
      app.quit()
    } catch (e) {
      IpcMainUtil.sendToAll(IpcChannel.downloadUpdateReply, false, {message: e.message || '安装更新失败'})
    }
  })
}

export {checkUpdate, registerUpdateHandlers, openReleasePage, isNewer, parseVersion, parseLatestVersion, parseAssetLink}
