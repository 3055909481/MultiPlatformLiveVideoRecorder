import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'

function parseInitialState (html) {
  const match = /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/.exec(html)
  if (!match) return null
  try {
    const text = match[1].replace(/undefined/g, 'null')
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

function isLiveRoom (room) {
  if (!room) return false
  if (room.isLiving === true || room.isLiving === 1 || room.living === true || room.living === 1) return true
  const liveStream = room.liveStream || room
  return !!(liveStream.id && String(liveStream.id).trim())
}

function selectRoom (playList, roomId) {
  if (!Array.isArray(playList) || playList.length === 0) return null
  const target = String(roomId || '').trim()
  let candidates = playList
  if (target) {
    const matched = playList.filter(room => room.author && String(room.author.id) === target)
    if (matched.length > 0) candidates = matched
  }
  return candidates.find(room => isLiveRoom(room)) || candidates[0]
}

function resolveTitle (room) {
  if (!room) return ''
  const liveStream = room.liveStream || {}
  const gameInfo = room.gameInfo || {}
  const author = room.author || {}
  for (const value of [room.caption, room.title, liveStream.caption, liveStream.title, gameInfo.name, author.name]) {
    if (value && String(value).trim()) return String(value).trim()
  }
  return ''
}

class KuaishouLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.httpHeaders = {
      'User-Agent': this.pcUserAgent,
      Referer: 'https://live.kuaishou.com/'
    }
  }

  getId (idOrUrl) {
    if (!this.isUrl(idOrUrl)) return idOrUrl
    const match = /https?:\/\/live\.kuaishou\.com\/u\/([^/?#]+)/.exec(idOrUrl)
    return match ? match[1] : idOrUrl
  }

  async getUserInfo (idOrUrl) {
    const roomId = this.getId(idOrUrl)
    const url = `https://live.kuaishou.com/u/${roomId}`
    const res = await HttpUtil.get(url, this.httpHeaders)
    const state = parseInitialState(res.data)
    if (!state || !state.liveroom || !Array.isArray(state.liveroom.playList)) {
      throw new Error('获取快手直播间信息失败')
    }
    const room = selectRoom(state.liveroom.playList, roomId)
    const name = (room && room.author && room.author.name) || roomId
    return {
      id: roomId,
      idShow: roomId,
      name,
      roomId: (room && room.author && room.author.id) || roomId
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const roomId = user.roomId || user.id
    const url = `https://live.kuaishou.com/u/${roomId}`
    const res = await HttpUtil.get(url, this.httpHeaders)
    const state = parseInitialState(res.data)
    if (!state || !state.liveroom || !Array.isArray(state.liveroom.playList)) {
      throw new Error('获取快手直播间信息失败')
    }
    const room = selectRoom(state.liveroom.playList, roomId)
    if (!room || !isLiveRoom(room)) return null

    const liveStream = room.liveStream || room
    const playUrls = liveStream.playUrls
    if (!playUrls) return null

    // 从 h264 adaptationSet 里提取清晰度
    let qualityMap = {}
    try {
      const representations = playUrls.h264.adaptationSet.representation
      for (const rep of representations) {
        if (rep.url) qualityMap[String(rep.level !== undefined ? rep.level : rep.name)] = rep.url
      }
    } catch (e) {
      // 结构变化时降级为单地址
    }
    if (Object.keys(qualityMap).length === 0 && typeof playUrls === 'string') {
      qualityMap = {default: playUrls}
    }

    // 快手清晰度 level 是数字，映射到我们的配置
    const availableLevels = Object.keys(qualityMap)
    const qualityCodes = availableLevels.map(level => {
      const num = Number(level)
      if (num >= 1080 || /蓝光|原画|1080/.test(level)) return 'YG'
      if (num >= 720 || /高清|720/.test(level)) return 'GQ'
      return 'BQ'
    })
    const realQuality = LivePlatform.getPreference('code', 'orderIndex', KuaishouLivePlatform.defaultConfig.qualities, qualityCodes, preferenceQuality.code)
    if (!realQuality) throw new Error('无可用清晰度')

    // 选定清晰度对应的 URL：优先按 code 反查 level
    let streamUrl = null
    for (let i = 0; i < qualityCodes.length; i++) {
      if (qualityCodes[i] === realQuality.code) {
        streamUrl = qualityMap[availableLevels[i]]
        break
      }
    }
    streamUrl = streamUrl || qualityMap[availableLevels[availableLevels.length - 1]]
    if (!streamUrl) throw new Error('无可用清晰度')

    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${this.pcUserAgent}\r\nReferer: https://live.kuaishou.com/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy'
      },
      title: resolveTitle(room) || user.name,
      quality: realQuality,
      channel: preferenceChannel
    }
  }
}

KuaishouLivePlatform.getUserRoomOrHomeUrl = function (user) {
  return 'https://live.kuaishou.com/u/' + user.id
}

KuaishouLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/live\.kuaishou\.com\/u\/.+/.test(url)
}

KuaishouLivePlatform.platformInfo = {
  code: 'kuaishou',
  name: '快手直播',
  website: 'https://live.kuaishou.com'
}
KuaishouLivePlatform.defaultConfig = {
  qualities: [
    {code: 'BQ', name: '标清', value: 'BQ', orderIndex: 1},
    {code: 'GQ', name: '高清', value: 'GQ', orderIndex: 2},
    {code: 'YG', name: '蓝光/原画', value: 'YG', orderIndex: 3}
  ],
  channels: [
    {code: 'DEFAULT', name: '默认线路', value: null, orderIndex: 1}
  ],
  defaultQualityCode: 'YG',
  defaultChannelCode: 'DEFAULT',
  idPlaceholder: '请输入快手直播间地址或房间ID',
  dynamicRoomId: false
}
export default KuaishouLivePlatform
