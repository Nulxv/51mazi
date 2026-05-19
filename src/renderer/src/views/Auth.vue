<template>
  <div class="auth-page">
    <div class="auth-container">
      <h2 class="auth-title">{{ t('auth.title') }}</h2>
      <el-form class="auth-form" @submit.prevent="handleAuthSubmit">
        <el-form-item>
          <el-input
            v-model="authPassword"
            type="password"
            :placeholder="t('auth.passwordPlaceholder')"
            size="large"
            clearable
            @keydown.enter.prevent="handleAuthSubmit"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            :loading="authLoading"
            type="primary"
            size="large"
            style="width: 100%"
            @click="handleAuthSubmit"
          >
            {{ t('auth.submit') }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()
const authPassword = ref('')
const authLoading = ref(false)

onMounted(async () => {
  const hasPassword = await window.electron?.hasBookshelfPassword?.()
  if (!hasPassword) {
    router.push('/')
  }
})

async function handleAuthSubmit() {
  if (!authPassword.value) {
    ElMessage.warning(t('auth.pleaseInputPassword'))
    return
  }

  authLoading.value = true
  try {
    const result = await window.electron?.verifyBookshelfPassword?.(authPassword.value)
    if (result?.success) {
      sessionStorage.setItem('bookshelfAuthenticated', 'true')
      await window.electron?.setBookshelfAuthenticated?.()
      router.push('/')
      return
    }

    ElMessage.error(t('auth.wrongPassword'))
    authPassword.value = ''
  } finally {
    authLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.auth-page {
  width: 100vw;
  height: 100vh;
  background-color: #ffffff;
  display: flex;
  justify-content: center;
  align-items: center;
}

.auth-container {
  width: 400px;
  padding: 40px;
  background-color: #ffffff;
}

.auth-title {
  text-align: center;
  font-size: 24px;
  font-weight: 500;
  margin-bottom: 30px;
  color: #303133;
}

.auth-form {
  .el-form-item {
    margin-bottom: 20px;
  }
}
</style>
