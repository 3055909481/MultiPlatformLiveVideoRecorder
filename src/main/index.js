'use strict'

import {app, BrowserWindow, Menu, Tray} from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import express from 'express'
import bodyParser from 'body-parser'
import axios from 'axios'

import IpcMainUtil from '../helper/ipcMainUtil'
import IpcChannel from '../helper/IpcChannel'
import {getAppName, getGatewayExchangeServerPort} from '../helper'
const safeUrl = require('../helper/safe-url')
/**
 * Set `__static` path to static files in production
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-static-assets.html
 */
global.__static = process.env.NODE_ENV === 'development'
  ? path.join(__dirname, '../../static')
  : path.join(__dirname, '/static').replace(/\\/g, '\\\\')
// 全局错误捕捉
const errorHandler = (err) => {
  console.error('uncaught', err)
  fs.writeFileSync(`uncaught-${Date.now()}.log`, err.stack)
}
process.on('uncaughtException', errorHandler)
process.on('unhandledRejection', errorHandler)

let mainWindow
let tray = null
const winURL = process.env.NODE_ENV === 'development'
  ? `http://localhost:9080`
  : `file://${__dirname}/index.html`
// 单例模式（Electron >= 4 的 API）
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// 本地代理的启动令牌，renderer 进程通过环境变量继承
process.env.MPLVR_GATEWAY_TOKEN = crypto.randomBytes(24).toString('hex')

/**
 * 斗鱼签名代码是动态混淆的，放到无 Node 权限的隐藏窗口里执行，
 * 避免在主进程/renderer 里运行不可信脚本。
 */
function evaluateDouyuSign (rid, code, did, t10) {
  return new Promise(resolve => {
    let done = false
    let timer = null
    let win = null
    const finish = (success, data) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      if (win && !win.isDestroyed()) win.destroy()
      IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyuSignReply, rid, success, data)
    }
    timer = setTimeout(() => finish(false, null), 20000)
    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          enableRemoteModule: false
        }
      })
      win.loadURL('about:blank').then(async () => {
        const cryptoSource = fs.readFileSync(path.join(global.__static, 'crypto-js.js'), 'utf8')
        await win.webContents.executeJavaScript(cryptoSource)
        const result = await win.webContents.executeJavaScript(
          `${code}\n;ub98484234(${JSON.stringify(rid)},${JSON.stringify(did)},${JSON.stringify(t10)})`
        )
        finish(true, result)
      }).catch(() => finish(false, null))
    } catch (e) {
      finish(false, null)
    }
  })
}

/**
 * 抖音直播页现在把流地址藏在 RSC/HTML 中，直接从 DOM 文本里提取清晰度映射。
 * 该函数会被序列化后在隐藏窗口里执行，不能引用外部变量。
 */
function extractDouyinStreamsFromDom () {
  const html = document.documentElement.outerHTML || ''
  const re = /["\\]+(FULL_HD1|HD1|SD1|SD2)["\\]+\s*[:=]\s*["\\]+(https?:\/\/[^"\\]+)/g
  const result = {}
  let match
  while ((match = re.exec(html)) !== null) {
    result[match[1]] = match[2]
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&')
  }
  return JSON.stringify(result)
}

const douyinStreamScript = '(' + extractDouyinStreamsFromDom.toString() + ')()'

function createWindow () {
  /**
   * Initial window options
   */
  mainWindow = new BrowserWindow({
    height: 830,
    useContentSize: true,
    width: 1680,
    show: false,
    icon: path.join(__dirname, 'static/icon32.ico'),
    webPreferences: {
      // 恢复同源策略；所有跨域请求改走带令牌的主进程代理
      webSecurity: true,
      // 本应用依赖 remote/fs/fluent-ffmpeg，renderer 需要 Node 能力
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  })
  mainWindow.appTray = tray
  // mainWindow.setMenu(null)
  // 打开开发者工具（调试使用）
  // mainWindow.webContents.openDevTools()
  mainWindow.loadURL(winURL)

  mainWindow.on('ready-to-show', () => {
    mainWindow.setTitle(getAppName())
    // mainWindow.webContents.openDevTools()
    mainWindow.show()
  })
  mainWindow.on('close', event => {
    event.preventDefault()
    // 有正在进行中的任务，询问是否停止后关闭，关闭过程交由Renderer
    IpcMainUtil.stopAllTasks()
  })
  mainWindow.on('closed', () => {
    tray = null
    mainWindow = null
  })
  // 斗鱼动态签名（浏览器沙箱内执行）
  IpcMainUtil.on(IpcChannel.getDouyuSign, async (event, rid, code, did, t10) => {
    await evaluateDouyuSign(rid, code, did, t10)
  })

  // 抖音过验证码弹窗
  let browserWindow
  // 接收renderer事件，抖音获取房间信息
  IpcMainUtil.on(IpcChannel.getDouyinRoomData, async (event, url) => {
    try {
      if (browserWindow && !browserWindow.destroyed()) {
        // 已有窗口打开, 销毁
        IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyinRoomDataReply, url, false)
        browserWindow.destroy()
        browserWindow = null
      }
      let failed = true
      let hasSetShowWindowDelay = false
      browserWindow = new BrowserWindow({
        parent: mainWindow,
        height: 500,
        width: 800,
        show: false,
        // 该窗口会加载第三方页面：禁用 Node 与远程模块
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          enableRemoteModule: false
        }
      })
      browserWindow.loadURL(url)
      browserWindow.webContents.on('dom-ready', () => {
        // 页面刷新会触发
        browserWindow.webContents
          .executeJavaScript(douyinStreamScript, true).then((result) => {
            const streamMap = result && result !== '{}' ? result : false
            if (!streamMap) {
              if (!hasSetShowWindowDelay) {
                setTimeout(() => {
                  // 未直接获取到房间信息，显示窗口
                  if (failed && browserWindow && !browserWindow.destroyed()) {
                    browserWindow.show()
                  }
                }, 4000)
                hasSetShowWindowDelay = true
              }
            } else {
              IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyinRoomDataReply, url, true, streamMap)
              if (browserWindow) {
                browserWindow.destroy()
                browserWindow = null
              }
              failed = false
            }
          })
      })
      browserWindow.on('close', (closeEvent) => {
        closeEvent.preventDefault()
        browserWindow.webContents.executeJavaScript(douyinStreamScript, true).then((result) => {
          if (result && result !== '{}') {
            IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyinRoomDataReply, url, true, result)
          } else {
            IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyinRoomDataReply, url, false)
          }
          if (browserWindow) {
            browserWindow.destroy()
            browserWindow = null
          }
          failed = false
        })
      })
      // 超时未响应关闭窗口，返回失败,6秒
      await new Promise(resolve => {
        setTimeout(() => {
          if (failed && browserWindow) {
            browserWindow.destroy()
            browserWindow = null
          }
          IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyinRoomDataReply, url, false)
          resolve()
        }, 60000)
      })
    } catch (e) {
      IpcMainUtil.sendToRenderer(mainWindow, IpcChannel.getDouyinRoomDataReply, url, false)
    }
  })
}

function createTray () {
  tray = new Tray(path.join(__static, getTrayImageFileName()))
  let menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏 窗口',
      click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(getAppName())
  tray.on('click', () => mainWindow.show())
}

function getTrayImageFileName () {
  switch (process.platform) {
    case 'win32':
      return 'tray.ico'
    case 'darwin':
    case 'linux':
    default:
      return 'tray.png'
  }
}

/**
 * 手动跟随重定向，确保每一跳都经过目标地址校验，避免公网地址跳转到内网
 */
async function requestSafe (config, redirectsLeft = 3) {
  const res = await axios.request({...config, maxRedirects: 0, validateStatus: () => true})
  const status = res.status
  const location = res.headers && res.headers.location
  if (location && [301, 302, 303, 307, 308].includes(status)) {
    if (redirectsLeft <= 0) throw new Error('Too many redirects')
    const nextUrl = new URL(location, config.url).toString()
    if (!safeUrl.isSafeTargetUrl(nextUrl)) throw new Error('Redirect target not allowed')
    const switchToGet = status === 303 && config.method !== 'get'
    return requestSafe({
      ...config,
      url: nextUrl,
      method: switchToGet ? 'get' : config.method,
      data: switchToGet ? undefined : config.data
    }, redirectsLeft - 1)
  }
  return res
}

function startGatewayExchangeServer () {
  // 内嵌服务支持修改 UA / 携带 Cookie
  const expressServer = express()
  expressServer.use((req, res, next) => {
    // 只允许来自 file:// 页面（Origin: null）的请求
    const origin = req.headers.origin
    if (origin && origin !== 'null' && !origin.startsWith('file://')) {
      res.status(403).send('Forbidden origin')
      return
    }
    res.header('Access-Control-Allow-Origin', 'null')
    res.header('Access-Control-Allow-Methods', 'GET,POST')
    res.header('Access-Control-Allow-Headers', 'Content-Type,X-MPLVR-Token')
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })
  expressServer.use(bodyParser.json({limit: '2mb'}))
  expressServer.post('/gateway/exchange', async (req, res) => {
    if (req.headers['x-mplvr-token'] !== process.env.MPLVR_GATEWAY_TOKEN) {
      res.status(401).send('Unauthorized')
      return
    }
    const config = req.body && req.body.config
    if (!config || typeof config.url !== 'string') {
      res.status(400).send('Invalid request')
      return
    }
    const method = String(config.method || 'get').toLowerCase()
    if (method !== 'get' && method !== 'post') {
      res.status(400).send('Method not allowed')
      return
    }
    if (!safeUrl.isSafeTargetUrl(config.url)) {
      res.status(400).send('Target URL not allowed')
      return
    }
    try {
      const axiosRes = await requestSafe({
        ...config,
        method,
        timeout: 20000,
        validateStatus: () => true
      })
      const responseUrl = axiosRes.request && axiosRes.request.res && axiosRes.request.res.responseUrl
      res.status(200).json({
        status: axiosRes.status,
        statusText: axiosRes.statusText,
        headers: axiosRes.headers,
        data: axiosRes.data,
        responseURL: responseUrl || config.url
      })
    } catch (e) {
      const errorResponse = e.response || {}
      res.status(200).json({
        status: errorResponse.status || 500,
        statusText: e.message,
        headers: errorResponse.headers || {},
        data: errorResponse.data !== undefined ? errorResponse.data : e.message,
        responseURL: config.url,
        error: true
      })
    }
  })
  expressServer.listen(getGatewayExchangeServerPort(), '127.0.0.1')
}

function init () {
  if (tray) {
    // 如果已存在托盘，销毁后再创建
    tray.destroy()
  }
  createTray()
  createWindow()
  startGatewayExchangeServer()
}
// 使用通知必填
app.setAppUserModelId(getAppName())

app.on('ready', init)

app.on('window-all-closed', (e) => {
  if (tray) {
    // 销毁托盘，防止多次启动后关闭未及时销毁
    tray.destroy()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

/**
 * Auto Updater
 *
 * Uncomment the following code below and install `electron-updater` to
 * support auto updating. Code Signing with a valid certificate is required.
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-electron-builder.html#auto-updating
 */

/*
import { autoUpdater } from 'electron-updater'

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall()
})

app.on('ready', () => {
  if (process.env.NODE_ENV === 'production') autoUpdater.checkForUpdates()
})
 */
