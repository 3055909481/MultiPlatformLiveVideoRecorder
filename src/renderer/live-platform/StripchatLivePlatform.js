import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'

function extractUsername (idOrUrl) {
  if (!/^https?:\/\//i.test(idOrUrl)) return idOrUrl
  const match = /https?:\/\/(?:\w+\.)?stripchat\.com\/([a-zA-Z0-9_-]+)/.exec(idOrUrl)
  return match ? match[1] : idOrUrl
}

class StripchatLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.httpHeaders = {
      'User-Agent': this.pcUserAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://stripchat.com/',
      Accept: 'application/json'
    }
  }

  async fetchCam (username) {
    const url = `https://stripchat.com/api/front/v2/models/username/${username}/cam`
    const res = await HttpUtil.get(url, Object.assign({}, this.httpHeaders, {Referer: `https://stripchat.com/${username}`}))
    const data = res.data
    if (!data || !data.cam) throw new Error('获取 Stripchat 房间信息失败')
    return data
  }

  buildStreamUrls (cam) {
    const streamName = cam.streamName
    const server = cam.viewServers && cam.viewServers['flashphoner-hls']
    const urls = []
    if (server && streamName) {
      urls.push(`https://b-${server}.doppiocdn.com/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=standard`)
      urls.push(`https://b-${server}.doppiocdn.com/hls/${streamName}/master/${streamName}.m3u8?playlistType=standard`)
    }
    if (streamName) {
      urls.push(`https://edge-hls.doppiocdn.com/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=standard`)
      urls.push(`https://edge-hls.doppiocdn.org/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=standard`)
    }
    return urls
  }

  async getUserInfo (idOrUrl) {
    const username = extractUsername(idOrUrl)
    const data = await this.fetchCam(username)
    const name = (data.user && data.user.user && data.user.user.username) || username
    return {
      id: username,
      idShow: username,
      name,
      roomId: username
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const username = user.roomId || user.id
    const data = await this.fetchCam(username)
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
        '-headers': `User-Agent: ${this.pcUserAgent}\r\nReferer: https://stripchat.com/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy'
      },
      title: cam.topic || user.name,
      quality: StripchatLivePlatform.defaultConfig.qualities[0],
      channel: preferenceChannel,
      // 保存备用线路，主线路失败时可切换
      backupStreamUrls: urls.slice(1)
    }
  }
}

StripchatLivePlatform.getUserRoomOrHomeUrl = function (user) {
  return 'https://stripchat.com/' + user.id
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
