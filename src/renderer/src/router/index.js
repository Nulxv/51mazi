import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/auth',
    name: 'Auth',
    component: () => import('@renderer/views/Auth.vue')
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('@renderer/views/Home.vue')
  },
  {
    path: '/editor',
    name: 'Editor',
    component: () => import('@renderer/views/Editor.vue')
  },
  {
    path: '/timeline',
    name: 'Timeline',
    component: () => import('@renderer/views/Timeline.vue')
  },
  {
    path: '/character-profile',
    name: 'CharacterProfile',
    component: () => import('@renderer/views/CharacterProfile.vue')
  },
  {
    path: '/dictionary',
    name: 'Dictionary',
    component: () => import('@renderer/views/Dictionary.vue')
  },
  {
    path: '/setting-manager',
    name: 'SettingManager',
    component: () => import('@renderer/views/SettingManager.vue')
  },
  {
    path: '/outline-manager',
    name: 'OutlineManager',
    component: () => import('@renderer/views/OutlineManager.vue')
  },
  {
    path: '/map-list',
    name: 'MapList',
    component: () => import('@renderer/views/MapList.vue')
  },
  {
    path: '/map-design',
    name: 'MapDesign',
    component: () => import('@renderer/views/MapDesign.vue')
  },
  {
    path: '/relationship-list',
    name: 'RelationshipList',
    component: () => import('@renderer/views/RelationshipList.vue')
  },
  {
    path: '/relationship-design',
    name: 'RelationshipDesign',
    component: () => import('@renderer/views/RelationshipDesign.vue')
  },
  {
    path: '/user-guide',
    name: 'UserGuide',
    component: () => import('@renderer/views/UserGuide.vue')
  },
  {
    path: '/events-sequence',
    name: 'EventsSequence',
    component: () => import('@renderer/views/EventsSequence.vue')
  },
  {
    path: '/organization-list',
    name: 'OrganizationList',
    component: () => import('@renderer/views/OrganizationList.vue')
  },
  {
    path: '/organization-design',
    name: 'OrganizationDesign',
    component: () => import('@renderer/views/OrganizationDesign.vue')
  },
  // 鍦ㄨ繖閲屾坊鍔犳洿澶氳矾鐢遍厤缃?
]

const router = createRouter({
  // 鍦?Electron 涓娇鐢?hash 妯″紡
  history: createWebHashHistory(),
  routes
})

// 璺敱瀹堝崼锛氭鏌ヤ功鏋跺瘑鐮?
router.beforeEach(async (to, from, next) => {
  // 濡傛灉璁块棶璁よ瘉椤甸潰锛岀洿鎺ラ€氳繃
  if (to.name === 'Auth') {
    next()
    return
  }

  // 妫€鏌ユ槸鍚︽湁涔︽灦瀵嗙爜
  const hasPassword = await window.electron?.hasBookshelfPassword?.()
  if (hasPassword) {
    // 浼樺厛妫€鏌ユ湰绐楀彛 sessionStorage锛堝悓绐楀彛鍐呰烦杞矾鐢辨椂鐨勫揩閫熷垽鏂級
    const sessionAuthenticated = sessionStorage.getItem('bookshelfAuthenticated') === 'true'
    if (sessionAuthenticated) {
      next()
      return
    }

    // sessionStorage 涓病鏈夋爣璁版椂锛堟柊绐楀彛鍦烘櫙锛夛紝鍚戜富杩涚▼鏌ヨ褰撳墠浼氳瘽鐨勮璇佺姸鎬併€?
    // 涓昏繘绋嬬殑 bookshelfAuthenticated 鍙橀噺鍦ㄥ簲鐢ㄥ惎鍔ㄦ椂涓?false锛?
    // 鐢ㄦ埛鍦ㄤ换鎰忕獥鍙ｅ畬鎴愪功鏋跺瘑鐮侀獙璇佸悗鍗宠璁句负 true锛岄噸鍚簲鐢ㄥ悗鑷姩閲嶇疆銆?
    const mainProcessAuthenticated = await window.electron?.getBookshelfAuthenticated?.()
    if (mainProcessAuthenticated) {
      // 鍚屾鍒版湰绐楀彛 sessionStorage锛岄伩鍏嶅悗缁瘡娆¤矾鐢辫烦杞兘鍙戣捣 IPC 璋冪敤
      sessionStorage.setItem('bookshelfAuthenticated', 'true')
      next()
    } else {
      // 鏈璇侊紝璺宠浆鍒拌璇侀〉闈?
      next({ name: 'Auth' })
    }
  } else {
    // 娌℃湁瀵嗙爜锛岀洿鎺ラ€氳繃
    next()
  }
})

export default router
