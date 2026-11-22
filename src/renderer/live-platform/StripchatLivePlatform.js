import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'

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

  buildHeaders (origin, referer, cookie) {
    const headers = {
      'User-Agent': this.userAgent,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en,en-US;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: referer || `${origin}/`,
      Origin: origin,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    }
    if (cookie) headers.Cookie = cookie
    return headers
  }

  /**
   * 先从主播页面获取 Cookie（模拟浏览器会话），再用该 Cookie 请求 API
   */
  async fetchCam (username, origin) {
    origin = origin || 'https://stripchat.com'
    const pageUrl = `${origin}/${username}`
    let cookie = ''
    try {
      const pageRes = await HttpUtil.get(pageUrl, {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en,en-US;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
      })
      // 从响应头提取 set-cookie（axios 可能合并成字符串或数组）
      const setCookie = pageRes.headers && (pageRes.headers['set-cookie'] || pageRes.headers['Set-Cookie'])
      if (setCookie) {
        if (Array.isArray(setCookie)) {
          cookie = setCookie.map(c => String(c).split(';')[0]).join('; ')
        } else {
          cookie = String(setCookie).split(';')[0]
        }
      }
    } catch (e) {
      // 页面访问失败仍尝试直接请求 API
    }

    const apiUrl = `${origin}/api/front/v2/models/username/${username}/cam?uniq=${randomUniq(16)}`
    const res = await HttpUtil.get(apiUrl, this.buildHeaders(origin, pageUrl, cookie))
    const status = res.status
    const data = res.data
    if (status === 403 || status === 418) {
      throw new Error(`Stripchat 拒绝了 API 请求（HTTP ${status}），可能是反爬或地区限制，请检查网络/代理设置`)
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
