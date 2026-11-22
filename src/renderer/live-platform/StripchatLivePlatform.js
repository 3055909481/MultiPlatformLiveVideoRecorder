import LivePlatform from './live-platform.js'
import IpcChannel from '../../helper/IpcChannel'
import ipcRendererUtil from '../../helper/ipcRendererUtil'

let fetchTokenSeq = 0

function parseInput (idOrUrl) {
  if (!/^https?:\/\//i.test(idOrUrl)) {
    return {username: idOrUrl, origin: 'https://stripchat.com'}
  }
  const match = /^(https?:\/\/[\w.-]*stripchat\.com)\/([a-zA-Z0-9_-]+)/.exec(idOrUrl)
  if (match) {
    return {username: match[2], origin: match[1]}
  }
  return {username: idOrUrl, origin: 'https://stripchat.com'}
}

function randomUniq (length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

class StripchatLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  /**
   * 用隐藏窗口在真实浏览器上下文里请求 API（绕过 Cloudflare 对 Node.js TLS 指纹的拦截）
   */
  browserFetch (pageUrl, apiUrl) {
    return new Promise((resolve, reject) => {
      const token = `sc_${Date.now()}_${++fetchTokenSeq}`
      const timer = setTimeout(() => {
        ipcRendererUtil.removeListener(IpcChannel.browserFetchReply, listener)
        reject(new Error('浏览器抓取超时'))
      }, 30000)
      const listener = (event, token_, success, result) => {
        if (token_ !== token) return
        clearTimeout(timer)
        ipcRendererUtil.removeListener(IpcChannel.browserFetchReply, listener)
        if (!success) return reject(new Error(result || '浏览器抓取失败'))
        try {
          const parsed = JSON.parse(result)
          resolve(parsed)
        } catch (e) {
          reject(new Error('浏览器抓取结果解析失败'))
        }
      }
      ipcRendererUtil.on(IpcChannel.browserFetchReply, listener)
      ipcRendererUtil.sendToMain(IpcChannel.browserFetch, token, pageUrl, apiUrl)
    })
  }

  /**
   * Stripchat 使用 Cloudflare，Node.js 请求会被 TLS 指纹识别拦截（418），
   * 因此直接用隐藏窗口在真实浏览器里请求。
   */
  async fetchCam (username, origin) {
    origin = origin || 'https://stripchat.com'
    const pageUrl = `${origin}/${username}`
    const apiUrl = `${origin}/api/front/v2/models/username/${username}/cam?uniq=${randomUniq(16)}`

    let status = 0
    let data = null
    let pageTitle = ''
    try {
      const result = await this.browserFetch(pageUrl, apiUrl)
      status = result.status
      pageTitle = result.pageTitle || ''
      try {
        data = JSON.parse(result.body)
      } catch (e) {
        data = null
      }
    } catch (e) {
      throw new Error(`Stripchat 抓取失败：${e.message}`)
    }

    if (status === 403 || status === 418) {
      const challengeHint = /just a moment|attention required|checking|验证/i.test(pageTitle)
        ? '（页面本身被验证页拦截）'
        : '（页面正常但API被拦截）'
      throw new Error(`Stripchat 拒绝访问 HTTP ${status}${challengeHint}${pageTitle ? '，页面标题：' + pageTitle : ''}`)
    }
    if (!data || !data.cam) {
      const msg = data && data.error ? data.error : `HTTP ${status}`
      throw new Error(`获取 Stripchat 房间信息失败（${msg}）`)
    }
    return data
  }

  buildStreamUrls (cam) {
    const streamName = cam.streamName
    const server = cam.viewServers && cam.viewServers['flashphoner-hls']
    const urls = []
    if (streamName) {
      urls.push(`https://edge-hls.doppiocdn.com/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=standard`)
      urls.push(`https://edge-hls.doppiocdn.org/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=standard`)
    }
    if (server && streamName) {
      urls.push(`https://b-${server}.doppiocdn.com/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=standard`)
      urls.push(`https://b-${server}.doppiocdn.com/hls/${streamName}/master/${streamName}.m3u8?playlistType=standard`)
    }
    return urls
  }

  async getUserInfo (idOrUrl) {
    const {username, origin} = parseInput(idOrUrl)
    let name = username
    let namePlaceholder = false
    try {
      const data = await this.fetchCam(username, origin)
      name = (data.user && data.user.user && data.user.user.username) || username
    } catch (e) {
      // 获取失败时降级用用户名占位，不阻断表单填写
      namePlaceholder = true
    }
    return {
      id: username,
      idShow: username,
      name,
      namePlaceholder,
      origin,
      roomId: username
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const username = user.roomId || user.id
    const origin = user.origin || 'https://stripchat.com'
    const data = await this.fetchCam(username, origin)
    const cam = data.cam
    const userStatus = data.user && data.user.user
    const isLive = userStatus && userStatus.isLive === true && userStatus.status === 'public'
    if (!isLive) return null

    const urls = this.buildStreamUrls(cam)
    if (urls.length === 0) return null
    const streamUrl = urls[0]
    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${this.userAgent}\r\nReferer: ${origin}/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy'
      },
      title: cam.topic || user.name,
      quality: StripchatLivePlatform.defaultConfig.qualities[0],
      channel: preferenceChannel,
      backupStreamUrls: urls.slice(1)
    }
  }
}

StripchatLivePlatform.getUserRoomOrHomeUrl = function (user) {
  const origin = user.origin || 'https://stripchat.com'
  return origin + '/' + user.id
}

StripchatLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/(?:\w+\.)?stripchat\.com\/[a-zA-Z0-9_-]+/.test(url)
}

StripchatLivePlatform.platformInfo = {
  code: 'stripchat',
  name: 'Stripchat',
  website: 'https://stripchat.com'
}
StripchatLivePlatform.defaultConfig = {
  qualities: [
    {code: 'AUTO', name: '自动(HLS)', value: 'auto', orderIndex: 1}
  ],
  channels: [
    {code: 'DEFAULT', name: '默认线路', value: null, orderIndex: 1}
  ],
  defaultQualityCode: 'AUTO',
  defaultChannelCode: 'DEFAULT',
  idPlaceholder: '请输入 Stripchat 直播间地址或用户名',
  dynamicRoomId: false
}
export default StripchatLivePlatform
