<template>
  <common-page>
    <h1 slot="header">{{$route.meta.title}}</h1>
    <el-form slot="main" size="small" label-width="150px" label-position="left">
      <el-form-item>
        <label slot="label">
          自动检查(全局)
        </label>
        <el-switch v-model="globalSettings.enableAutoCheck"></el-switch>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          输出文件夹(默认)
        </label>
        <el-input readonly v-model="globalSettings.defaultOuPutDir"></el-input>
        <el-button type="primary" size="small" @click="chooseDefaultDir">选取</el-button>
        <el-tooltip v-if="!isDefaultOuPutDirApplyToAllRecords" effect="light" content="新增录制时生效" placement="right">
          <em class="el-icon-warning important-help"></em>
        </el-tooltip>
        <br/>
        <el-checkbox v-model="isDefaultOuPutDirApplyToAllRecords">输出文件夹应用到当前所有录制任务</el-checkbox>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          录制历史删除
        </label>
        <el-select v-model="globalSettings.deleteFileWhenDeleteHistory">
          <el-option label="询问是否删除文件" :value="null"/>
          <el-option label="保留录制文件" :value="false"/>
          <el-option label="同时删除录制文件" :value="true"/>
        </el-select>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          哔哩哔哩用户Cookie
        </label>
        <el-input v-model="globalSettings.biliBiliUserCookie" clearable></el-input>
        <el-tooltip effect="light" content="用于获取需要登录的才能获取到的高清晰度视频" placement="right">
          <em class="el-icon-warning important-help"></em>
        </el-tooltip>
      </el-form-item>
      <el-form-item
          prop="fileFormat">
        <label slot="label">
          录制视频输出格式
        </label>
        <el-select v-model="globalSettings.defaultRecordVideoOutputFormat">
          <el-option v-for="format in recordVideoOutputFormats" :key="format" :value="format" :label="format.toUpperCase()"/>
        </el-select>
      </el-form-item>

      <el-form-item label-width="0">
        <div class="settings-section-title">新增录制任务的默认参数</div>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          默认自动检查
        </label>
        <el-switch v-model="globalSettings.defaultAutoCheck"></el-switch>
        <el-tooltip effect="light" content="新增录制任务默认是否自动检测主播开播" placement="right">
          <em class="el-icon-warning important-help"></em>
        </el-tooltip>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          默认检查间隔
        </label>
        <el-select v-model="globalSettings.defaultCheckWindow" :disabled="!globalSettings.defaultAutoCheck">
          <el-option v-for="w in checkWindowOptions" :key="w.value" :label="w.label" :value="w.value"/>
        </el-select>
        <el-tooltip effect="light" content="自动检查时每隔多久检测一次主播是否开播（秒）" placement="right">
          <em class="el-icon-warning important-help"></em>
        </el-tooltip>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          默认自动分片
        </label>
        <el-switch v-model="globalSettings.defaultAutoFragment"></el-switch>
        <el-tooltip effect="light" content="新增录制任务默认是否自动按时间段分片" placement="right">
          <em class="el-icon-warning important-help"></em>
        </el-tooltip>
      </el-form-item>
      <el-form-item>
        <label slot="label">
          默认分片时长
        </label>
        <el-select v-model="globalSettings.defaultFragmentLength" :disabled="!globalSettings.defaultAutoFragment">
          <el-option v-for="f in fragmentLengthOptions" :key="f.value" :label="f.label" :value="f.value"/>
        </el-select>
      </el-form-item>
      <el-form-item label-width="0">
        <el-button type="success" @click="save">保存</el-button>
      </el-form-item>
    </el-form>
  </common-page>
</template>

<script>
import CommonPage from '../../CommonPage'
import {getSettings, saveSettings} from '../../../config/settings'
import LivePlatform from '../../../live-platform/live-platform'
import {remote} from 'electron'
export default {
  name: 'Index',
  components: {CommonPage},
  data () {
    return {
      globalSettings: {
        // 开启全局自动检查，false时录制任务自动检查不生效
        enableAutoCheck: true,
        // 默认输出文件路径，新增时生效
        defaultOuPutDir: null,
        // 删除录制历史时同时删除文件, null 为禁用全局设置
        deleteFileWhenDeleteHistory: null,
        // 哔哩哔哩用户Cookie，用于获取需要登录的才能获取到的高清晰度视频
        biliBiliUserCookie: null,
        // 录制视频文件输出默认格式（仅新增录播生效）
        defaultRecordVideoOutputFormat: null,
        // 新增录制任务默认参数
        // 默认是否自动检查（null 时沿用旧行为 false）
        defaultAutoCheck: false,
        // 默认检查间隔（秒）
        defaultCheckWindow: 10,
        // 默认是否自动分片
        defaultAutoFragment: false,
        // 默认分片时长（秒）
        defaultFragmentLength: 1800
      },
      // 保存进入页面时的设置，用于判断设置是否改变
      oldGlobalSettings: null,
      // 是否已保存设置
      isSave: true,
      // 默认输出文件夹是否应用到所有录制任务，默认false（不应用）
      isDefaultOuPutDirApplyToAllRecords: false,
      recordVideoOutputFormats: LivePlatform.supportVideoOutPutFormats ? Object.keys(LivePlatform.supportVideoOutPutFormats) : [],
      checkWindowOptions: [
        {label: '5秒', value: 5}, {label: '10秒', value: 10}, {label: '15秒', value: 15},
        {label: '20秒', value: 20}, {label: '30秒', value: 30}, {label: '1分钟', value: 60},
        {label: '2分钟', value: 120}, {label: '5分钟', value: 300}, {label: '10分钟', value: 600},
        {label: '30分钟', value: 1800}, {label: '1小时', value: 3600},
        {label: '2小时', value: 7200}, {label: '4小时', value: 14400}
      ],
      fragmentLengthOptions: [
        {label: '30分钟', value: 1800}, {label: '1小时', value: 3600},
        {label: '1小时30分钟', value: 4800}, {label: '2小时', value: 7200}
      ]
    }
  },
  watch: {
    globalSettings: {
      handler () {
        if (JSON.stringify(this.oldGlobalSettings) !== JSON.stringify(this.globalSettings)) {
          // 设置改变了就置为未保存
          this.isSave = false
        }
      },
      deep: true
    }
  },
  beforeRouteEnter (to, from, next) {
    next(vm => {
      getSettings().then(settings => {
        if (settings) {
          vm.globalSettings = settings
          // 不能直接赋值，因为是引用
          vm.oldGlobalSettings = {...settings}
        } else {
          vm.oldGlobalSettings = {...vm.globalSettings}
        }
      }).catch(e => {
        console.log(e)
        vm.$message.error('获取软件设置失败!')
        vm.$router.back()
      })
    })
  },
  beforeRouteLeave (to, from, next) {
    if (JSON.stringify(this.oldGlobalSettings) !== JSON.stringify(this.globalSettings) && !this.isSave) {
      // 设置改变了但没有保存
      this.$confirm('设置未保存，是否保存？', '提示', {
        confirmButtonText: '保存',
        cancelButtonText: '不保存',
        type: 'warning',
        // 区分取消、关闭
        distinguishCancelAndClose: true
      }).then(_ => {
        this.save(_ => {
          next()
        })
      }).catch(action => {
        // 取消才跳转，关闭不跳转
        if (action === 'cancel') {
          next()
        } else {
          next(false)
        }
      })
    } else {
      next()
    }
  },
  methods: {
    chooseDefaultDir () {
      const result = remote.dialog.showOpenDialogSync({
        title: '选择默认输出文件夹',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result && result.length > 0) {
        console.log('选择默认输出文件夹:', result[0])
        this.globalSettings.defaultOuPutDir = result[0]
      }
    },
    save (onSuccess) {
      const settings = {...this.globalSettings}
      delete settings._id
      saveSettings(settings).then(async _ => {
        this.$message.success('保存成功')
        // recordManager更新设置
        this.$manager.recordManager.setGlobalSettings(settings)
        // 保存成功后做的事
        await this.afterSaveSettingsSuccess()
        // 已保存
        this.isSave = true
        if (onSuccess && typeof onSuccess === 'function') {
          // 保存成功调用函数
          onSuccess()
        }
      }).catch(e => {
        this.$message.error('保存失败：' + e.message)
      })
    },
    afterSaveSettingsSuccess () {
      return new Promise(async (resolve, reject) => {
        if (this.isDefaultOuPutDirApplyToAllRecords && this.globalSettings.defaultOuPutDir) {
          await this.applyDefaultOutputDirToAllRecords()
        }
        resolve()
      })
    },
    applyDefaultOutputDirToAllRecords () {
      return new Promise(async (resolve, reject) => {
        // 输出文件夹应用到所有录制任务
        await this.$dbs.record._update_({}, {$set: {'settings.outPutDir': this.globalSettings.defaultOuPutDir}}, {multi: true})
        resolve()
      })
    }
  }
}
</script>

<style scoped>
.el-input {
  max-width: 50%;
}
label {
  font-weight: bold;
  color: black;
}
.el-form {
  margin-left: 30px;
}
.settings-section-title {
  font-weight: bold;
  color: #409eff;
  border-top: 1px solid #ebeef5;
  padding-top: 15px;
  margin-top: 5px;
  width: 50%;
}
</style>
