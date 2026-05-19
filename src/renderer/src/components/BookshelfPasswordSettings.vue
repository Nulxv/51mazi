<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('bookshelfPassword.title')"
    width="500px"
    align-center
    @close="handleClose"
  >
    <div v-if="!hasPassword">
      <el-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        label-width="100px"
        @submit.prevent="handleSetPassword"
      >
        <el-form-item :label="t('bookshelfPassword.inputPassword')" prop="password">
          <el-input
            v-model="passwordForm.password"
            type="password"
            :placeholder="t('bookshelfPassword.passwordPlaceholder')"
            show-password
          />
        </el-form-item>
        <el-form-item :label="t('bookshelfPassword.confirmPassword')" prop="confirmPassword">
          <el-input
            v-model="passwordForm.confirmPassword"
            type="password"
            :placeholder="t('bookshelfPassword.confirmPlaceholder')"
            show-password
          />
        </el-form-item>
      </el-form>
    </div>
    <div v-else>
      <div v-if="!isModifyingPassword" class="password-display">
        <div class="masked-password-text">********</div>
      </div>
      <el-form
        v-else
        ref="modifyPasswordFormRef"
        :model="modifyPasswordForm"
        :rules="modifyPasswordRules"
        label-width="100px"
        @submit.prevent="handleModifyPassword"
      >
        <el-form-item :label="t('bookshelfPassword.oldPassword')" prop="oldPassword">
          <el-input
            v-model="modifyPasswordForm.oldPassword"
            type="password"
            :placeholder="t('bookshelfPassword.oldPasswordPlaceholder')"
            show-password
          />
        </el-form-item>
        <el-form-item :label="t('bookshelfPassword.newPassword')" prop="newPassword">
          <el-input
            v-model="modifyPasswordForm.newPassword"
            type="password"
            :placeholder="t('bookshelfPassword.newPasswordPlaceholder')"
            show-password
          />
        </el-form-item>
        <el-form-item :label="t('bookshelfPassword.confirmPassword')" prop="confirmNewPassword">
          <el-input
            v-model="modifyPasswordForm.confirmNewPassword"
            type="password"
            :placeholder="t('bookshelfPassword.confirmNewPlaceholder')"
            show-password
          />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <template v-if="!hasPassword">
        <el-button @click="handleClose">{{ t('common.cancel') }}</el-button>
        <el-button :loading="passwordLoading" type="primary" @click="handleSetPassword">
          {{ t('common.confirm') }}
        </el-button>
      </template>
      <template v-else>
        <el-button v-if="!isModifyingPassword" @click="handleClose">
          {{ t('bookshelfPassword.close') }}
        </el-button>
        <el-button v-else @click="handleCancelModify">{{ t('common.cancel') }}</el-button>
        <el-button v-if="!isModifyingPassword" type="primary" @click="isModifyingPassword = true">
          {{ t('bookshelfPassword.modify') }}
        </el-button>
        <el-button v-else :loading="passwordLoading" type="primary" @click="handleModifyPassword">
          {{ t('common.confirm') }}
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const hasPassword = ref(false)
const isModifyingPassword = ref(false)
const passwordLoading = ref(false)

const passwordForm = ref({
  password: '',
  confirmPassword: ''
})
const passwordFormRef = ref(null)

const modifyPasswordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmNewPassword: ''
})
const modifyPasswordFormRef = ref(null)

const validatePassword = (rule, value, callback) => {
  if (!value) {
    callback(new Error(t('bookshelfPassword.pleaseInputPassword')))
  } else if (!/^[a-zA-Z0-9]{8,16}$/.test(value)) {
    callback(new Error(t('bookshelfPassword.passwordRuleError')))
  } else {
    callback()
  }
}

const validateConfirmPassword = (rule, value, callback) => {
  if (!value) {
    callback(new Error(t('bookshelfPassword.pleaseConfirmPassword')))
  } else if (value !== passwordForm.value.password) {
    callback(new Error(t('bookshelfPassword.passwordNotMatch')))
  } else {
    callback()
  }
}

const passwordRules = {
  password: [{ validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ validator: validateConfirmPassword, trigger: 'blur' }]
}

const validateOldPassword = (rule, value, callback) => {
  if (!value) {
    callback(new Error(t('bookshelfPassword.pleaseInputOldPassword')))
  } else {
    callback()
  }
}

const validateNewPassword = (rule, value, callback) => {
  if (!value || value.trim() === '') {
    callback()
  } else if (!/^[a-zA-Z0-9]{8,16}$/.test(value)) {
    callback(new Error(t('bookshelfPassword.passwordRuleError')))
  } else {
    callback()
  }
}

const validateConfirmNewPassword = (rule, value, callback) => {
  const newPassword = modifyPasswordForm.value.newPassword
  if (!newPassword || newPassword.trim() === '') {
    if (value && value.trim() !== '') {
      callback(new Error(t('bookshelfPassword.confirmShouldEmptyWhenCancel')))
    } else {
      callback()
    }
  } else if (!value) {
    callback(new Error(t('bookshelfPassword.pleaseConfirmNewPassword')))
  } else if (value !== newPassword) {
    callback(new Error(t('bookshelfPassword.newPasswordNotMatch')))
  } else {
    callback()
  }
}

const modifyPasswordRules = {
  oldPassword: [{ validator: validateOldPassword, trigger: 'blur' }],
  newPassword: [{ validator: validateNewPassword, trigger: 'blur' }],
  confirmNewPassword: [{ validator: validateConfirmNewPassword, trigger: 'blur' }]
}

async function loadPasswordStatus() {
  hasPassword.value = Boolean(await window.electron?.hasBookshelfPassword?.())
}

watch(
  () => props.modelValue,
  async (newVal) => {
    if (newVal) {
      await loadPasswordStatus()
    }
  }
)

function resetForms() {
  isModifyingPassword.value = false
  passwordForm.value = { password: '', confirmPassword: '' }
  modifyPasswordForm.value = {
    oldPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  }

  passwordFormRef.value?.clearValidate?.()
  modifyPasswordFormRef.value?.clearValidate?.()
}

function handleClose() {
  dialogVisible.value = false
  resetForms()
}

async function handleSetPassword() {
  if (!passwordFormRef.value) return
  await passwordFormRef.value.validate(async (valid) => {
    if (!valid) return

    passwordLoading.value = true
    try {
      await window.electron?.setBookshelfPassword?.(passwordForm.value.password)
      hasPassword.value = true
      ElMessage.success(t('bookshelfPassword.setSuccess'))
      handleClose()
      window.location.reload()
    } catch {
      ElMessage.error(t('bookshelfPassword.setFailed'))
    } finally {
      passwordLoading.value = false
    }
  })
}

function handleCancelModify() {
  isModifyingPassword.value = false
  modifyPasswordForm.value = {
    oldPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  }
  modifyPasswordFormRef.value?.clearValidate?.()
}

async function handleModifyPassword() {
  if (!modifyPasswordFormRef.value) return
  await modifyPasswordFormRef.value.validate(async (valid) => {
    if (!valid) return

    passwordLoading.value = true
    try {
      const result = await window.electron?.updateBookshelfPassword?.({
        oldPassword: modifyPasswordForm.value.oldPassword,
        newPassword: modifyPasswordForm.value.newPassword
      })

      if (!result?.success) {
        if (result?.code === 'INVALID_OLD_PASSWORD') {
          ElMessage.error(t('bookshelfPassword.oldPasswordIncorrect'))
        } else {
          ElMessage.error(t('bookshelfPassword.actionFailed'))
        }
        return
      }

      hasPassword.value = !result.removed
      ElMessage.success(
        result.removed ? t('bookshelfPassword.cancelSuccess') : t('bookshelfPassword.modifySuccess')
      )
      handleClose()
      window.location.reload()
    } catch {
      ElMessage.error(t('bookshelfPassword.actionFailed'))
    } finally {
      passwordLoading.value = false
    }
  })
}
</script>

<style lang="scss" scoped>
.password-display {
  padding: 20px 0;
  text-align: center;
}

.masked-password-text {
  font-size: 18px;
  color: var(--text-base);
  font-family: 'Courier New', monospace;
  letter-spacing: 2px;
}
</style>
