import HuyaLivePlatform from './HuyaLivePlatform'
import DouyuLivePlatform from './DouyuLivePlatform'
import DouyinLivePlatform from './DouyinLivePlatform'
import BilibiliLivePlatform from './BilibiliLivePlatform'

export default {
  platforms: [
    DouyuLivePlatform,
    HuyaLivePlatform,
    DouyinLivePlatform,
    BilibiliLivePlatform
  ],
  getPlatform: function (platformCode) {
    for (const platform of this.platforms) {
      if (platform.platformInfo.code === platformCode) {
        return platform
      }
    }
    return null
  },
  /**
   * 根据链接自动识别所属直播平台
   */
  detectPlatformByUrl: function (url) {
    if (!url || !/^https?:\/\//i.test(url)) return null
    for (const platform of this.platforms) {
      if (typeof platform.isSupportedUrl === 'function' && platform.isSupportedUrl(url)) {
        return platform
      }
    }
    return null
  }
}
