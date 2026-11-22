'use strict'

import fs from 'fs'
import path from 'path'
import {app, shell} from 'electron'
import axios from 'axios'
import IpcMainUtil from '../helper/ipcMainUtil'
import IpcChannel from '../helper/IpcChannel'

const RELEASE_API = 'https://api.github.com/repos/3055909481/MultiPlatformLiveVideoRecorder/releases/latest'

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
 * 检查 GitHub 上的最新 Release
 */
async function checkUpdate () {
  const response = await axios.get(RELEASE_API, {
    headers: {'User-Agent': 'MultiPlatformLiveVideoRecorder-Updater'},
    timeout: 15000
  })
  const release = response.data
  const currentVersion = app.getVersion()
  const remoteVersion = release.tag_name || ''
  const asset = (release.assets || []).find(a => /\.exe$/i.test(a.name))

  return {
    hasUpdate: isNewer(remoteVersion, currentVersion),
    currentVersion,
    latestVersion: remoteVersion,
    releaseName: release.name || remoteVersion,
    releaseNotes: release.body || '',
    releaseUrl: release.html_url || '',
    downloadUrl: asset ? asset.browser_download_url : (release.html_url || ''),
    assetName: asset ? asset.name : '',
    assetSize: asset ? asset.size : 0
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

export {checkUpdate, registerUpdateHandlers, openReleasePage, isNewer, parseVersion}
