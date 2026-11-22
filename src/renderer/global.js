import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import fs from 'fs'
import path from 'path'

const Global = {
  init: () => {
    // eslint-disable-next-line no-extend-native
    Date.prototype.Format = function (fmt) {
      let o = {
        'M+': this.getMonth() + 1,
        'd+': this.getDate(),
        'H+': this.getHours(),
        'm+': this.getMinutes(),
        's+': this.getSeconds(),
        'S+': this.getMilliseconds()
      }
      if (/(y+)/.test(fmt)) {
        fmt = fmt.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length))
      }
      for (let k in o) {
        if (new RegExp('(' + k + ')').test(fmt)) {
          fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (('00' + o[k]).substr(String(o[k]).length)))
        }
      }
      return fmt
    }

    // ffmpeg-static 5.x 直接导出路径字符串，旧版本是 { path }
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic && ffmpegStatic.path)
    if (!ffmpegPath) {
      throw new Error('无法定位 ffmpeg 可执行文件')
    }
    // 打包后二进制位于 app.asar.unpacked
    ffmpeg.setFfmpegPath(ffmpegPath.replace('app.asar', 'app.asar.unpacked'))

    // 递归创建目录 同步方法
    fs.mkdirsSync = function (dirname) {
      if (fs.existsSync(dirname)) {
        return true
      } else {
        if (this.mkdirsSync(path.dirname(dirname))) {
          fs.mkdirSync(dirname)
          return true
        }
      }
    }
  }
}
export default Global
