/**
 * All user-facing UI strings, keyed by usage. Keeping them in one module
 * makes a future locale switch a data change instead of a code change.
 */
export const m = {
  appName: 'اچار',
  appTagline: 'میزکار پست‌پروسسور',
  appVersion: 'اچار نسخه',

  navGenerate: 'تولید جی‌کد',
  navMcp: 'سرور MCP',
  navAriaLabel: 'ناوبری اصلی',

  fixturesHeading: 'نمونه‌ها',
  fixtureHasProfile: 'همراه با پروفایل ماشین',

  mcpCardTitle: 'سرور MCP',
  mcpCardSubtitle: 'اتصال کلاینت‌های هوش مصنوعی از طریق stdio',
  mcpCopy: 'کپی دستور',
  mcpCopied: 'کپی شد!',

  workspaceUnavailable: 'میزکار در دسترس نیست',

  eyebrow: 'پست‌پروسسور سی‌ان‌سی',
  pageTitleGenerate: 'تولید برنامه',
  pageTitleMcp: 'سرور MCP',

  themeAriaLabel: 'انتخاب پوسته',
  themeSystem: 'سیستم',
  themeLight: 'روشن',
  themeDark: 'تیره',

  statusConnecting: 'در حال اتصال',
  statusReady: 'آماده',
  statusWorking: 'در حال پردازش',
  statusValidating: 'در حال اعتبارسنجی',
  statusGenerating: 'در حال تولید',
  statusValidationIssues: 'اشکال در اعتبارسنجی',
  statusValidationPassed: 'اعتبارسنجی موفق',
  statusGenerationDone: 'تولید کامل شد',
  statusFailed: 'عملیات ناموفق',

  setupHeading: 'تنظیمات تولید',
  setupFixtureSelected: 'نمونه انتخاب شده',
  setupCustomInput: 'ورودی سفارشی',
  clear: 'پاک کردن',

  traceLabel: 'فایل ترِیس ۵',
  required: 'الزامی',
  tracePlaceholder: 'فایل ترِیس MPF را انتخاب کنید',
  browse: 'انتخاب',
  vmidLabel: 'VMID',
  vmidPlaceholder: 'تعریف ماشین (اختیاری)',
  profileLabel: 'پروفایل ماشین',
  profileNone: 'بدون پروفایل ماشین',
  profileAriaLabel: 'پروفایل‌های ماشین شناخته‌شده',
  profilePlaceholder: 'پروفایل JSON (اختیاری)',
  profileCustom: 'پروفایل ماشین سفارشی',
  axes: 'محوره',
  programNameLabel: 'نام برنامه',
  postLabel: 'پست',
  referenceLabel: 'خروجی مرجع',
  referencePlaceholder: 'پوشه مقایسه (اختیاری)',
  outputLabel: 'پوشه خروجی',
  outputPlaceholder: 'پیش‌فرض: generated/نام برنامه',
  formNote:
    'پروفایل ماشین اختیاری است؛ در صورت وجود داده‌های پروفایل و VMID، سازگاری محورها به‌صورت خودکار بررسی می‌شود.',
  validate: 'اعتبارسنجی',
  generateGcode: 'تولید جی‌کد',

  resultsHeading: 'خروجی',
  openFolder: 'باز کردن پوشه',
  emptyTitle: 'آماده تولید',
  emptyBody:
    'یک نمونه انتخاب کنید یا فایل ترِیس بدهید؛ سپس اعتبارسنجی یا تولید را اجرا کنید.',
  noRunYet: 'هنوز خروجی‌ای تولید نشده است',
  generatedSummary: (files: string, duration: string) =>
    `${files} فایل در ${duration} تولید شد`,
  validatedSummary: (events: string) => `${events} رویداد ترِیس اعتبارسنجی شد`,

  metricFiles: 'فایل‌ها',
  metricEvents: 'رویدادها',
  metricElapsed: 'زمان',
  metricParity: 'تطابق',
  metricsAriaLabel: 'آمار تولید',
  parityNotRun: 'اجرا نشده',
  parityMatched: 'مطابق',
  parityIssues: 'مغایرت',

  diagnosticsHeading: 'عیب‌یابی',
  severityError: 'خطا',
  severityWarning: 'هشدار',
  severityInfo: 'اطلاع',

  generatedFilesHeading: 'فایل‌های تولیدشده',
  lines: 'خط',
  preview: 'پیش‌نمایش',
  previewTruncated: 'پیش‌نمایش کوتاه شده',
  loading: 'در حال بارگذاری…',

  validationResultFile: 'نتیجه اعتبارسنجی',
  validationNoIssues: 'هیچ مشکل سازگاری یافت نشد.',
  validationReviewIssues: 'پیش از تولید، موارد عیب‌یابی را بررسی کنید.',
  noValidationResult: 'نتیجه‌ای از اعتبارسنجی دریافت نشد.',
  noGenerationResult: 'نتیجه‌ای از تولید دریافت نشد.',
  noBootstrapData: 'داده‌های راه‌اندازی برنامه دریافت نشد.',

  errorBannerTitle: 'خطا در اجرا',

  mcpPanelTitle: 'اتصال کلاینت هوش مصنوعی',
  mcpPanelBody:
    'اچار یک سرور MCP روی stdio ارائه می‌کند تا کلاینت‌های هوش مصنوعی مانند Claude بتوانند مستقیم ترِیس‌ها را اعتبارسنجی و جی‌کد تولید کنند.',
  mcpPanelCommandLabel: 'دستور اجرا',
  mcpPanelToolsHeading: 'ابزارهای در دسترس',
  mcpTools: [
    {
      name: 'achar_workspace',
      description: 'فهرست نمونه‌ها، پست‌های داخلی و مسیرهای میزکار',
    },
    {
      name: 'achar_validate',
      description: 'اعتبارسنجی ترِیس در برابر VMID و پروفایل ماشین',
    },
    {
      name: 'achar_generate',
      description: 'تولید فایل‌های جی‌کد از ترِیس',
    },
    {
      name: 'achar_read_generated_file',
      description: 'خواندن پیش‌نمایش فایل تولیدشده',
    },
  ],
  mcpPanelEnvNote:
    'برای فعال‌کردن لاگ‌ها متغیر محیطی ACHAR_MCP_LOGS=1 را تنظیم کنید.',
} as const;
