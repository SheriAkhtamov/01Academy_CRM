import { useEffect, useState } from 'react';
import { devLog } from '@/lib/debug';

export const translations = {
  academySettings: { en: 'Academy Settings', ru: 'Настройки академии' },
  accessDenied: { en: 'Access Denied', ru: 'Доступ запрещён' },
  accountManagers: { en: 'Account Managers', ru: 'Аккаунт-менеджеры' },
  accountSettings: { en: 'Account Settings', ru: 'Настройки аккаунта' },
  actions: { en: 'Actions', ru: 'Действия' },
  active: { en: 'Active', ru: 'Активный' },
  activeAccount: { en: 'Active Account', ru: 'Активный аккаунт' },
  activeUsers: { en: 'Active Users', ru: 'Активные пользователи' },
  activityLogCSV: { en: 'Activity Log (CSV)', ru: 'Лог активности (CSV)' },
  activityLogsWillAppear: { en: 'Activity logs will appear here', ru: 'Логи активности будут отображаться здесь' },
  addNewUser: { en: 'Add New User', ru: 'Добавить нового пользователя' },
  addSetting: { en: 'Add Setting', ru: 'Добавить настройку' },
  addSystemSetting: { en: 'Add System Setting', ru: 'Добавить системную настройку' },
  addUser: { en: 'Add User', ru: 'Добавить пользователя' },
  adjustSearchCriteria: { en: 'Try adjusting your search criteria', ru: 'Попробуйте изменить критерии поиска' },
  admin: { en: 'Admin', ru: 'Администрирование' },
  adminAccessRequired: { en: 'Administrator privileges required', ru: 'Требуются права администратора' },
  adminButton: { en: 'Admin', ru: 'Администратор' },
  adminDataDescription: { en: 'View and manage administrator credentials', ru: 'Просмотр и управление учётными данными администратора' },
  adminDataTitle: { en: 'Admin Data', ru: 'Данные администратора' },
  adminDataUpdatedDesc: { en: 'Admin data updated successfully', ru: 'Данные администратора успешно обновлены' },
  adminDescription: { en: 'User and system management', ru: 'Управление пользователями и системой' },
  adminEmail: { en: 'Admin Email', ru: 'Email администратора' },
  adminPassword: { en: 'Admin Password', ru: 'Пароль администратора' },
  administration: { en: 'Administration', ru: 'Администрирование' },
  administrators: { en: 'Administrators', ru: 'Администраторы' },
  aiApiKey: { en: 'API key', ru: 'API-ключ' },
  aiApiKeyMissing: { en: 'API key is not configured yet', ru: 'API-ключ пока не настроен' },
  aiApiKeyPlaceholder: { en: 'Enter a new API key', ru: 'Введите новый API-ключ' },
  aiApiKeyStored: { en: 'Stored API key', ru: 'Сохранённый API-ключ' },
  aiBaseUrl: { en: 'Base URL', ru: 'Base URL' },
  aiBaseUrlPlaceholder: { en: 'Optional custom endpoint', ru: 'Необязательный кастомный endpoint' },
  aiConfigured: { en: 'Configured', ru: 'Настроено' },
  aiModel: { en: 'Model', ru: 'Модель' },
  aiModelPlaceholder: { en: 'gpt-4.1-mini, claude-3-5-sonnet, gemini-1.5-pro', ru: 'gpt-4.1-mini, claude-3-5-sonnet, gemini-1.5-pro' },
  aiModelRequired: { en: 'Model is required', ru: 'Укажите модель' },
  aiNotConfigured: { en: 'Not configured', ru: 'Не настроено' },
  aiProvider: { en: 'AI provider', ru: 'AI-провайдер' },
  aiSettingsSaveFailed: { en: 'Failed to save AI settings', ru: 'Не удалось сохранить AI-настройки' },
  aiSettingsSavedDescription: { en: 'Workspace AI provider settings were updated.', ru: 'Настройки AI-провайдера для воркспейса обновлены.' },
  aiSettingsSavedTitle: { en: 'AI settings saved', ru: 'AI-настройки сохранены' },
  aiWorkspaceSettings: { en: 'AI settings', ru: 'AI-настройки' },
  aiWorkspaceSettingsDescription: { en: 'Configure the AI provider used by 01 Academy automations.', ru: 'Настройте AI-провайдера для автоматизаций 01 Academy.' },
  allRoles: { en: 'All roles', ru: 'Все роли' },
  allowReportsAccess: { en: 'Allow access to reports and analytics', ru: 'Разрешить доступ к отчётам и аналитике' },
  areYouSureDeleteUser: { en: 'Are you sure you want to delete this user?', ru: 'Вы уверены, что хотите удалить этого пользователя?' },
  authenticationRequired: { en: 'Authentication required', ru: 'Требуется авторизация' },
  breadcrumb: { en: 'Breadcrumb', ru: 'Навигационная цепочка' },
  canLoginAccess: { en: 'User can login and access the system', ru: 'Пользователь может войти и работать в системе' },
  cancel: { en: 'Cancel', ru: 'Отмена' },
  chatWithEmployees: { en: 'Chat with employees', ru: 'Общение с сотрудниками' },
  clearStoredApiKey: { en: 'Clear stored key', ru: 'Очистить сохранённый ключ' },
  close: { en: 'Close', ru: 'Закрыть' },
  companyLogoAlt: { en: 'Academy Logo', ru: 'Логотип академии' },
  companyLogoLabel: { en: 'Academy Logo', ru: 'Логотип академии' },
  companyNameLabel: { en: 'Academy Name', ru: 'Название академии' },
  companyNamePlaceholder: { en: 'Enter academy name', ru: 'Введите название академии' },
  configureSettings: { en: 'Configure system settings', ru: 'Настроить системные параметры' },
  copiedToClipboard: { en: 'Copied to clipboard', ru: 'Скопировано в буфер' },
  copyCredentials: { en: 'Copy credentials', ru: 'Скопировать учётные данные' },
  create: { en: 'Create', ru: 'Создать' },
  createManageUserAccounts: { en: 'Create and manage user accounts', ru: 'Создание и управление учётными записями' },
  createUser: { en: 'Create User', ru: 'Создать пользователя' },
  created: { en: 'Created', ru: 'Создано' },
  creating: { en: 'Creating...', ru: 'Создание...' },
  credentialsCopied: { en: 'User credentials copied to clipboard', ru: 'Учётные данные пользователя скопированы в буфер' },
  currentKeyMasked: { en: 'Current key', ru: 'Текущий ключ' },
  currentRole: { en: 'Current Role', ru: 'Текущая роль' },
  dashboard: { en: 'Dashboard', ru: 'Панель управления' },
  dataUpdatedTitle: { en: 'Data Updated', ru: 'Данные обновлены' },
  dateOfBirth: { en: 'Date of Birth', ru: 'Дата рождения' },
  defaultLessonDurationDescription: { en: 'Default lesson duration in minutes', ru: 'Продолжительность занятия по умолчанию в минутах' },
  delete: { en: 'Delete', ru: 'Удалить' },
  deleteUser: { en: 'Delete User', ru: 'Удалить пользователя' },

  description: { en: 'Description', ru: 'Описание' },
  edit: { en: 'Edit', ru: 'Редактировать' },
  editAdminDescription: { en: 'Edit credentials for {name}', ru: 'Изменение учётных данных для {name}' },
  editAdminTitle: { en: 'Edit Admin Data', ru: 'Редактирование данных администратора' },
  editUser: { en: 'Edit User', ru: 'Редактировать пользователя' },
  email: { en: 'Email', ru: 'Эл. почта' },
  emailLogin: { en: 'Email (Login)', ru: 'Email (Логин)' },
  emailLoginLabel: { en: 'Email (login)', ru: 'Email (логин)' },
  emailPlaceholder: { en: 'john@company.com', ru: 'ivan@example.com' },
  emailSettings: { en: 'Email Settings', ru: 'Настройки email' },
  employee: { en: 'Employee', ru: 'Сотрудник' },
  employeeChat: { en: 'Employee Chat', ru: 'Чат с сотрудниками' },
  employees: { en: 'Employees', ru: 'Сотрудники' },
  endOfWorkingHoursDescription: { en: 'End of academy working hours', ru: 'Конец рабочего дня академии' },
  english: { en: 'English', ru: 'Английский' },
  enterEmail: { en: 'Enter your email', ru: 'Введите вашу электронную почту' },
  enterFullName: { en: 'Enter full name', ru: 'Введите полное имя' },
  enterLocation: { en: 'Enter location', ru: 'Введите локацию' },
  enterPhone: { en: 'Enter phone', ru: 'Введите телефон' },
  enterPosition: { en: 'Enter position', ru: 'Введите должность' },

  error: { en: 'Error', ru: 'Ошибка' },
  errorOccurred: { en: 'An error occurred', ru: 'Произошла ошибка' },
  exportReports: { en: 'Export Reports', ru: 'Экспорт отчётов' },
  failedCreateUserDescription: { en: 'Failed to create user. Please try again.', ru: 'Не удалось создать пользователя. Пожалуйста, попробуйте снова.' },
  failedDeleteUserDescription: { en: 'Failed to delete user. Please try again.', ru: 'Не удалось удалить пользователя. Пожалуйста, попробуйте снова.' },
  failedResetPasswordDescription: { en: 'Failed to reset password. Please try again.', ru: 'Не удалось сбросить пароль. Пожалуйста, попробуйте снова.' },
  failedToCreateResource: { en: 'Failed to create resource', ru: 'Не удалось создать ресурс' },

  failedToDeleteResource: { en: 'Failed to delete resource', ru: 'Не удалось удалить ресурс' },
  failedToFetchCredentials: { en: 'Failed to fetch credentials', ru: 'Не удалось получить учётные данные' },
  failedToLoadData: { en: 'Failed to load data', ru: 'Не удалось загрузить данные' },
  failedToUpdateResource: { en: 'Failed to update resource', ru: 'Не удалось обновить ресурс' },
  failedToUploadResource: { en: 'Failed to upload resource', ru: 'Не удалось загрузить ресурс' },
  failedUpdateSettingDescription: { en: 'Failed to update setting. Please try again.', ru: 'Не удалось обновить настройку. Пожалуйста, попробуйте снова.' },
  failedUpdateUserDescription: { en: 'Failed to update user. Please try again.', ru: 'Не удалось обновить пользователя. Пожалуйста, попробуйте снова.' },
  fillRequiredFields: { en: 'Fill in all required fields', ru: 'Заполните все обязательные поля' },
  fromEmail: { en: 'From Email', ru: 'Отправитель email' },
  fromEmailPlaceholder: { en: 'noreply@company.com', ru: 'noreply@company.com' },
  fullName: { en: 'Full Name', ru: 'Полное имя' },
  fullNameLabel: { en: 'Full Name', ru: 'Полное имя' },
  fullNamePlaceholder: { en: 'John Doe', ru: 'Иван Иванов' },
  fullNameRequired: { en: 'Full name is required', ru: 'Полное имя обязательно' },
  fullNameRequiredValidation: { en: 'Full name is required', ru: 'Полное имя обязательно' },
  hiddenForSecurity: { en: '(Hidden for security)', ru: '(Скрыто в целях безопасности)' },
  hide: { en: 'Hide', ru: 'Скрыть' },
  inactive: { en: 'Inactive', ru: 'Неактивный' },
  inactiveUsers: { en: 'Inactive users', ru: 'Неактивные пользователи' },
  invalidCredentialsMessage: { en: 'Invalid credentials. Please check your login and password.', ru: 'Неверные учётные данные. Проверьте, пожалуйста, логин и пароль.' },
  invalidData: { en: 'Invalid data', ru: 'Некорректные данные' },
  invalidEmailAddress: { en: 'Invalid email address', ru: 'Неверный адрес электронной почты' },
  lastUpdated: { en: 'Last updated', ru: 'Последнее обновление' },
  leaveEmptyToKeep: { en: 'Leave empty to keep current', ru: 'Оставьте пустым, чтобы не менять' },
  lessonDuration: { en: 'Lesson Duration', ru: 'Длительность занятия' },
  loading: { en: 'Loading...', ru: 'Загрузка...' },
  loadingMessages: { en: 'Loading messages...', ru: 'Загрузка сообщений...' },
  location: { en: 'Location', ru: 'Местоположение' },
  loginFailedMessage: { en: 'Login failed. Please check your credentials.', ru: 'Ошибка входа. Пожалуйста, проверьте учётные данные.' },
  loginOrEmailLabel: { en: 'Login or Email', ru: 'Логин или Email' },
  loginOrEmailPlaceholder: { en: 'Enter login or email', ru: 'Введите логин или email' },
  loginSuccess: { en: 'Login Successful', ru: 'Вход выполнен' },

  logoPreviewAlt: { en: 'Logo preview', ru: 'Предпросмотр логотипа' },
  logout: { en: 'Logout', ru: 'Выйти' },
  logoutFailed: { en: 'Failed to logout', ru: 'Не удалось выйти из системы' },

  messages: { en: 'Messages', ru: 'Сообщения' },
  mobileSidebarDescription: { en: 'Displays the mobile sidebar.', ru: 'Отображает мобильную боковую панель.' },
  morePages: { en: 'More pages', ru: 'Больше страниц' },
  newPassword: { en: 'New Password', ru: 'Новый пароль' },
  newUserAddedDescription: { en: 'The new user has been added and will receive login credentials via email.', ru: 'Новый пользователь добавлен и получит учётные данные по электронной почте.' },
  next: { en: 'Next', ru: 'Далее' },
  nextSlide: { en: 'Next slide', ru: 'Следующий слайд' },
  noAdminPermission: { en: 'You do not have permission to access the administration section', ru: 'У вас нет доступа к разделу администрирования' },
  noConversationsYet: { en: 'No conversations yet', ru: 'Пока нет переписок' },
  noMessagesYet: { en: 'No messages yet', ru: 'Пока нет сообщений' },
  noNotifications: { en: 'No notifications', ru: 'Нет уведомлений' },
  noSearchResults: { en: 'No search results', ru: 'Результатов поиска не найдено' },
  noUsersFound: { en: 'No users found', ru: 'Пользователей не найдено' },

  notAvailable: { en: 'N/A', ru: 'Н/Д' },
  now: { en: 'now', ru: 'сейчас' },
  offline: { en: 'Offline', ru: 'Офлайн' },
  ok: { en: 'OK', ru: 'ОК' },
  online: { en: 'Online', ru: 'Онлайн' },
  pageNotFound: { en: 'Page Not Found', ru: 'Страница не найдена' },
  pageNotFoundDescription: { en: 'The page you are looking for does not exist.', ru: 'Страница, которую вы ищете, не существует.' },
  pagination: { en: 'Pagination', ru: 'Пагинация' },
  password: { en: 'Password', ru: 'Пароль' },
  passwordHint: { en: 'Leave empty if you do not want to change the password', ru: 'Если не хотите менять пароль, оставьте поле пустым' },
  passwordLabel: { en: 'Password', ru: 'Пароль' },
  passwordMinLength: { en: 'Password Min Length', ru: 'Минимальная длина пароля' },
  passwordMinLengthPlaceholder: { en: '8', ru: '8' },
  passwordNotAvailable: { en: 'Password is not available', ru: 'Пароль недоступен' },
  passwordResetDescription: { en: 'A new temporary password has been generated for this user.', ru: 'Для этого пользователя сгенерирован новый временный пароль.' },
  passwordResetHint: { en: 'Current passwords are not stored in readable form. Reset to generate a new temporary password.', ru: 'Текущие пароли не хранятся в читаемом виде. Выполните сброс, чтобы сгенерировать новый временный пароль.' },
  passwordResetSuccessfullyTitle: { en: 'Password reset successfully', ru: 'Пароль успешно сброшен' },
  paymentReminderTimeDescription: { en: 'Payment reminder time in minutes before due date', ru: 'Время напоминания об оплате в минутах до дедлайна' },
  phone: { en: 'Phone', ru: 'Телефон' },
  phonePlaceholder: { en: '+1 (555) 123-45-67', ru: '+7 (999) 123-45-67' },
  platformName: { en: '01 Academy CRM', ru: '01 Academy CRM' },
  position: { en: 'Position', ru: 'Должность' },
  positionLabel: { en: 'Position', ru: 'Должность' },
  positionPlaceholder: { en: 'Account manager', ru: 'Аккаунт-менеджер' },
  positionRequired: { en: 'Position is required', ru: 'Должность обязательна' },
  previous: { en: 'Previous', ru: 'Назад' },
  previousSlide: { en: 'Previous slide', ru: 'Предыдущий слайд' },
  profileUpdated: { en: 'Profile updated successfully', ru: 'Профиль успешно обновлён' },
  recentActivity: { en: 'Recent Activity', ru: 'Последняя активность' },
  reminderTime: { en: 'Reminder Time (minutes before)', ru: 'Время напоминания (минут до)' },
  reportAccessRequired: { en: 'Report access required', ru: 'Требуется доступ к отчётам' },
  reportsAccess: { en: 'Reports Access', ru: 'Доступ к отчётам' },
  reportsActivityLogs: { en: 'Activity Logs', ru: 'Логи активности' },
  reportsLogs: { en: 'Reports & Logs', ru: 'Отчёты и логи' },
  require2FA: { en: 'Require 2FA', ru: 'Требовать 2FA' },
  resetPassword: { en: 'Reset Password', ru: 'Сбросить пароль' },
  resettingPassword: { en: 'Resetting...', ru: 'Сброс...' },
  resourceNotFound: { en: 'Resource not found', ru: 'Ресурс не найден' },
  returnToPanel: { en: 'Return to Panel', ru: 'Вернуться в панель' },
  role: { en: 'Role', ru: 'Роль' },
  roleChangeAdminOnly: { en: 'Only administrators can change roles', ru: 'Только администраторы могут менять роли' },
  roleLabel: { en: 'Role', ru: 'Роль' },
  russian: { en: 'Russian', ru: 'Русский' },
  salesAccessRequired: { en: 'Sales access required', ru: 'Требуется доступ отдела продаж' },
  save: { en: 'Save', ru: 'Сохранить' },
  saveAiSettings: { en: 'Save AI settings', ru: 'Сохранить AI-настройки' },
  saveAllSettings: { en: 'Save All Settings', ru: 'Сохранить все настройки' },
  saveChanges: { en: 'Save Changes', ru: 'Сохранить изменения' },
  saveCredentialsWarning: { en: 'Save these credentials securely. They cannot be recovered.', ru: 'Сохраните учётные данные в надёжном месте. Восстановить их невозможно.' },
  saveSetting: { en: 'Save Setting', ru: 'Сохранить настройку' },
  saving: { en: 'Saving...', ru: 'Сохранение...' },
  searchEmployees: { en: 'Search employees...', ru: 'Поиск сотрудников...' },
  searchUsers: { en: 'Search users...', ru: 'Поиск пользователей...' },
  securitySettings: { en: 'Security Settings', ru: 'Настройки безопасности' },
  selectEmployee: { en: 'Select an employee', ru: 'Выберите сотрудника' },
  sessionSaveFailed: { en: 'Failed to save session', ru: 'Не удалось сохранить сессию' },
  sessionTimeout: { en: 'Session Timeout (hours)', ru: 'Время сессии (часы)' },
  sessionTimeoutPlaceholder: { en: '24', ru: '24' },
  settingDescriptionPlaceholder: { en: 'Describe what this setting does...', ru: 'Опишите назначение этой настройки...' },
  settingKey: { en: 'Setting Key', ru: 'Ключ настройки' },
  settingKeyRequiredValidation: { en: 'Setting key is required', ru: 'Ключ настройки обязателен' },
  settingNamePlaceholder: { en: 'setting_name', ru: 'название_настройки' },
  settingUpdatedSuccessfullyTitle: { en: 'Setting updated successfully', ru: 'Настройка успешно обновлена' },
  settingValuePlaceholder: { en: 'Setting value', ru: 'Значение настройки' },
  settingValueRequiredValidation: { en: 'Setting value is required', ru: 'Значение настройки обязательно' },
  settings: { en: 'Settings', ru: 'Настройки' },
  sidebarTitle: { en: 'Sidebar', ru: 'Боковая панель' },
  signIn: { en: 'Sign In', ru: 'Войти' },
  signInToContinue: { en: 'Sign in to continue', ru: 'Войдите, чтобы продолжить' },
  smtpHost: { en: 'SMTP Host', ru: 'SMTP хост' },
  smtpHostPlaceholder: { en: 'smtp.gmail.com', ru: 'smtp.gmail.com' },
  smtpPort: { en: 'SMTP Port', ru: 'SMTP порт' },
  smtpPortPlaceholder: { en: '587', ru: '587' },
  startConversation: { en: 'Start a conversation!', ru: 'Начните переписку!' },
  startOfWorkingHoursDescription: { en: 'Start of academy working hours', ru: 'Начало рабочего дня академии' },
  status: { en: 'Status', ru: 'Статус' },
  success: { en: 'Success', ru: 'Успешно' },

  systemSettingSavedDescription: { en: 'The system setting has been saved.', ru: 'Системная настройка была сохранена.' },
  systemSettings: { en: 'System Settings', ru: 'Системные настройки' },
  systemSettingsJSON: { en: 'System Settings (JSON)', ru: 'Системные настройки (JSON)' },
  systemStatistics: { en: 'System Statistics', ru: 'Системная статистика' },
  thisActionCannotBeUndone: { en: 'This action cannot be undone.', ru: 'Это действие нельзя отменить.' },
  toggleSidebar: { en: 'Toggle sidebar', ru: 'Переключить боковую панель' },
  tooManyLoginAttempts: { en: 'Too many login attempts. Please try again later.', ru: 'Слишком много попыток входа. Попробуйте позже.' },
  totalUsers: { en: 'Total Users', ru: 'Всего пользователей' },
  trackUserActions: { en: 'Track all user actions and system changes', ru: 'Отслеживание всех действий пользователей и системных изменений' },
  typeMessage: { en: 'Type a message...', ru: 'Напишите сообщение...' },
  unauthorized: { en: 'Unauthorized', ru: 'Неавторизован' },
  updateAdminFailed: { en: 'Failed to update admin data', ru: 'Не удалось обновить данные администратора' },
  updateFailed: { en: 'Update failed', ru: 'Ошибка обновления' },
  updateUser: { en: 'Update User', ru: 'Обновить пользователя' },
  useSearchToStartChat: { en: 'Use search to start a new chat', ru: 'Используйте поиск для начала нового чата' },
  user: { en: 'User', ru: 'Пользователь' },
  userCreatedSuccessfullyTitle: { en: 'User created successfully', ru: 'Пользователь успешно создан' },
  userCredentials: { en: 'User Credentials', ru: 'Учётные данные пользователя' },
  userDeletedSuccessfullyTitle: { en: 'User deleted successfully', ru: 'Пользователь успешно удалён' },
  userInformationUpdatedDescription: { en: 'The user information has been updated.', ru: 'Информация о пользователе была обновлена.' },
  userManagement: { en: 'User Management', ru: 'Управление пользователями' },
  userRemovedFromSystemDescription: { en: 'The user has been removed from the system.', ru: 'Пользователь был удалён из системы.' },
  userReportPDF: { en: 'User Report (PDF)', ru: 'Отчёт по пользователям (PDF)' },
  userUpdatedSuccessfullyTitle: { en: 'User updated successfully', ru: 'Пользователь успешно обновлён' },
  validEmailRequired: { en: 'Valid email is required', ru: 'Требуется корректный адрес электронной почты' },
  value: { en: 'Value', ru: 'Значение' },
  viewCredentials: { en: 'View credentials', ru: 'Просмотр учётных данных' },
  viewMode: { en: 'View Mode', ru: 'Режим просмотра' },
  viewSystemActivity: { en: 'View system activity and user actions', ru: 'Просмотр системной активности и действий пользователей' },
  welcomeMessage: { en: 'Welcome to 01 Academy CRM', ru: 'Добро пожаловать в CRM 01 Academy' },
  workingHoursEnd: { en: 'Working Hours End', ru: 'Конец рабочего дня' },
  workingHoursStart: { en: 'Working Hours Start', ru: 'Начало рабочего дня' },
} as const;

export type Language = 'en' | 'ru';

const DEFAULT_LANGUAGE: Language = 'ru';
const PRIMARY_LANGUAGE_STORAGE_KEY = 'preferred-language';
const LEGACY_LANGUAGE_STORAGE_KEY = 'language';

const resolveStoredLanguage = (): Language => {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  const storedLanguage =
    localStorage.getItem(PRIMARY_LANGUAGE_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);

  return storedLanguage === 'en' || storedLanguage === 'ru'
    ? storedLanguage
    : DEFAULT_LANGUAGE;
};

const persistLanguage = (language: Language) => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(PRIMARY_LANGUAGE_STORAGE_KEY, language);
  localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, language);
};

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(() => i18n.getCurrentLanguage());

  useEffect(() => i18n.subscribe(setLanguage), []);

  const changeLanguage = (newLanguage: Language) => {
    i18n.setLanguage(newLanguage);
  };

  return { language, changeLanguage };
}

class I18nService {
  private currentLanguage: Language = DEFAULT_LANGUAGE;
  private listeners: Array<(lang: Language) => void> = [];

  constructor() {
    this.currentLanguage = resolveStoredLanguage();
  }

  getCurrentLanguage(): Language {
    return this.currentLanguage;
  }

  setLanguage(lang: Language): void {
    this.currentLanguage = lang;
    persistLanguage(lang);
    this.listeners.forEach(callback => callback(lang));
  }

  subscribe(callback: (lang: Language) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  t(key: keyof typeof translations): string {
    const translation = translations[key];
    if (!translation) {
      devLog(`Translation missing for key: ${key}`);
      return key.toString();
    }
    return translation[this.currentLanguage] || translation['en'] || key.toString();
  }
}

export const i18n = new I18nService();
export const t = (key: keyof typeof translations) => i18n.t(key);
